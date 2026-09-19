/**
 * Crops.js
 * Cultivos low-poly en tres fases (Semilla -> Brote -> Madura).
 *
 * Rendimiento: en lugar de un grupo de mallas por planta, cada fase es UNA
 * geometría fusionada con el color de cada pieza en los vértices, y todas las
 * plantas de esa fase se dibujan con un único InstancedMesh. El campo entero
 * cuesta 3 draw calls (una por fase) independientemente del número de cultivos.
 *
 * El progreso de crecimiento se aplica como escala de la matriz de instancia,
 * así que también se resuelve sin asignaciones por planta.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CROP_STAGES = Object.freeze([
  Object.freeze({ id: 0, name: 'Semilla', seconds: 6 }),
  Object.freeze({ id: 1, name: 'Brote', seconds: 10 }),
  Object.freeze({ id: 2, name: 'Madura', seconds: Infinity })
]);

/** Curvas de escala (plano y vertical) por fase. */
const STAGE_CURVES = Object.freeze([
  Object.freeze({ min: 0.45, max: 0.8, minY: 0.5, maxY: 0.9 }),
  Object.freeze({ min: 0.7, max: 1, minY: 0.55, maxY: 1 }),
  Object.freeze({ min: 0.92, max: 1, minY: 0.9, maxY: 1 })
]);

const PALETTE = Object.freeze({
  soil: 0x5b3d21,
  seed: 0x8a6a3a,
  stem: 0x4f9d3a,
  leaf: 0x63b84a,
  fruit: 0xe07a2a,
  wood: 0x8a5a2b
});

/** Pinta toda la geometría con un color (se guarda en espacio lineal). */
function paint(geometry, hex) {
  const color = new THREE.Color(hex);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Clona una geometría, la coloca con la matriz dada y la pinta. */
function part(geometry, hex, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const clone = geometry.clone();
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(position[0], position[1], position[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])),
    new THREE.Vector3(scale[0], scale[1], scale[2])
  );
  clone.applyMatrix4(matrix);
  return paint(clone, hex);
}

const BASE = {
  mound: new THREE.CylinderGeometry(0.36, 0.42, 0.09, 8),
  seed: new THREE.SphereGeometry(0.06, 6, 4),
  tip: new THREE.ConeGeometry(0.035, 0.14, 4),
  stemThin: new THREE.CylinderGeometry(0.028, 0.036, 0.46, 6),
  stemThick: new THREE.CylinderGeometry(0.055, 0.07, 1.0, 8),
  leaf: new THREE.SphereGeometry(0.17, 7, 5),
  bud: new THREE.ConeGeometry(0.07, 0.18, 5),
  fruit: new THREE.SphereGeometry(0.13, 8, 6),
  stake: new THREE.CylinderGeometry(0.022, 0.022, 1.05, 4)
};

/** Montículo de tierra presente en todas las fases. */
function moundParts() {
  return [part(BASE.mound, PALETTE.soil, [0, 0.045, 0])];
}

const STAGE_PARTS = [
  () => [
    ...moundParts(),
    part(BASE.seed, PALETTE.seed, [0.16, 0.06, 0.02], [0, 0, 0], [1, 0.8, 1]),
    part(BASE.seed, PALETTE.seed, [-0.14, 0.06, 0.12], [0, 0, 0], [1, 0.8, 1]),
    part(BASE.seed, PALETTE.seed, [0.02, 0.06, -0.17], [0, 0, 0], [1, 0.8, 1]),
    part(BASE.tip, PALETTE.leaf, [0.1, 0.14, 0.1]),
    part(BASE.tip, PALETTE.leaf, [-0.12, 0.12, -0.06], [0, 0, 0.2])
  ],
  () => [
    ...moundParts(),
    part(BASE.stemThin, PALETTE.stem, [0, 0.24, 0]),
    part(BASE.leaf, PALETTE.leaf, [0.15, 0.36, 0], [0, 0, -0.45], [1, 0.28, 0.62]),
    part(BASE.leaf, PALETTE.leaf, [-0.15, 0.26, 0.04], [0, 0.5, 0.45], [1, 0.28, 0.62]),
    part(BASE.bud, PALETTE.leaf, [0, 0.52, 0])
  ],
  () => [
    ...moundParts(),
    part(BASE.stake, PALETTE.wood, [0.2, 0.52, -0.12]),
    part(BASE.stemThick, PALETTE.stem, [0, 0.5, 0]),
    part(BASE.leaf, PALETTE.leaf, [0.24, 0.34, 0], [0, 0, -0.5], [1.1, 0.26, 0.7]),
    part(BASE.leaf, PALETTE.leaf, [-0.26, 0.58, 0.06], [0, 0.6, 0.5], [1.1, 0.26, 0.7]),
    part(BASE.leaf, PALETTE.leaf, [0.2, 0.82, -0.14], [0, 1.2, -0.4], [1.1, 0.26, 0.7]),
    part(BASE.fruit, PALETTE.fruit, [0.14, 0.86, 0.1]),
    part(BASE.fruit, PALETTE.fruit, [-0.15, 0.78, -0.08], [0, 0, 0], [0.85, 0.85, 0.85]),
    part(BASE.fruit, PALETTE.fruit, [0, 1.08, 0], [0, 0, 0], [1.1, 1.1, 1.1])
  ]
];

/** Geometría fusionada por fase, creada una sola vez y compartida. */
const STAGE_GEOMETRY = STAGE_PARTS.map((build) => {
  const parts = build();
  const merged = mergeGeometries(parts, false);
  for (const piece of parts) piece.dispose();
  return merged;
});

const STAGE_MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

export class CropField {
  constructor(capacity = 512) {
    this.group = new THREE.Group();
    this.group.name = 'crops';

    this.meshes = STAGE_GEOMETRY.map((geometry, stage) => {
      const mesh = new THREE.InstancedMesh(geometry, STAGE_MATERIAL, capacity);
      mesh.name = `crops:${CROP_STAGES[stage].name}`;
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.cropStage = stage;
      this.group.add(mesh);
      return mesh;
    });

    this.stageCrops = STAGE_GEOMETRY.map(() => []);
    this.matrix = new THREE.Matrix4();
    this.position = new THREE.Vector3();
    this.scale = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
  }

  /** Reescribe los buffers de instancia a partir de la lista de cultivos. */
  sync(crops) {
    for (const list of this.stageCrops) list.length = 0;

    for (const crop of crops) {
      const stage = THREE.MathUtils.clamp(crop.stage, 0, this.stageCrops.length - 1);
      this.stageCrops[stage].push(crop);
    }

    for (let stage = 0; stage < this.meshes.length; stage += 1) {
      const mesh = this.meshes[stage];
      const list = this.stageCrops[stage];
      const curve = STAGE_CURVES[stage];

      for (let slot = 0; slot < list.length; slot += 1) {
        const crop = list[slot];
        const progress = THREE.MathUtils.clamp(crop.progress, 0, 1);
        const planar = curve.min + (curve.max - curve.min) * progress;
        const vertical = curve.minY + (curve.maxY - curve.minY) * progress;

        this.position.set(crop.x + 0.5, 1, crop.z + 0.5);
        this.scale.set(planar, vertical, planar);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        mesh.setMatrixAt(slot, this.matrix);
      }

      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  /** Cultivo dibujado en un slot concreto de una fase (para el raycast). */
  cropAt(stage, instanceId) {
    const list = this.stageCrops[stage];
    return list && instanceId !== undefined ? list[instanceId] ?? null : null;
  }

  get count() {
    return this.stageCrops.reduce((total, list) => total + list.length, 0);
  }

  dispose() {
    for (const mesh of this.meshes) mesh.dispose();
    for (const geometry of STAGE_GEOMETRY) geometry.dispose();
    STAGE_MATERIAL.dispose();
    this.group.clear();
  }
}
