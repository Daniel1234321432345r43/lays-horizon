/**
 * CitySystem.js
 * Modo edificación sobre la capa Y=0:
 *  - Carretera: sustituye la superficie por un bloque ROAD transitable.
 *  - Edificio: ensambla un módulo low-poly modular (cimientos, muros con
 *    ventanas, tejado piramidal y antena) sobre un área de 2x2 celdas.
 * Las geometrías y materiales son compartidos por todos los módulos; cada
 * edificio solo añade un Group al grafo de escena.
 */

import * as THREE from 'three';

import { BLOCKS } from '../world/BlockTypes.js';

const ROAD_LAYER = 0;
const BUILDING_SIZE = 2;
const BUILDING_BASE_Y = 1;

const GEOMETRY = {
  slab: new THREE.BoxGeometry(1.96, 0.18, 1.96),
  wallLong: new THREE.BoxGeometry(1.7, 1.1, 0.12),
  wallShort: new THREE.BoxGeometry(0.12, 1.1, 1.46),
  floor: new THREE.BoxGeometry(1.64, 0.06, 1.64),
  roof: new THREE.ConeGeometry(1.34, 0.78, 4),
  door: new THREE.BoxGeometry(0.42, 0.72, 0.08),
  window: new THREE.BoxGeometry(0.34, 0.42, 0.06),
  planter: new THREE.BoxGeometry(0.46, 0.2, 0.46),
  bush: new THREE.IcosahedronGeometry(0.19, 0),
  mast: new THREE.CylinderGeometry(0.022, 0.022, 0.52, 5),
  beacon: new THREE.SphereGeometry(0.06, 8, 6)
};

const MATERIAL = {
  slab: new THREE.MeshLambertMaterial({ color: 0xa8a296, flatShading: true }),
  floor: new THREE.MeshLambertMaterial({ color: 0x6f6a60, flatShading: true }),
  trim: new THREE.MeshLambertMaterial({ color: 0x8f8b81, flatShading: true }),
  door: new THREE.MeshLambertMaterial({ color: 0x5a4632, flatShading: true }),
  glass: new THREE.MeshLambertMaterial({ color: 0x9fdcff, emissive: 0x2f6f9e, emissiveIntensity: 0.85 }),
  mast: new THREE.MeshLambertMaterial({ color: 0x6d7480, flatShading: true }),
  beacon: new THREE.MeshLambertMaterial({ color: 0xffd166, emissive: 0x8a5a00, emissiveIntensity: 0.7 }),
  bush: new THREE.MeshLambertMaterial({ color: 0x4f9d3a, flatShading: true })
};

const WALL_VARIANTS = [
  new THREE.MeshLambertMaterial({ color: 0xece5d8, flatShading: true }),
  new THREE.MeshLambertMaterial({ color: 0xd9e2ea, flatShading: true }),
  new THREE.MeshLambertMaterial({ color: 0xeadfcb, flatShading: true })
];

const ROOF_VARIANTS = [
  new THREE.MeshLambertMaterial({ color: 0x9c4b3b, flatShading: true }),
  new THREE.MeshLambertMaterial({ color: 0x4f6f8f, flatShading: true }),
  new THREE.MeshLambertMaterial({ color: 0x5f6f4a, flatShading: true })
];

function addPart(parent, geometry, material, position, rotation) {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(position[0], position[1], position[2]);
  if (rotation) part.rotation.set(rotation[0], rotation[1], rotation[2]);
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}

function createBuildingModule(variant) {
  const group = new THREE.Group();
  group.name = 'building';
  const wall = WALL_VARIANTS[variant % WALL_VARIANTS.length];
  const roof = ROOF_VARIANTS[variant % ROOF_VARIANTS.length];

  addPart(group, GEOMETRY.slab, MATERIAL.slab, [0, 0.09, 0]);
  addPart(group, GEOMETRY.floor, MATERIAL.floor, [0, 0.21, 0]);

  addPart(group, GEOMETRY.wallLong, wall, [0, 0.73, 0.79]);
  addPart(group, GEOMETRY.wallLong, wall, [0, 0.73, -0.79]);
  addPart(group, GEOMETRY.wallShort, wall, [-0.79, 0.73, 0]);
  addPart(group, GEOMETRY.wallShort, wall, [0.79, 0.73, 0]);

  addPart(group, GEOMETRY.door, MATERIAL.door, [0, 0.57, 0.86]);
  addPart(group, GEOMETRY.window, MATERIAL.glass, [0.52, 0.86, 0.86]);
  addPart(group, GEOMETRY.window, MATERIAL.glass, [-0.52, 0.86, 0.86]);
  addPart(group, GEOMETRY.window, MATERIAL.glass, [0.86, 0.86, 0.3], [0, Math.PI / 2, 0]);
  addPart(group, GEOMETRY.window, MATERIAL.glass, [-0.86, 0.86, -0.3], [0, Math.PI / 2, 0]);

  addPart(group, GEOMETRY.roof, roof, [0, 1.67, 0], [0, Math.PI / 4, 0]);
  addPart(group, GEOMETRY.mast, MATERIAL.mast, [0.42, 2.28, -0.42]);
  addPart(group, GEOMETRY.beacon, MATERIAL.beacon, [0.42, 2.56, -0.42]);

  addPart(group, GEOMETRY.planter, MATERIAL.trim, [-0.62, 0.28, 0.98]);
  addPart(group, GEOMETRY.bush, MATERIAL.bush, [-0.62, 0.48, 0.98]);
  addPart(group, GEOMETRY.planter, MATERIAL.trim, [0.62, 0.28, 0.98]);
  addPart(group, GEOMETRY.bush, MATERIAL.bush, [0.62, 0.48, 0.98]);

  return group;
}

export class CitySystem {
  constructor({ grid, terrain, hud, isCellFree, getPlayerPosition, onGeometryChange }) {
    this.grid = grid;
    this.terrain = terrain;
    this.hud = hud;
    this.onGeometryChange = onGeometryChange ?? null;
    this.isCellFree = isCellFree ?? (() => true);
    this.getPlayerPosition = getPlayerPosition ?? null;

    this.group = new THREE.Group();
    this.group.name = 'city';
    this.buildings = [];
    this.byCell = new Map();
    this.nextId = 1;
  }

  static cellKey(x, z) {
    return `${x},${z}`;
  }

  isCellOccupiedByBuilding(x, z) {
    return this.byCell.has(CitySystem.cellKey(x, z));
  }

  canPlaceRoad(target) {
    if (!target || target.kind !== 'block') {
      return { ok: false, reason: 'Apunta a una celda de la superficie con la carretera' };
    }
    const { x, y, z } = target.block;
    if (y !== ROAD_LAYER) {
      return { ok: false, reason: 'Las carreteras se colocan en la capa Y=0' };
    }

    const id = this.grid.getBlock(x, y, z);
    if (id === BLOCKS.ROAD.id) {
      return { ok: false, reason: 'Esa celda ya está asfaltada' };
    }
    if (id !== BLOCKS.GRASS.id && id !== BLOCKS.DIRT.id && id !== BLOCKS.TILLED_DIRT.id) {
      return { ok: false, reason: 'Esa superficie no es urbanizable' };
    }
    if (!this.isCellFree(x, z)) {
      return { ok: false, reason: 'Hay un cultivo o una construcción en esa celda' };
    }
    return { ok: true, reason: '' };
  }

  placeRoad(target) {
    const check = this.canPlaceRoad(target);
    if (!check.ok) return check;

    const { x, y, z } = target.block;
    this.grid.setBlock(x, y, z, BLOCKS.ROAD.id);
    this.terrain.updateBlock(x, y, z);
    this.hud.setMessage('Carretera asfaltada');
    return { ok: true, reason: '' };
  }

  canPlaceBuilding(target) {
    if (!target || target.kind !== 'block') {
      return { ok: false, reason: 'Apunta al suelo para anclar el edificio' };
    }
    const { x, y, z } = target.block;
    if (y !== ROAD_LAYER) {
      return { ok: false, reason: 'Los edificios se anclan en la capa Y=0' };
    }

    const cells = [];
    for (let dx = 0; dx < BUILDING_SIZE; dx += 1) {
      for (let dz = 0; dz < BUILDING_SIZE; dz += 1) {
        const cx = x + dx;
        const cz = z + dz;
        if (!this.grid.inBounds(cx, ROAD_LAYER, cz)) {
          return { ok: false, reason: 'El área 2x2 se sale del mapa' };
        }
        if (this.grid.getBlock(cx, ROAD_LAYER, cz) === BLOCKS.AIR.id) {
          return { ok: false, reason: 'Falta suelo firme en el área 2x2' };
        }
        if (!this.isCellFree(cx, cz)) {
          return { ok: false, reason: 'El área 2x2 debe estar libre de cultivos y obras' };
        }
        cells.push({ x: cx, z: cz });
      }
    }

    const player = this.getPlayerPosition ? this.getPlayerPosition() : null;
    if (player) {
      const px = Math.floor(player.x);
      const pz = Math.floor(player.z);
      if (cells.some((cell) => cell.x === px && cell.z === pz)) {
        return { ok: false, reason: 'No puedes construir encima de ti mismo' };
      }
    }

    return { ok: true, reason: '', cells };
  }

  placeBuilding(target) {
    const check = this.canPlaceBuilding(target);
    if (!check.ok) return check;

    const { x, z } = target.block;
    const module = createBuildingModule(this.nextId);
    module.position.set(x + 1, BUILDING_BASE_Y, z + 1);
    this.group.add(module);

    const record = {
      id: this.nextId,
      kind: 'building',
      cells: check.cells,
      group: module
    };
    this.nextId += 1;

    module.userData.pickOwner = { kind: 'building', building: record };
    this.buildings.push(record);
    for (const cell of check.cells) {
      this.byCell.set(CitySystem.cellKey(cell.x, cell.z), record);
    }

    if (this.onGeometryChange) this.onGeometryChange();
    this.hud.setMessage(`Edificio #${record.id} construido (2x2)`);
    return { ok: true, reason: '' };
  }

  /**
   * Desmontar una construcción con el pico: libera sus celdas y devuelve
   * parte de los materiales empleados.
   */
  canDemolish(target, toolId) {
    if (!target || target.kind !== 'building') {
      return { ok: false, reason: 'Apunta a una construcción existente' };
    }
    if (toolId !== 'pickaxe') {
      return { ok: false, reason: 'Usa el pico para desmontar la construcción' };
    }
    return { ok: true, reason: '' };
  }

  demolish(building) {
    const index = this.buildings.indexOf(building);
    if (index < 0) return { ok: false, reason: 'Esa construcción ya no existe' };

    this.buildings.splice(index, 1);
    for (const cell of building.cells) {
      this.byCell.delete(CitySystem.cellKey(cell.x, cell.z));
    }
    this.group.remove(building.group);
    if (this.onGeometryChange) this.onGeometryChange();

    this.hud.addItem('Piedra', 2);
    this.hud.addItem('Tierra', 1);
    this.hud.setMessage(`Edificio #${building.id} desmontado · +2 Piedra, +1 Tierra`);
    return { ok: true, reason: '' };
  }
}
