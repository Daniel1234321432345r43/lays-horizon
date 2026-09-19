/**
 * TerrainRenderer.js
 * Renderizado del terreno con un InstancedMesh por ID de bloque y culling de
 * caras internas.
 *
 * Aspecto: cada tipo usa una geometría de caja con color por cara (césped
 * verde arriba y tierra en los lados, por ejemplo) y cada instancia recibe un
 * multiplicador de tono ligeramente distinto y estable derivado de sus
 * coordenadas, de modo que el terreno deja de verse como una plancha lisa.
 *
 * Actualización: se mantiene una tabla de slots por tipo (mapa índice->slot,
 * pila de slots libres y swap-remove) para que updateBlock() reescriba solo el
 * bloque tocado y sus 6 vecinos.
 */

import * as THREE from 'three';

import { BLOCKS, RENDERABLE_BLOCK_IDS, getBlockFaces, getBlockType } from './BlockTypes.js';
import { MIN_Y, MAX_Y, ORIGIN_X, ORIGIN_Z, SIZE_X, SIZE_Z, TOTAL_BLOCKS } from './WorldGrid.js';

const NEIGHBOR_OFFSETS = Object.freeze([
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
]);

/** Ruido determinista por celda: el mismo bloque conserva siempre su tono. */
function hash01(x, y, z) {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Caja unitaria con un color por cara en el atributo de vértices. */
function buildFacedBox(faces) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const normals = geometry.attributes.normal;
  const colors = new Float32Array(normals.count * 3);

  const top = new THREE.Color(faces.top);
  const side = new THREE.Color(faces.side);
  const bottom = new THREE.Color(faces.bottom);

  for (let i = 0; i < normals.count; i += 1) {
    const ny = normals.getY(i);
    const face = ny > 0.5 ? top : ny < -0.5 ? bottom : side;
    colors[i * 3] = face.r;
    colors[i * 3 + 1] = face.g;
    colors[i * 3 + 2] = face.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export class TerrainRenderer {
  /**
   * @param {WorldGrid} grid
   * @param {{ onGeometryChange?: () => void }} [options] Se avisa cuando cambia
   *   la geometría, para que el motor rehaga el mapa de sombras solo entonces.
   */
  constructor(grid, { onGeometryChange } = {}) {
    this.grid = grid;
    this.onGeometryChange = onGeometryChange ?? null;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    // La rejilla nunca cambia de sitio: sus matrices se calculan una sola vez.
    this.group.matrixAutoUpdate = false;

    this.meshes = [];
    this.types = new Map();
    this.renderedType = new Map();
    this.matrix = new THREE.Matrix4();
    this.tint = new THREE.Color();
    this.dirtyTypes = new Set();

    for (const id of RENDERABLE_BLOCK_IDS) {
      const type = getBlockType(id);
      const geometry = buildFacedBox(getBlockFaces(id));
      const material = new THREE.MeshLambertMaterial({
        vertexColors: true,
        flatShading: true
      });
      const mesh = new THREE.InstancedMesh(geometry, material, TOTAL_BLOCKS);
      mesh.name = `blocks:${type.key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      // Reservado de antemano: setColorAt() dimensiona el buffer con `count`,
      // que todavía vale 0 durante la construcción, así que lo creamos aquí.
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(TOTAL_BLOCKS * 3).fill(1),
        3
      );
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

      this.group.add(mesh);
      this.meshes.push(mesh);
      this.types.set(id, {
        id,
        mesh,
        count: 0,
        slotOf: new Map(),
        indexOfSlot: new Map(),
        freeSlots: []
      });
    }
  }

  /**
   * Un bloque se renderiza solo si al menos uno de sus 6 vecinos es aire.
   * Fuera del mapa cuenta como aire por arriba y por los flancos, y como roca
   * firme por debajo (la cara inferior del terreno nunca se genera).
   */
  isExposed(x, y, z) {
    if (this.grid.getBlock(x, y, z) === BLOCKS.AIR.id) return false;

    for (let i = 0; i < NEIGHBOR_OFFSETS.length; i += 1) {
      const [dx, dy, dz] = NEIGHBOR_OFFSETS[i];
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;

      if (ny > MAX_Y) return true;
      if (ny < MIN_Y) continue;

      const outsideSide =
        nx < ORIGIN_X || nx >= ORIGIN_X + SIZE_X || nz < ORIGIN_Z || nz >= ORIGIN_Z + SIZE_Z;
      if (outsideSide) return true;

      if (this.grid.getBlock(nx, ny, nz) === BLOCKS.AIR.id) return true;
    }

    return false;
  }

  /** Reconstrucción completa de la malla de instancias. */
  buildMesh() {
    for (const state of this.types.values()) {
      state.count = 0;
      state.slotOf.clear();
      state.indexOfSlot.clear();
      state.freeSlots.length = 0;
      state.mesh.count = 0;
    }
    this.renderedType.clear();

    this.grid.forEach((x, y, z, id) => {
      if (id === BLOCKS.AIR.id) return;
      if (!this.isExposed(x, y, z)) return;
      this.claimSlot(id, this.grid.getIndex(x, y, z), x, y, z);
    });

    for (const state of this.types.values()) {
      state.mesh.count = state.count;
      state.mesh.computeBoundingSphere();
      state.mesh.instanceMatrix.needsUpdate = true;
      state.mesh.instanceColor.needsUpdate = true;
    }
    this.dirtyTypes.clear();
    return this;
  }

  /**
   * Recalcula la visibilidad del bloque indicado y de sus 6 vecinos directos,
   * sin reconstruir el resto de la escena.
   */
  updateBlock(x, y, z) {
    this.reconcile(x, y, z);
    for (let i = 0; i < NEIGHBOR_OFFSETS.length; i += 1) {
      const [dx, dy, dz] = NEIGHBOR_OFFSETS[i];
      this.reconcile(x + dx, y + dy, z + dz);
    }
    this.flush();
    if (this.onGeometryChange) this.onGeometryChange();
  }

  reconcile(x, y, z) {
    if (!this.grid.inBounds(x, y, z)) return;

    const index = this.grid.getIndex(x, y, z);
    const id = this.grid.getBlock(x, y, z);
    const current = this.renderedType.get(index);
    const shouldRender = id !== BLOCKS.AIR.id && this.isExposed(x, y, z);

    if (shouldRender && current !== id) {
      if (current !== undefined) this.releaseSlot(current, index);
      this.claimSlot(id, index, x, y, z);
      return;
    }

    if (!shouldRender && current !== undefined) {
      this.releaseSlot(current, index);
    }
  }

  claimSlot(typeId, index, x, y, z) {
    const state = this.types.get(typeId);
    if (!state) return;

    const slot = state.freeSlots.length > 0 ? state.freeSlots.pop() : state.count;
    if (slot >= TOTAL_BLOCKS) return;
    if (slot >= state.count) state.count = slot + 1;

    this.matrix.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
    state.mesh.setMatrixAt(slot, this.matrix);
    state.mesh.setColorAt(slot, this.#instanceTint(x, y, z));

    state.slotOf.set(index, slot);
    state.indexOfSlot.set(slot, index);
    this.renderedType.set(index, typeId);
    this.dirtyTypes.add(typeId);
  }

  releaseSlot(typeId, index) {
    const state = this.types.get(typeId);
    if (!state) return;

    const slot = state.slotOf.get(index);
    if (slot === undefined) {
      this.renderedType.delete(index);
      return;
    }

    const lastSlot = state.count - 1;
    const lastIndex = state.indexOfSlot.get(lastSlot);

    if (slot !== lastSlot && lastIndex !== undefined) {
      state.mesh.getMatrixAt(lastSlot, this.matrix);
      state.mesh.setMatrixAt(slot, this.matrix);
      state.mesh.getColorAt(lastSlot, this.tint);
      state.mesh.setColorAt(slot, this.tint);
      state.indexOfSlot.set(slot, lastIndex);
      state.slotOf.set(lastIndex, slot);
    }

    state.slotOf.delete(index);
    state.indexOfSlot.delete(lastSlot);
    state.freeSlots.push(lastSlot);
    state.count = Math.max(0, lastSlot);
    this.renderedType.delete(index);
    this.dirtyTypes.add(typeId);
  }

  /** Variación de brillo y tono estable por celda (media ~1.0). */
  #instanceTint(x, y, z) {
    const shade = 0.88 + hash01(x, y, z) * 0.24;
    const warm = 1 + (hash01(x + 17, y + 5, z - 9) - 0.5) * 0.08;
    const cool = 1 + (hash01(x - 23, y + 11, z + 7) - 0.5) * 0.08;
    return this.tint.setRGB(shade * warm, shade, shade * cool);
  }

  /** Vuelca al GPU los cambios pendientes de los tipos afectados. */
  flush() {
    if (this.dirtyTypes.size === 0) return;
    for (const typeId of this.dirtyTypes) {
      const state = this.types.get(typeId);
      state.mesh.count = state.count;
      state.mesh.instanceMatrix.needsUpdate = true;
      state.mesh.instanceColor.needsUpdate = true;
      state.mesh.computeBoundingSphere();
    }
    this.dirtyTypes.clear();
  }

  /** Instancias visibles por tipo (usado por el resumen de arranque). */
  getStats() {
    const perType = {};
    let visible = 0;
    for (const state of this.types.values()) {
      perType[getBlockType(state.id).name] = state.count;
      visible += state.count;
    }
    return { visible, total: TOTAL_BLOCKS, perType };
  }

  dispose() {
    for (const state of this.types.values()) {
      state.mesh.geometry.dispose();
      state.mesh.material.dispose();
      state.mesh.dispose();
    }
    this.group.clear();
  }
}
