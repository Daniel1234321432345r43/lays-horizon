/**
 * BlockTypes.js
 * Diccionario de datos de bloques: identificadores, color, caras, durabilidad
 * y drop. No contiene lógica de render ni de rejilla, solo datos inmutables.
 *
 * `color` es el color primario del bloque (el del bloque completo en el
 * inventario y el de su cara superior). `faces` permite que cada cara tenga su
 * propio color: es lo que hace que el césped sea verde arriba y tierra en los
 * lados, como en un vóxel clásico.
 */

export const BLOCKS = Object.freeze({
  AIR: Object.freeze({
    id: 0,
    key: 'AIR',
    name: 'Aire',
    color: 0x000000,
    durability: 0,
    drop: null,
    solid: false,
    faces: Object.freeze({ top: 0x000000, side: 0x000000, bottom: 0x000000 })
  }),
  GRASS: Object.freeze({
    id: 1,
    key: 'GRASS',
    name: 'Césped',
    color: 0x55aa55,
    durability: 1,
    drop: 'Tierra',
    solid: true,
    faces: Object.freeze({ top: 0x55aa55, side: 0x7a5230, bottom: 0x67442a })
  }),
  DIRT: Object.freeze({
    id: 2,
    key: 'DIRT',
    name: 'Tierra',
    color: 0x7a5230,
    durability: 2,
    drop: 'Tierra',
    solid: true,
    faces: Object.freeze({ top: 0x7f5734, side: 0x7a5230, bottom: 0x66432a })
  }),
  STONE: Object.freeze({
    id: 3,
    key: 'STONE',
    name: 'Piedra',
    color: 0x666666,
    durability: 4,
    drop: 'Piedra',
    solid: true,
    faces: Object.freeze({ top: 0x6d6d6d, side: 0x666666, bottom: 0x575757 })
  }),
  DEEP_STONE: Object.freeze({
    id: 4,
    key: 'DEEP_STONE',
    name: 'Roca profunda',
    color: 0x333333,
    durability: 8,
    drop: 'Mineral',
    solid: true,
    faces: Object.freeze({ top: 0x3a3a3a, side: 0x333333, bottom: 0x272727 })
  }),
  TILLED_DIRT: Object.freeze({
    id: 5,
    key: 'TILLED_DIRT',
    name: 'Tierra arada',
    color: 0x4a321a,
    durability: 2,
    drop: 'Tierra',
    solid: true,
    faces: Object.freeze({ top: 0x4a321a, side: 0x7a5230, bottom: 0x66432a })
  }),
  ROAD: Object.freeze({
    id: 6,
    key: 'ROAD',
    name: 'Carretera',
    color: 0x222225,
    durability: 3,
    drop: 'Piedra',
    solid: true,
    faces: Object.freeze({ top: 0x242427, side: 0x222225, bottom: 0x171719 })
  })
});

export const BLOCK_LIST = Object.freeze(Object.values(BLOCKS));

const BLOCK_BY_ID = new Map(BLOCK_LIST.map((block) => [block.id, block]));

/** Devuelve la definición del bloque por ID; AIR si el ID es desconocido. */
export function getBlockType(id) {
  return BLOCK_BY_ID.get(id) ?? BLOCKS.AIR;
}

/** Colores por cara de un bloque, con el color base como respaldo. */
export function getBlockFaces(id) {
  const type = getBlockType(id);
  return type.faces ?? { top: type.color, side: type.color, bottom: type.color };
}

/** Identificadores que deben tener un InstancedMesh propio en el renderer. */
export const RENDERABLE_BLOCK_IDS = Object.freeze(
  BLOCK_LIST.filter((block) => block.solid).map((block) => block.id)
);

/** Etiquetas de drop usadas por el inventario del HUD. */
export const DROPS = Object.freeze({
  TIERRA: 'Tierra',
  PIEDRA: 'Piedra',
  MINERAL: 'Mineral',
  ALIMENTO: 'Alimento'
});
