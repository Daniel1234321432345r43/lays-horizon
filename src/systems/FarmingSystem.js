/**
 * FarmingSystem.js
 * Máquina de estados de agricultura:
 *  1. La azada convierte césped (Y=0) en tierra arada.
 *  2. Las semillas plantan un cultivo sobre la tierra arada.
 *  3. Un temporizador por cultivo avanza las fases Semilla -> Brote -> Madura
 *     mientras la malla escala de forma continua.
 *  4. Un clic sobre una planta madura la cosecha y restablece la tierra.
 */

import * as THREE from 'three';

import { BLOCKS } from '../world/BlockTypes.js';
import { CROP_STAGES, CropField } from '../entities/Crops.js';

const SOIL_LAYER = 0;

export class FarmingSystem {
  constructor({ grid, terrain, hud, onGeometryChange }) {
    this.grid = grid;
    this.terrain = terrain;
    this.hud = hud;
    this.onGeometryChange = onGeometryChange ?? null;
    this.field = new CropField();
    this.group = this.field.group;
    this.crops = [];
    this.byCell = new Map();
  }

  static cellKey(x, z) {
    return `${x},${z}`;
  }

  isCellFree(x, z) {
    return !this.byCell.has(FarmingSystem.cellKey(x, z));
  }

  getCropAt(x, z) {
    return this.byCell.get(FarmingSystem.cellKey(x, z)) ?? null;
  }

  /** Comprueba si la azada puede actuar sobre el objetivo. */
  canTill(target) {
    if (!target || target.kind !== 'block') {
      return { ok: false, reason: 'Apunta a un bloque de terreno con la azada' };
    }
    const { x, y, z } = target.block;
    if (y !== SOIL_LAYER) {
      return { ok: false, reason: 'Solo se labra la capa Y=0' };
    }
    if (this.grid.getBlock(x, y, z) !== BLOCKS.GRASS.id) {
      return { ok: false, reason: 'Solo el césped se convierte en tierra arada' };
    }
    return { ok: true, reason: '' };
  }

  till(target) {
    const check = this.canTill(target);
    if (!check.ok) return check;

    const { x, y, z } = target.block;
    this.grid.setBlock(x, y, z, BLOCKS.TILLED_DIRT.id);
    this.terrain.updateBlock(x, y, z);
    this.hud.setMessage('Tierra labrada: lista para sembrar');
    return { ok: true, reason: '' };
  }

  /** Comprueba si se puede plantar en la celda apuntada. */
  canPlant(target) {
    if (!target || target.kind !== 'block') {
      return { ok: false, reason: 'Apunta a la tierra arada con las semillas' };
    }
    const { x, y, z } = target.block;
    if (y !== SOIL_LAYER) {
      return { ok: false, reason: 'Los cultivos se plantan en la capa Y=0' };
    }
    const id = this.grid.getBlock(x, y, z);
    if (id === BLOCKS.TILLED_DIRT.id) {
      if (!this.isCellFree(x, z)) {
        return { ok: false, reason: 'Esa celda ya tiene un cultivo' };
      }
      return { ok: true, reason: '' };
    }
    if (id === BLOCKS.GRASS.id) {
      return { ok: false, reason: 'Labra el césped con la azada antes de sembrar' };
    }
    return { ok: false, reason: 'Las semillas necesitan tierra arada (Y=0)' };
  }

  plant(target) {
    const check = this.canPlant(target);
    if (!check.ok) return check;

    const { x, z } = target.block;
    const crop = { x, z, stage: 0, timer: 0, progress: 0, notifiedProgress: 0 };

    this.crops.push(crop);
    this.byCell.set(FarmingSystem.cellKey(x, z), crop);
    this.field.sync(this.crops);
    this.#notifyGeometry();
    this.hud.setMessage('Semilla plantada: crecerá en unos segundos');
    return { ok: true, reason: '' };
  }

  /** Avanza los temporizadores de crecimiento y actualiza la escala visual. */
  update(deltaTime) {
    let changed = false;
    for (const crop of this.crops) {
      const stageBefore = crop.stage;
      if (crop.stage < CROP_STAGES.length - 1) {
        crop.timer += deltaTime;
        let stage = CROP_STAGES[crop.stage];
        while (crop.stage < CROP_STAGES.length - 1 && crop.timer >= stage.seconds) {
          crop.timer -= stage.seconds;
          crop.stage += 1;
          stage = CROP_STAGES[crop.stage];
        }
      }

      const current = CROP_STAGES[crop.stage];
      crop.progress = Number.isFinite(current.seconds)
        ? THREE.MathUtils.clamp(crop.timer / current.seconds, 0, 1)
        : 1;

      // Solo se avisa de cambio si la planta se movió de fase o si la escala
      // varió lo suficiente para verse: el crecimiento no tiene que rehacer el
      // mapa de sombras en cada frame mientras haya cultivos. La comparación va
      // contra el último valor avisado, no contra el frame anterior, porque el
      // avance de un solo frame es siempre menor que el umbral.
      if (crop.stage !== stageBefore || Math.abs(crop.progress - crop.notifiedProgress) > 0.02) {
        crop.notifiedProgress = crop.progress;
        changed = true;
      }
    }

    this.field.sync(this.crops);
    if (changed) this.#notifyGeometry();
  }

  isMature(crop) {
    return Boolean(crop) && crop.stage === CROP_STAGES.length - 1;
  }

  /** Traduce un impacto del raycast sobre una fase instanciada a su cultivo. */
  getCropByInstance(stage, instanceId) {
    return this.field.cropAt(stage, instanceId);
  }

  /** Cosecha una planta madura: suma alimento y restablece la tierra. */
  harvest(crop) {
    if (!crop) return { ok: false, reason: 'No hay cultivo que cosechar' };
    if (!this.isMature(crop)) {
      return { ok: false, reason: `El cultivo está en fase ${CROP_STAGES[crop.stage].name}` };
    }

    this.#detach(crop);
    this.grid.setBlock(crop.x, SOIL_LAYER, crop.z, BLOCKS.TILLED_DIRT.id);
    this.terrain.updateBlock(crop.x, SOIL_LAYER, crop.z);
    this.hud.addItem('Alimento', 1);
    this.hud.setMessage('¡Cosecha recogida! +1 Alimento');
    return { ok: true, reason: '' };
  }

  /**
   * Elimina el cultivo de una celda, pero solo si el bloque destruido es su
   * propia tierra (capa Y=0). Minar galerías por debajo no debe matar la planta.
   */
  removeAt(x, y, z) {
    if (y !== SOIL_LAYER) return false;
    const crop = this.getCropAt(x, z);
    if (!crop) return false;
    this.#detach(crop);
    return true;
  }

  /** Describe el estado del cultivo apuntado para el HUD. */
  describe(crop) {
    if (!crop) return '—';
    const stage = CROP_STAGES[crop.stage];
    if (this.isMature(crop)) return `${stage.name} · lista para cosechar`;
    return `${stage.name} · ${Math.round(crop.progress * 100)}%`;
  }

  #detach(crop) {
    const index = this.crops.indexOf(crop);
    if (index >= 0) this.crops.splice(index, 1);
    this.byCell.delete(FarmingSystem.cellKey(crop.x, crop.z));
    this.field.sync(this.crops);
    this.#notifyGeometry();
  }

  #notifyGeometry() {
    if (this.onGeometryChange) this.onGeometryChange();
  }
}
