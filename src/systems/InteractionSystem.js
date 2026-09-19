/**
 * InteractionSystem.js
 * Convierte el cursor de pantalla en un objetivo del mundo:
 *  - THREE.Raycaster fija el rayo desde la cámara hacia el puntero.
 *  - El bloque se resuelve con un recorrido DDA de la rejilla (Amanatides &
 *    Woo), exacto y O(pasos) en lugar de probar 32.000 instancias por frame.
 *  - Cultivos y edificios sí se prueban con el Raycaster (pocas mallas).
 * Un BoxHelper de línea resalta la celda apuntada en verde o rojo.
 */

import * as THREE from 'three';

import { getBlockType } from '../world/BlockTypes.js';
import { MAX_Y, MIN_Y } from '../world/WorldGrid.js';

const MAX_RAY_DISTANCE = 220;
const CROP_LAYER = 0;
const MAX_DDA_STEPS = 1024;
const VALID_COLOR = 0x76f06a;
const INVALID_COLOR = 0xf05a5a;

export class InteractionSystem {
  constructor({ camera, domElement, grid, farming, city, npc }) {
    this.camera = camera;
    this.domElement = domElement;
    this.grid = grid;
    this.objectTargets = [farming.group, city.group];
    if (npc) this.objectTargets.push(npc.mesh);
    this.farming = farming;
    this.city = city;
    this.npc = npc;

    this.pointer = new THREE.Vector2(0, 0);
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = MAX_RAY_DISTANCE;

    this.target = null;
    this.valid = true;
    this.hasPointer = false;
    this.normalMatrix = new THREE.Matrix3();
    this.helper = this.#createHelper();
    this.previewGroup = this.#createPreview();

    this.#bindPointerEvents();
  }

  setValid(valid) {
    if (valid === this.valid) return;
    this.valid = valid;
    this.helper.material.color.setHex(valid ? VALID_COLOR : INVALID_COLOR);
  }

  /**
   * Fantasma de colocación: muestra con transparencia la huella y la altura
   * del bloque o del edificio que se va a construir en la celda apuntada.
   */
  setPreview(preview) {
    if (!preview) {
      this.previewGroup.visible = false;
      return;
    }

    const size = preview.size ?? 1;
    const height = preview.height ?? 1;
    const scale = [size * 0.98, height * 0.98, size * 0.98];

    this.previewGroup.visible = true;
    this.previewGroup.position.set(preview.x + size / 2, preview.y + height / 2, preview.z + size / 2);
    this.previewFill.scale.set(scale[0], scale[1], scale[2]);
    this.previewEdges.scale.set(scale[0], scale[1], scale[2]);

    const color = preview.valid === false ? INVALID_COLOR : VALID_COLOR;
    this.previewFill.material.color.setHex(color);
    this.previewEdges.material.color.setHex(color);
  }

  /** Traduce un evento de puntero a coordenadas normalizadas de dispositivo. */
  updatePointer(event) {
    const rect = this.domElement.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    this.pointer.x = ((event.clientX - rect.left) / width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / height) * 2 + 1;
    this.hasPointer = true;
    return this.pointer;
  }

  /** Lanza el rayo, resuelve el objetivo y reposiciona el cursor 3D. */
  update() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const origin = this.raycaster.ray.origin;
    const direction = this.raycaster.ray.direction;

    const blockHit = this.#raycastVoxels(origin, direction);

    // Los cultivos y edificios pueden crearse o escalarse dentro del mismo tick
    // que el clic, antes de que el renderer refresque sus matrices de mundo.
    for (const root of this.objectTargets) root.updateMatrixWorld();
    const objectHits = this.raycaster.intersectObjects(this.objectTargets, true);
    const objectHit = objectHits.length > 0 ? objectHits[0] : null;

    let target = null;

    if (objectHit && (!blockHit || objectHit.distance < blockHit.distance)) {
      target = this.#resolveObjectTarget(objectHit);
    }

    if (!target && blockHit) {
      const id = this.grid.getBlock(blockHit.x, blockHit.y, blockHit.z);
      if (id !== 0) {
        target = {
          kind: 'block',
          block: { x: blockHit.x, y: blockHit.y, z: blockHit.z },
          id,
          type: getBlockType(id),
          normal: { ...blockHit.normal },
          adjacent: {
            x: blockHit.x + blockHit.normal.x,
            y: blockHit.y + blockHit.normal.y,
            z: blockHit.z + blockHit.normal.z
          },
          distance: blockHit.distance
        };
      }
    }

    // Un cultivo ocupa su celda: apuntar a la tierra donde está plantado es
    // apuntar a la planta. Sin esto, desde la cámara isométrica el rayo roza
    // las hojas, cae en el bloque de debajo y la cosecha no se dispara.
    if (target && target.kind === 'block' && target.block.y === CROP_LAYER) {
      const crop = this.farming.getCropAt(target.block.x, target.block.z);
      if (crop) {
        const soil = { x: crop.x, y: CROP_LAYER, z: crop.z };
        target = { kind: 'crop', crop, block: soil, soil, distance: target.distance };
      }
    }

    this.target = target;

    // El cursor 3D no se muestra hasta que el ratón se mueve sobre el canvas:
    // evita un recuadro fantasma en el centro antes de la primera interacción.
    if (!this.hasPointer || !target || target.kind === 'building' || target.kind === 'npc') {
      this.helper.visible = false;
    } else {
      this.helper.visible = true;
      this.helper.position.set(target.block.x + 0.5, target.block.y + 0.5, target.block.z + 0.5);
    }

    return this.target;
  }

  /**
   * Recorrido de vóxeles sobre la rejilla desde el origen del rayo.
   * Devuelve el primer bloque sólido, la normal de la cara de entrada y la
   * distancia recorrida.
   */
  #raycastVoxels(origin, direction) {
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = direction.x > 0 ? 1 : direction.x < 0 ? -1 : 0;
    const stepY = direction.y > 0 ? 1 : direction.y < 0 ? -1 : 0;
    const stepZ = direction.z > 0 ? 1 : direction.z < 0 ? -1 : 0;

    const deltaX = stepX !== 0 ? Math.abs(1 / direction.x) : Infinity;
    const deltaY = stepY !== 0 ? Math.abs(1 / direction.y) : Infinity;
    const deltaZ = stepZ !== 0 ? Math.abs(1 / direction.z) : Infinity;

    let maxX = stepX !== 0 ? ((stepX > 0 ? x + 1 : x) - origin.x) / direction.x : Infinity;
    let maxY = stepY !== 0 ? ((stepY > 0 ? y + 1 : y) - origin.y) / direction.y : Infinity;
    let maxZ = stepZ !== 0 ? ((stepZ > 0 ? z + 1 : z) - origin.z) / direction.z : Infinity;

    let distance = 0;
    let normal = { x: 0, y: 1, z: 0 };

    if (this.grid.isSolid(x, y, z)) {
      return { x, y, z, normal, distance: 0 };
    }

    for (let step = 0; step < MAX_DDA_STEPS; step += 1) {
      if (maxX <= maxY && maxX <= maxZ) {
        x += stepX;
        distance = maxX;
        maxX += deltaX;
        normal = { x: -stepX, y: 0, z: 0 };
      } else if (maxY <= maxZ) {
        y += stepY;
        distance = maxY;
        maxY += deltaY;
        normal = { x: 0, y: -stepY, z: 0 };
      } else {
        z += stepZ;
        distance = maxZ;
        maxZ += deltaZ;
        normal = { x: 0, y: 0, z: -stepZ };
      }

      if (distance > MAX_RAY_DISTANCE) return null;

      if (!this.grid.inBounds(x, y, z)) {
        if (y > MAX_Y && direction.y >= 0) return null;
        if (y < MIN_Y && direction.y <= 0) return null;
        continue;
      }

      if (this.grid.isSolid(x, y, z)) {
        return { x, y, z, normal, distance };
      }
    }

    return null;
  }

  #resolveObjectTarget(hit) {
    // Los cultivos son instancias: el slot del impacto identifica la planta.
    const cropStage = hit.object.userData ? hit.object.userData.cropStage : undefined;
    if (cropStage !== undefined) {
      const crop = this.farming.getCropByInstance(cropStage, hit.instanceId);
      if (crop) {
        const soil = { x: crop.x, y: 0, z: crop.z };
        return { kind: 'crop', crop, block: soil, soil, distance: hit.distance };
      }
    }

    const owner = this.#findOwner(hit.object);
    if (!owner) return null;

    if (owner.kind === 'building') {
      return {
        kind: 'building',
        building: owner.building,
        block: {
          x: owner.building.cells[0].x,
          y: 0,
          z: owner.building.cells[0].z
        },
        distance: hit.distance
      };
    }

    if (owner.kind === 'npc') {
      return {
        kind: 'npc',
        npc: owner.npc,
        block: {
          x: Math.floor(owner.npc.position.x),
          y: Math.floor(owner.npc.position.y),
          z: Math.floor(owner.npc.position.z)
        },
        distance: hit.distance
      };
    }

    return null;
  }

  #findOwner(object) {
    let node = object;
    while (node) {
      if (node.userData && node.userData.pickOwner) return node.userData.pickOwner;
      node = node.parent;
    }
    return null;
  }

  #createHelper() {
    // Ligeramente mayor que 1x1x1 para no competir en profundidad con las caras
    // del bloque; con depthTest activo el cursor queda ocluido por el terreno.
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02));
    const material = new THREE.LineBasicMaterial({
      color: VALID_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: true
    });
    const helper = new THREE.LineSegments(geometry, material);
    helper.name = 'selectionCursor';
    helper.renderOrder = 10;
    helper.visible = false;
    return helper;
  }

  #createPreview() {
    const group = new THREE.Group();
    group.name = 'placementPreview';
    group.visible = false;

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    this.previewFill = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: VALID_COLOR,
        transparent: true,
        opacity: 0.16,
        depthWrite: false
      })
    );
    this.previewEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: VALID_COLOR, transparent: true, opacity: 0.9 })
    );

    group.add(this.previewFill, this.previewEdges);
    return group;
  }

  #bindPointerEvents() {
    this.domElement.addEventListener('pointermove', (event) => this.updatePointer(event));
    this.domElement.addEventListener('pointerdown', (event) => this.updatePointer(event));
  }
}
