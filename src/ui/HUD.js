/**
 * HUD.js
 * Interfaz de usuario creada dinámicamente sobre el canvas: hotbar de
 * herramientas (teclas 1-5), panel de estado (capa Y, objetivo y durabilidad
 * del bloque) e inventario en tiempo real.
 */

/** Iconos vectoriales en linea: no dependen de fuentes de emoji del sistema. */
function svgIcon(body, options = {}) {
  const fill = options.fill ?? 'none';
  const strokeWidth = options.strokeWidth ?? 1.6;
  return (
    `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="${strokeWidth}" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
  );
}

const ICONS = Object.freeze({
  pickaxe: svgIcon(
    '<path d="M4.5 19.5 L14 10"/><path d="M7 7.5 Q12.5 2.5 18.5 8.5"/>' +
      '<path d="M5 9.5 L7 7.5"/><path d="M16.5 6.5 L18.5 8.5"/>'
  ),
  hoe: svgIcon('<path d="M4.5 19.5 L13.5 10.5"/><path d="M12 8 L19 4.5 L21 8 L14 11.5 Z"/>'),
  seeds: svgIcon(
    '<path d="M12 20.5 V11"/><path d="M12 12 Q6.5 11.5 5.5 6 Q11 6.5 12 12 Z"/>' +
      '<path d="M12 14.5 Q18 14 19 8.5 Q13.5 9 12 14.5 Z"/><circle cx="5.5" cy="19" r="1.3"/>' +
      '<circle cx="18.5" cy="19" r="1.3"/>'
  ),
  road: svgIcon(
    '<path d="M4 20 L9 4 H15 L20 20 Z"/><path d="M12 7 V10 M12 13 V16 M12 18 V19.5"/>'
  ),
  building: svgIcon(
    '<path d="M4 20 V9.5 L10.5 7 V20"/><path d="M10.5 20 V4 L20 6.5 V20"/><path d="M3 20 H21"/>' +
      '<path d="M6.3 12.5 H8.2 M6.3 16 H8.2 M13 10 H15 M13 13.5 H15 M13 17 H15"/>'
  ),
  dirt: svgIcon(
    '<path d="M4 12.5 H20 V17 A2.5 2.5 0 0 1 17.5 19.5 H6.5 A2.5 2.5 0 0 1 4 17 Z"/>' +
      '<path d="M6.5 12.5 Q12 4.5 17.5 12.5"/><path d="M8.5 16 H9.6 M13 16 H14.1"/>'
  ),
  stone: svgIcon('<path d="M6 19 L3.5 11 L9.5 5 L18.5 7.5 L20.5 16 L14 20 Z"/><path d="M9.5 5 L11.5 12 L14 20"/>'),
  mineral: svgIcon('<path d="M12 3.5 L20 12 L12 20.5 L4 12 Z"/><path d="M12 3.5 V20.5 M4 12 H20"/>'),
  alimento: svgIcon(
    '<path d="M12 8.5 Q12.6 4.5 15.8 4.5"/>' +
      '<path d="M12 8.5 C7.4 8.5 5 11.4 5 14.4 C5 18.3 8.4 20.5 12 20.5 C15.6 20.5 19 18.3 19 14.4 C19 11.4 16.6 8.5 12 8.5 Z"/>'
  )
});

export const TOOLS = Object.freeze([
  Object.freeze({
    id: 'pickaxe',
    key: '1',
    code: 'Digit1',
    label: 'Pico',
    icon: ICONS.pickaxe,
    hint: 'Minar bloques expuestos · clic o mantén pulsado'
  }),
  Object.freeze({
    id: 'hoe',
    key: '2',
    code: 'Digit2',
    label: 'Azada',
    icon: ICONS.hoe,
    hint: 'Labrar césped de la capa Y=0'
  }),
  Object.freeze({
    id: 'seeds',
    key: '3',
    code: 'Digit3',
    label: 'Semillas',
    icon: ICONS.seeds,
    hint: 'Sembrar sobre tierra arada'
  }),
  Object.freeze({
    id: 'road',
    key: '4',
    code: 'Digit4',
    label: 'Carretera',
    icon: ICONS.road,
    hint: 'Asfaltar celdas libres en Y=0'
  }),
  Object.freeze({
    id: 'building',
    key: '5',
    code: 'Digit5',
    label: 'Edificio',
    icon: ICONS.building,
    hint: 'Construir un módulo sobre un área 2x2'
  })
]);

const ITEMS = Object.freeze([
  Object.freeze({ key: 'tierra', label: 'Tierra', icon: ICONS.dirt }),
  Object.freeze({ key: 'piedra', label: 'Piedra', icon: ICONS.stone }),
  Object.freeze({ key: 'mineral', label: 'Mineral', icon: ICONS.mineral }),
  Object.freeze({ key: 'alimento', label: 'Alimento', icon: ICONS.alimento })
]);

const DROP_TO_ITEM = Object.freeze({
  Tierra: 'tierra',
  Piedra: 'piedra',
  Mineral: 'mineral',
  Alimento: 'alimento'
});

const STYLE_ID = 'lays-horizon-hud';

const CSS = `
#hud { font-family: 'Segoe UI', 'Trebuchet MS', system-ui, sans-serif; color: #f2f6f8; }

/* Los paneles capturan el puntero: un clic sobre la interfaz no debe
   atravesarla y minar el bloque que queda detrás. */
.lh-panel {
  position: absolute;
  pointer-events: auto;
  background: rgba(12, 18, 24, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  padding: 10px 12px;
  backdrop-filter: blur(6px);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32);
  font-size: 12px;
  line-height: 1.5;
  letter-spacing: 0.2px;
}

.lh-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #8ee27a;
  margin-bottom: 6px;
}

#hud-status { top: 16px; left: 16px; width: min(276px, calc(50vw - 22px)); }
#hud-inventory { top: 16px; right: 16px; width: min(194px, calc(44vw - 22px)); }

.lh-row { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
.lh-label { flex: 0 0 auto; opacity: 0.62; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
.lh-value { flex: 1 1 auto; min-width: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere; }
.lh-value.small { font-size: 11px; font-weight: 500; opacity: 0.92; }

.lh-bar {
  margin-top: 8px;
  height: 6px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.14);
  overflow: hidden;
}
.lh-bar > div {
  height: 100%;
  width: 0%;
  border-radius: 99px;
  background: #8ee27a;
  transition: width 90ms linear, background 140ms linear;
}
.lh-bar.invalid > div { background: #f05a5a; }
.lh-bar[data-mode='growth'] > div { background: #f2c14e; }
.lh-bar[data-mode='mature'] > div { background: #8ee27a; }

.lh-perf {
  margin-top: 7px;
  font-size: 9.5px;
  letter-spacing: 0.3px;
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}

.lh-message {
  margin-top: 8px;
  min-height: 16px;
  font-size: 11px;
  color: #ffe9a8;
  opacity: 0;
  transition: opacity 200ms linear;
}
.lh-message.show { opacity: 1; }

.lh-hint {
  margin-top: 8px;
  font-size: 10.5px;
  opacity: 0.68;
}

.lh-item { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.lh-icon { width: 16px; height: 16px; flex: 0 0 auto; color: #d7e6f2; opacity: 0.9; }
.lh-item[data-item='tierra'] .lh-icon { color: #b8804c; }
.lh-item[data-item='piedra'] .lh-icon { color: #b9c2cb; }
.lh-item[data-item='mineral'] .lh-icon { color: #7fd8ff; }
.lh-item[data-item='alimento'] .lh-icon { color: #f0a04b; }
.lh-icon svg { display: block; width: 100%; height: 100%; }
.lh-item .lh-count { margin-left: auto; font-weight: 700; font-variant-numeric: tabular-nums; }
.lh-item.bump .lh-count { animation: lh-bump 320ms ease-out; }

@keyframes lh-bump {
  0% { transform: scale(1); color: #ffffff; }
  40% { transform: scale(1.35); color: #8ee27a; }
  100% { transform: scale(1); color: #ffffff; }
}

#hud-hotbar {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  padding: 8px;
  /* Ancho explícito: un elemento absoluto se encoge a su contenido y las
     etiquetas acababan cortadas con puntos suspensivos. */
  width: min(560px, calc(100vw - 20px));
}

.lh-slot {
  pointer-events: auto;
  cursor: pointer;
  flex: 1 1 0;
  min-width: 0;
  max-width: 104px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.05);
  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
}
.lh-slot:hover { transform: translateY(-3px); background: rgba(255, 255, 255, 0.12); }
.lh-slot.active {
  border-color: #8ee27a;
  background: rgba(142, 226, 122, 0.18);
  box-shadow: 0 0 0 1px rgba(142, 226, 122, 0.45), 0 8px 18px rgba(0, 0, 0, 0.35);
}
.lh-slot .lh-slot-icon { width: 22px; height: 22px; color: #cfe8ff; }
.lh-slot .lh-slot-icon svg { display: block; width: 100%; height: 100%; }
.lh-slot.active .lh-slot-icon { color: #8ee27a; }
.lh-slot .lh-slot-name {
  font-size: 11px;
  font-weight: 600;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lh-slot .lh-slot-key {
  font-size: 9.5px;
  opacity: 0.62;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 4px;
  padding: 0 4px;
}

#hud-help {
  position: absolute;
  left: 16px;
  bottom: 108px;
  max-width: min(340px, calc(100vw - 32px));
  font-size: 11px;
  opacity: 0.82;
}
#hud-help b { color: #8ee27a; }

.lh-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  gap: 8px;
}

.lh-perspective-btn {
  pointer-events: auto;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 6px;
  border: 1px solid rgba(142, 226, 122, 0.45);
  background: rgba(142, 226, 122, 0.15);
  color: #f2f6f8;
  font-size: 10px;
  font-weight: 600;
  transition: all 120ms ease;
  font-family: inherit;
  outline: none;
}
.lh-perspective-btn:hover {
  background: rgba(142, 226, 122, 0.3);
  border-color: #8ee27a;
  transform: translateY(-1px);
}
.lh-perspective-btn.first-person {
  border-color: #7fd8ff;
  background: rgba(127, 216, 255, 0.22);
  color: #e6f7ff;
}
.lh-perspective-btn .lh-cam-key {
  font-size: 8.5px;
  opacity: 0.8;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 3px;
  padding: 0 3px;
  background: rgba(0, 0, 0, 0.25);
}

#hud-crosshair {
  position: fixed;
  top: 50%;
  left: 50%;
  width: 16px;
  height: 16px;
  transform: translate(-50%, -50%);
  pointer-events: none;
  display: none;
  z-index: 100;
}
#hud-crosshair.active {
  display: block;
}
#hud-crosshair .ch-line {
  position: absolute;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.9);
  border-radius: 1px;
  transition: background 100ms ease, box-shadow 100ms ease;
}
#hud-crosshair .ch-h {
  top: 7px;
  left: 0;
  width: 16px;
  height: 2px;
}
#hud-crosshair .ch-v {
  top: 0;
  left: 7px;
  width: 2px;
  height: 16px;
}
#hud-crosshair.valid .ch-line {
  background: #8ee27a;
  box-shadow: 0 0 6px rgba(142, 226, 122, 0.9);
}

@media (max-width: 560px) {
  .lh-panel { padding: 8px 9px; font-size: 10.5px; border-radius: 10px; }
  .lh-title { font-size: 10.5px; letter-spacing: 1.1px; margin-bottom: 4px; }
  .lh-label { font-size: 8.5px; letter-spacing: 0.3px; }
  .lh-value.small { font-size: 10px; }
  .lh-bar { margin-top: 6px; height: 5px; }
  #hud-status { top: 10px; left: 10px; width: min(276px, calc(50vw - 16px)); }
  #hud-inventory { top: 10px; right: 10px; width: min(194px, calc(44vw - 16px)); }
  .lh-slot { padding: 6px 3px; }
  .lh-slot .lh-slot-icon { width: 18px; height: 18px; }
  .lh-slot .lh-slot-name { font-size: 9px; }
  #hud-hotbar { bottom: 10px; gap: 5px; padding: 5px; width: calc(100vw - 14px); }
  #hud-help { left: 10px; bottom: 84px; font-size: 9.5px; max-width: calc(100vw - 20px); }
}
`;

export class HUD {
  constructor(root) {
    this.root = root ?? document.body;
    this.inventory = { tierra: 0, piedra: 0, mineral: 0, alimento: 0 };
    this.activeIndex = 0;
    this.toolListeners = [];
    this.perspectiveListeners = [];
    this.messageTimer = null;
    this.lastStatus = {};

    this.#injectStyles();
    this.#buildDom();
    this.#bindKeys();
    this.#renderInventory();
    this.selectToolIndex(0, true);
  }

  getActiveTool() {
    return TOOLS[this.activeIndex];
  }

  /** Registra un callback invocado en cada cambio de herramienta. */
  onToolChange(listener) {
    this.toolListeners.push(listener);
    listener(this.getActiveTool());
  }

  selectToolIndex(index, silent = false) {
    const clamped = Math.max(0, Math.min(TOOLS.length - 1, index));
    const changed = clamped !== this.activeIndex;
    this.activeIndex = clamped;

    for (let i = 0; i < this.slots.length; i += 1) {
      this.slots[i].classList.toggle('active', i === clamped);
    }

    if (changed || !silent) {
      for (const listener of this.toolListeners) listener(this.getActiveTool());
    }
    return this.getActiveTool();
  }

  selectToolById(id) {
    const index = TOOLS.findIndex((tool) => tool.id === id);
    return index >= 0 ? this.selectToolIndex(index) : this.getActiveTool();
  }

  /** Suma unidades al inventario según la etiqueta de drop del bloque. */
  addItem(label, quantity = 1) {
    const key = DROP_TO_ITEM[label];
    if (!key) return this.inventory;
    this.inventory[key] += quantity;
    this.#renderInventory(key);
    return this.inventory;
  }

  getInventory() {
    return { ...this.inventory };
  }

  /** Refresca el panel de estado (modo, capa, objetivo y durabilidad). */
  setStatus(state) {
    const merged = { ...this.lastStatus, ...state };
    this.lastStatus = merged;

    const tool = this.getActiveTool();
    this.#write(this.els.mode, merged.mode ?? `${tool.label} · ${tool.hint.replace(/ ·.*$/, '')}`);
    this.#write(this.els.layer, merged.layer ?? '—');
    this.#write(this.els.target, merged.target ?? '—');
    this.#write(this.els.durability, merged.durability ?? '—');
    this.#write(this.els.hint, merged.hint ?? tool.hint);

    const progress = Math.max(0, Math.min(1, merged.progress ?? 0));
    this.els.barFill.style.width = `${(progress * 100).toFixed(1)}%`;
    this.els.bar.dataset.mode = merged.barMode ?? 'mine';
    this.els.bar.classList.toggle('invalid', merged.valid === false);
  }

  /** Línea de rendimiento (fps, draw calls e instancias visibles). */
  setPerf(text) {
    this.#write(this.els.perf, text);
  }

  /** Mensaje temporal en el panel de estado. */
  setMessage(text, duration = 2600) {
    if (!text) return;
    this.els.message.textContent = text;
    this.els.message.classList.add('show');
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.els.message.classList.remove('show');
    }, duration);
  }

  #injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  #buildDom() {
    this.panel = document.createElement('div');
    this.panel.id = 'hud-panels';
    this.panel.innerHTML = `
      <div id="hud-status" class="lh-panel">
        <div class="lh-title-row">
          <div class="lh-title" style="margin-bottom:0;">Lays Horizon</div>
          <button type="button" id="lh-cam-btn" class="lh-perspective-btn" title="Cambiar perspectiva (Tecla V)">
            <span class="lh-cam-icon">👁️</span>
            <span id="lh-cam-label">3ª Persona</span>
            <span class="lh-cam-key">V</span>
          </button>
        </div>
        <div class="lh-row"><span class="lh-label">Modo</span><span class="lh-value small" id="lh-mode">Pico</span></div>
        <div class="lh-row"><span class="lh-label">Capa Y</span><span class="lh-value small" id="lh-layer">—</span></div>
        <div class="lh-row"><span class="lh-label">Objetivo</span><span class="lh-value small" id="lh-target">—</span></div>
        <div class="lh-row"><span class="lh-label">Durabilidad</span><span class="lh-value small" id="lh-durability">—</span></div>
        <div class="lh-bar" id="lh-bar"><div id="lh-bar-fill"></div></div>
        <div class="lh-message" id="lh-message"></div>
        <div class="lh-hint" id="lh-hint"></div>
        <div class="lh-perf" id="lh-perf"></div>
      </div>
      <div id="hud-inventory" class="lh-panel">
        <div class="lh-title">Inventario</div>
        <div id="lh-items"></div>
      </div>
    `;

    this.hotbar = document.createElement('div');
    this.hotbar.id = 'hud-hotbar';
    this.hotbar.className = 'lh-panel';

    this.help = document.createElement('div');
    this.help.id = 'hud-help';
    this.help.className = 'lh-panel';
    this.help.innerHTML =
      '<b>WASD</b> mover · <b>Espacio</b> saltar · <b>Shift</b> correr · <b>V</b> perspectiva (1ª/3ª) · ' +
      '<b>1-5</b> herramienta · <b>Clic</b> usar (mantén para minar) · <b>R</b> rescatar';

    this.slots = [];
    TOOLS.forEach((tool, index) => {
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'lh-slot';
      slot.title = `${tool.label} — ${tool.hint}`;
      slot.innerHTML = `
        <span class="lh-slot-icon">${tool.icon}</span>
        <span class="lh-slot-name">${tool.label}</span>
        <span class="lh-slot-key">${tool.key}</span>
      `;
      slot.addEventListener('click', () => this.selectToolIndex(index));
      this.hotbar.appendChild(slot);
      this.slots.push(slot);
    });

    this.crosshair = document.createElement('div');
    this.crosshair.id = 'hud-crosshair';
    this.crosshair.innerHTML = '<div class="ch-line ch-h"></div><div class="ch-line ch-v"></div>';

    this.root.append(this.panel, this.help, this.hotbar, this.crosshair);

    this.camBtn = this.panel.querySelector('#lh-cam-btn');
    this.camLabel = this.panel.querySelector('#lh-cam-label');

    if (this.camBtn) {
      this.camBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        for (const listener of this.perspectiveListeners) listener();
      });
    }

    this.els = {
      mode: this.panel.querySelector('#lh-mode'),
      layer: this.panel.querySelector('#lh-layer'),
      target: this.panel.querySelector('#lh-target'),
      durability: this.panel.querySelector('#lh-durability'),
      message: this.panel.querySelector('#lh-message'),
      hint: this.panel.querySelector('#lh-hint'),
      perf: this.panel.querySelector('#lh-perf'),
      bar: this.panel.querySelector('#lh-bar'),
      barFill: this.panel.querySelector('#lh-bar-fill'),
      items: this.panel.querySelector('#lh-items')
    };

    this.itemEls = new Map();
    for (const item of ITEMS) {
      const row = document.createElement('div');
      row.className = 'lh-item';
      row.dataset.item = item.key;
      row.innerHTML = `
        <span class="lh-icon">${item.icon}</span>
        <span>${item.label}</span>
        <span class="lh-count" id="lh-count-${item.key}">0</span>
      `;
      this.els.items.appendChild(row);
      this.itemEls.set(item.key, { row, count: row.querySelector('.lh-count') });
    }
  }

  #renderInventory(bumpedKey) {
    for (const [key, entry] of this.itemEls) {
      this.#write(entry.count, String(this.inventory[key]));
      if (key === bumpedKey) {
        entry.row.classList.remove('bump');
        void entry.row.offsetWidth;
        entry.row.classList.add('bump');
      }
    }
  }

  #bindKeys() {
    this.handleKeyDown = (event) => {
      const tool = TOOLS.find((entry) => entry.code === event.code);
      if (!tool) return;
      event.preventDefault();
      this.selectToolById(tool.id);
    };
    window.addEventListener('keydown', this.handleKeyDown);
  }

  #write(element, text) {
    if (!element) return;
    const value = String(text);
    if (element.textContent !== value) element.textContent = value;
  }
}
