/**
 * DiggingSystem.js
 * Minado con pico: acumula durabilidad sobre el bloque apuntado (un clic
 * equivale a un punto, mantener pulsado acumula en función del deltaTime) y,
 * al agotarla, destruye el bloque, refresca la malla y suma el drop.
 */

import { BLOCKS, getBlockType } from '../world/BlockTypes.js';
import { MAX_Y } from '../world/WorldGrid.js';

const SECONDS_PER_DURABILITY = 0.35;

export class DiggingSystem {
  constructor({ grid, terrain, hud, onDestroy }) {
    this.grid = grid;
    this.terrain = terrain;
    this.hud = hud;
    this.onDestroy = onDestroy ?? null;
    this.points = 0;
    this.targetKey = '';
    this.block = null;
    this.durability = 0;
    this.strikes = 0;
    this.struckPoints = 0;
  }

  canDig(target) {
    if (!target || target.kind !== 'block') {
      return { ok: false, reason: 'Apunta a un bloque del terreno con el pico' };
    }
    if (target.block.y > MAX_Y) {
      return { ok: false, reason: 'Ese bloque está por encima de la superficie excavable' };
    }
    if (this.grid.getBlock(target.block.x, target.block.y, target.block.z) === BLOCKS.AIR.id) {
      return { ok: false, reason: 'Ese bloque ya no existe' };
    }
    return { ok: true, reason: '' };
  }

  /** Un clic aplica un punto de durabilidad al bloque apuntado. */
  begin(target) {
    const check = this.canDig(target);
    if (!check.ok) return check;

    this.#focus(target);
    this.points += 1;
    this.strikes += 1;
    this.#tryBreak();
    return { ok: true, reason: '' };
  }

  /**
   * Avanza el minado continuo mientras se mantiene el botón pulsado.
   * Devuelve el estado actual para el HUD.
   */
  update(deltaTime, target, holding) {
    if (!holding || !target || target.kind !== 'block') {
      if (!holding) this.#reset();
      return this.state;
    }

    if (this.grid.getBlock(target.block.x, target.block.y, target.block.z) === BLOCKS.AIR.id) {
      this.#reset();
      return this.state;
    }

    this.#focus(target);
    this.points += deltaTime / SECONDS_PER_DURABILITY;

    // Un golpe de herramienta por cada punto de durabilidad acumulado, para
    // que el brazo acompañe al minado continuo en lugar de quedarse quieto.
    const whole = Math.floor(this.points);
    if (whole > this.struckPoints) {
      this.strikes += whole - this.struckPoints;
      this.struckPoints = whole;
    }

    this.#tryBreak();
    return this.state;
  }

  /** Consume un golpe pendiente: devuelve true una sola vez por golpe. */
  consumeStrike() {
    if (this.strikes <= 0) return false;
    this.strikes -= 1;
    return true;
  }

  get state() {
    if (!this.block || this.durability <= 0) {
      return { active: false, progress: 0, remaining: 0, durability: 0, blockName: null };
    }
    const progress = Math.min(1, this.points / this.durability);
    return {
      active: true,
      progress,
      remaining: Math.max(0, this.durability * (1 - progress)),
      durability: this.durability,
      blockName: getBlockType(this.grid.getBlock(this.block.x, this.block.y, this.block.z)).name
    };
  }

  #focus(target) {
    const key = `${target.block.x},${target.block.y},${target.block.z}`;
    if (key === this.targetKey) return;

    this.targetKey = key;
    this.points = 0;
    this.struckPoints = 0;
    this.block = { ...target.block };
    this.durability = Math.max(1, getBlockType(target.id).durability);
  }

  #tryBreak() {
    if (!this.block) return;
    if (this.points < this.durability) return;

    const { x, y, z } = this.block;
    const type = getBlockType(this.grid.getBlock(x, y, z));

    this.grid.setBlock(x, y, z, BLOCKS.AIR.id);
    this.terrain.updateBlock(x, y, z);

    if (type.drop) this.hud.addItem(type.drop, 1);
    this.hud.setMessage(
      type.drop ? `Bloque eliminado · +1 ${type.drop} (${type.name})` : `Bloque eliminado · ${type.name}`
    );

    if (this.onDestroy) this.onDestroy({ x, y, z }, type);

    this.#reset();
  }

  #reset() {
    this.points = 0;
    this.struckPoints = 0;
    this.targetKey = '';
    this.block = null;
    this.durability = 0;
  }
}
