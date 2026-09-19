/**
 * WorldGrid.js
 * Rejilla cúbica de 30 x 6 x 30 almacenada en un Uint8Array.
 * Las capas útiles van de Y = 0 (superficie) a Y = -5 (roca profunda).
 */

import { BLOCKS } from './BlockTypes.js';

export const SIZE_X = 30;
export const SIZE_Y = 6;
export const SIZE_Z = 30;

export const MIN_Y = -5;
export const MAX_Y = 0;

/** Esquina mínima del volumen en coordenadas de mundo. */
export const ORIGIN_X = -Math.floor(SIZE_X / 2);
export const ORIGIN_Z = -Math.floor(SIZE_Z / 2);

export const TOTAL_BLOCKS = SIZE_X * SIZE_Y * SIZE_Z;

const LAYER_STRIDE = SIZE_X * SIZE_Z;

export class WorldGrid {
  constructor() {
    this.sizeX = SIZE_X;
    this.sizeY = SIZE_Y;
    this.sizeZ = SIZE_Z;
    this.minY = MIN_Y;
    this.maxY = MAX_Y;
    this.data = new Uint8Array(TOTAL_BLOCKS);
  }

  /** Convierte coordenadas de mundo (con Y negativa) a índice unidimensional. */
  getIndex(x, y, z) {
    const lx = x - ORIGIN_X;
    const ly = y - MIN_Y;
    const lz = z - ORIGIN_Z;
    return ly * LAYER_STRIDE + lz * SIZE_X + lx;
  }

  inBounds(x, y, z) {
    return (
      x >= ORIGIN_X &&
      x < ORIGIN_X + SIZE_X &&
      z >= ORIGIN_Z &&
      z < ORIGIN_Z + SIZE_Z &&
      y >= MIN_Y &&
      y <= MAX_Y
    );
  }

  /** ID del bloque; 0 (AIR) cuando la coordenada cae fuera del mapa. */
  getBlock(x, y, z) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return BLOCKS.AIR.id;
    if (!this.inBounds(x, y, z)) return BLOCKS.AIR.id;
    return this.data[this.getIndex(x, y, z)];
  }

  /** Escribe un bloque. Devuelve false si la coordenada está fuera del mapa. */
  setBlock(x, y, z, typeId) {
    if (!this.inBounds(x, y, z)) return false;
    this.data[this.getIndex(x, y, z)] = typeId;
    return true;
  }

  /** true cuando la celda contiene cualquier bloque distinto de AIR. */
  isSolid(x, y, z) {
    return this.getBlock(x, y, z) !== BLOCKS.AIR.id;
  }

  /** Recorre la rejilla completa llamando a callback(x, y, z, id). */
  forEach(callback) {
    for (let ly = 0; ly < SIZE_Y; ly += 1) {
      const y = MIN_Y + ly;
      for (let lz = 0; lz < SIZE_Z; lz += 1) {
        const z = ORIGIN_Z + lz;
        for (let lx = 0; lx < SIZE_X; lx += 1) {
          const x = ORIGIN_X + lx;
          callback(x, y, z, this.data[ly * LAYER_STRIDE + lz * SIZE_X + lx]);
        }
      }
    }
  }

  /** Estratigrafía inicial: césped, tierra, piedra y roca profunda. */
  generateTerrain() {
    this.forEach((x, y, z) => {
      let id = BLOCKS.DEEP_STONE.id;
      if (y === 0) id = BLOCKS.GRASS.id;
      else if (y === -1) id = BLOCKS.DIRT.id;
      else if (y === -2 || y === -3) id = BLOCKS.STONE.id;
      this.setBlock(x, y, z, id);
    });
    return this;
  }
}
