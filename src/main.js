/**
 * main.js
 * Punto de entrada de Lays Horizon: inicializa motor, luces, mundo, jugador,
 * sistemas y HUD, y ejecuta el bucle principal con deltaTime acotado.
 */

import { Engine } from './core/Engine.js';
import { Lighting } from './core/Lighting.js';
import { WorldGrid } from './world/WorldGrid.js';
import { TerrainRenderer } from './world/TerrainRenderer.js';
import { Player } from './entities/Player.js';
import { NPC } from './entities/NPC.js';
import { InteractionSystem } from './systems/InteractionSystem.js';
import { DiggingSystem } from './systems/DiggingSystem.js';
import { FarmingSystem } from './systems/FarmingSystem.js';
import { CitySystem } from './systems/CitySystem.js';
import { HUD } from './ui/HUD.js';

/* La simulación avanza en pasos fijos de 1/60 s. Antes el deltaTime se
   recortaba a 0,1 s, de modo que a pocos fps el mundo entero iba en cámara
   lenta; con pasos fijos el juego mantiene el ritmo real y, además, las
   colisiones se resuelven siempre con la misma precisión (nunca con un salto
   largo que atraviese un bloque). */
const FIXED_STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 20;
const MAX_FRAME_TIME = FIXED_STEP * MAX_STEPS_PER_FRAME;

const canvas = document.getElementById('bg');
const hudRoot = document.getElementById('hud');

/* 1. Motor y luces ------------------------------------------------------- */
const engine = new Engine(canvas);
const lighting = new Lighting(engine.scene);

/* 2. Mundo -------------------------------------------------------------- */
const grid = new WorldGrid();
grid.generateTerrain();

// El mapa de sombras solo se rehace cuando algo cambia de verdad.
const invalidateShadows = () => engine.requestShadowUpdate();

const terrain = new TerrainRenderer(grid, { onGeometryChange: invalidateShadows });
terrain.buildMesh();
engine.scene.add(terrain.group);

/* 3. Interfaz ----------------------------------------------------------- */
const hud = new HUD(hudRoot);

/* 4. Jugador y NPC ------------------------------------------------------ */
const player = new Player(grid);
engine.scene.add(player.mesh);

const npc = new NPC(grid, { name: 'Alex', role: 'Aldeana', x: 3.5, z: 2.5 });
engine.scene.add(npc.mesh);

/* 5. Sistemas ----------------------------------------------------------- */
const farming = new FarmingSystem({ grid, terrain, hud, onGeometryChange: invalidateShadows });
engine.scene.add(farming.group);

const city = new CitySystem({
  grid,
  terrain,
  hud,
  isCellFree: (x, z) => farming.isCellFree(x, z) && !city.isCellOccupiedByBuilding(x, z),
  getPlayerPosition: () => player.position,
  onGeometryChange: invalidateShadows
});
engine.scene.add(city.group);

const digging = new DiggingSystem({
  grid,
  terrain,
  hud,
  // El sistema de agricultura decide si el bloque minado sostenía un cultivo:
  // excavar por debajo de la tierra arada no debe marchitar la planta de arriba.
  onDestroy: (block) => {
    farming.removeAt(block.x, block.y, block.z);
  }
});

const interaction = new InteractionSystem({
  camera: engine.camera,
  domElement: canvas,
  grid,
  farming,
  city,
  npc
});
engine.scene.add(interaction.helper, interaction.previewGroup);

hud.onToolChange((tool) => player.setTool(tool.id));
player.updateCamera(engine.camera, 0, true);

/* 6. Entrada ------------------------------------------------------------ */
const input = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  sprint: false
};

const KEY_MAP = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'backward',
  ArrowDown: 'backward',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint'
};

function setKeyState(event, pressed) {
  const action = KEY_MAP[event.code];
  if (!action) return;
  if (action === 'jump' || action === 'sprint') event.preventDefault();
  input[action] = pressed;
}

function clearInput() {
  for (const key of Object.keys(input)) input[key] = false;
}

let pointerDown = false;

/** Suelta todas las entradas: evita estados atascados si se pierde un evento. */
function releaseInput() {
  clearInput();
  pointerDown = false;
  digging.update(0, null, false);
}

window.addEventListener('keydown', (event) => {
  setKeyState(event, true);
  if (event.code === 'KeyR') {
    event.preventDefault();
    rescuePlayer();
  }
  // El salto se recuerda un instante: con pocos fps, una pulsación corta caía
  // entre dos frames y se perdía sin que el jugador hubiera hecho nada mal.
  if (event.code === 'Space' && !event.repeat) player.requestJump();
});
window.addEventListener('keyup', (event) => setKeyState(event, false));
window.addEventListener('blur', releaseInput);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseInput();
});
// Al recuperar el foco solo se sueltan las teclas: el botón del ratón puede
// seguir pulsado (el primer clic sobre una ventana inactiva genera 'focus').
window.addEventListener('focus', clearInput);

/* 6b. Primera persona -------------------------------------------------- */
/** Sale de primera persona: suelta el puntero y restaura la cámara. */
function exitFirstPerson() {
  if (!player.firstPerson) return;
  player.setFirstPerson(false);
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  player.updateCamera(engine.camera, 0, true);
  hud.setMessage('Cámara isométrica');
}

/** Entra en primera persona y captura el ratón para mirar con él. */
function enterFirstPerson() {
  player.setFirstPerson(true);
  interaction.setPreview(null);
  try {
    const request = canvas.requestPointerLock({ unadjustedMovement: true });
    if (request && typeof request.catch === 'function') request.catch(() => canvas.requestPointerLock());
  } catch (error) {
    canvas.requestPointerLock();
  }
  hud.setMessage('Primera persona · mueve el ratón para mirar, clic para usar, Esc para salir');
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas) exitFirstPerson();
});
document.addEventListener('pointerlockerror', () => {
  if (player.firstPerson) exitFirstPerson();
});

canvas.addEventListener('mousemove', (event) => {
  if (player.firstPerson && document.pointerLockElement === canvas) {
    player.addLook(event.movementX, event.movementY);
  }
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyV' && !event.repeat) {
    event.preventDefault();
    if (player.firstPerson) exitFirstPerson();
    else enterFirstPerson();
  }
  if (event.code === 'Escape') exitFirstPerson();
});

window.addEventListener('blur', exitFirstPerson);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) exitFirstPerson();
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  if (player.firstPerson) {
    // Con el puntero capturado no hay cursor sobre el canvas: la mirada manda.
    pointerDown = true;
    applyAction(interaction.update());
    return;
  }
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch (error) {
    // Los eventos de puntero sintéticos (pruebas automatizadas) no son capturables.
  }
  interaction.updatePointer(event);
  pointerDown = true;
  applyAction(interaction.update());
});
window.addEventListener('pointerup', (event) => {
  if (event.button !== 0) return;
  pointerDown = false;
  digging.update(0, null, false);
});
canvas.addEventListener('pointercancel', releaseInput);
canvas.addEventListener('lostpointercapture', releaseInput);

/** Reubica al jugador en la superficie si ha quedado atrapado en un pozo. */
function rescuePlayer() {
  const info = player.rescue();
  if (!info.ok) {
    hud.setMessage(info.reason);
    return;
  }
  player.updateCamera(engine.camera, 0, true);
  hud.setMessage(`Rescatado a la superficie · (${info.x}, ${info.layer}, ${info.z})`);
}

/* 7. Despacho de acciones según la herramienta activa ------------------- */
function evaluateTarget(target) {
  if (!target) return { ok: false, reason: '' };

  const tool = hud.getActiveTool();

  if (target.kind === 'npc') {
    return { ok: true, reason: '' };
  }
  if (target.kind === 'crop') {
    return farming.isMature(target.crop)
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'Ese cultivo todavía no está maduro' };
  }
  if (target.kind === 'building') {
    return city.canDemolish(target, tool.id);
  }

  switch (tool.id) {
    case 'pickaxe':
      return digging.canDig(target);
    case 'hoe':
      return farming.canTill(target);
    case 'seeds':
      return farming.canPlant(target);
    case 'road':
      return city.canPlaceRoad(target);
    case 'building':
      return city.canPlaceBuilding(target);
    default:
      return { ok: false, reason: '' };
  }
}

function applyAction(target) {
  if (!target) return;

  if (target.kind === 'npc') {
    const speech = target.npc.talk();
    hud.setMessage(`${target.npc.name}: "${speech}"`, 4500);
    player.playSwing();
    return;
  }

  const tool = hud.getActiveTool();
  let result = { ok: false, reason: '' };

  if (target.kind === 'crop') {
    result = farming.harvest(target.crop);
  } else if (target.kind === 'building') {
    const check = city.canDemolish(target, tool.id);
    result = check.ok ? city.demolish(target.building) : check;
  } else if (tool.id === 'pickaxe') {
    result = digging.begin(target);
  } else if (tool.id === 'hoe') {
    result = farming.till(target);
  } else if (tool.id === 'seeds') {
    result = farming.plant(target);
  } else if (tool.id === 'road') {
    result = city.placeRoad(target);
  } else if (tool.id === 'building') {
    result = city.placeBuilding(target);
  }

  if (result.ok) {
    // El minado cuenta sus propios golpes (uno por punto de durabilidad).
    if (!(tool.id === 'pickaxe' && target.kind === 'block')) player.playSwing();
  } else if (result.reason) {
    hud.setMessage(result.reason);
  }
}

/**
 * Punto del mundo que el jugador está mirando, para orientar la cabeza:
 * el centro de la cara apuntada, la planta o el edificio seleccionado.
 */
function aimPointFor(target) {
  if (!target) return null;
  if (target.kind === 'npc') {
    return { x: target.npc.position.x, y: target.npc.position.y + 1.4, z: target.npc.position.z };
  }
  if (target.kind === 'block') {
    const normal = target.normal ?? { x: 0, y: 1, z: 0 };
    return {
      x: target.block.x + 0.5 + normal.x * 0.5,
      y: target.block.y + 0.5 + normal.y * 0.5,
      z: target.block.z + 0.5 + normal.z * 0.5
    };
  }
  if (target.kind === 'crop') {
    return { x: target.crop.x + 0.5, y: 1.15, z: target.crop.z + 0.5 };
  }
  if (target.kind === 'building') {
    return { x: target.block.x + 1, y: 1.2, z: target.block.z + 1 };
  }
  return null;
}

function describeTarget(target) {
  if (!target) return '—';
  if (target.kind === 'npc') {
    return `${target.npc.name} (${target.npc.role}) · Clic para hablar`;
  }
  if (target.kind === 'block') {
    return `${target.type.name} (${target.block.x}, ${target.block.y}, ${target.block.z})`;
  }
  if (target.kind === 'crop') {
    return `Cultivo · ${farming.describe(target.crop)}`;
  }
  if (target.kind === 'building') {
    return `Edificio #${target.building.id}`;
  }
  return '—';
}

/* 8. Bucle principal ---------------------------------------------------- */
/** Fantasma de colocación para carreteras y edificios. */
function updatePlacementPreview(target, validity, tool) {
  if (!target || target.kind !== 'block') {
    interaction.setPreview(null);
    return;
  }

  if (tool.id === 'road') {
    interaction.setPreview({
      x: target.block.x,
      y: target.block.y,
      z: target.block.z,
      size: 1,
      height: 1,
      valid: validity.ok
    });
    return;
  }

  if (tool.id === 'building' && target.block.y === 0) {
    interaction.setPreview({
      x: target.block.x,
      y: 1,
      z: target.block.z,
      size: 2,
      height: 2.3,
      valid: validity.ok
    });
    return;
  }

  interaction.setPreview(null);
}

function refreshStatus(target, validity, digState) {
  const playerLayer = Math.round(player.position.y - 1);
  const tool = hud.getActiveTool();

  let durabilityText = '—';
  let barMode = 'mine';
  let barProgress = digState.active ? digState.progress : 0;

  if (digState.active) {
    durabilityText = `${digState.remaining.toFixed(1)} / ${digState.durability}`;
  } else if (target && target.kind === 'block') {
    durabilityText = `${target.type.durability} ${target.type.durability === 1 ? 'punto' : 'puntos'}`;
  } else if (target && target.kind === 'crop') {
    const mature = farming.isMature(target.crop);
    barMode = mature ? 'mature' : 'growth';
    barProgress = mature ? 1 : target.crop.progress;
    durabilityText = mature
      ? 'Listo para cosechar'
      : `Crecimiento ${Math.round(target.crop.progress * 100)}%`;
  } else if (target && target.kind === 'npc') {
    durabilityText = 'Amistosa';
    barMode = 'mature';
    barProgress = 1;
  }

  hud.setStatus({
    mode: `${tool.label}`,
    layer: target
      ? `Y = ${target.block.y} · (${target.block.x}, ${target.block.z})`
      : `Y = ${playerLayer} · jugador`,
    target: describeTarget(target),
    durability: durabilityText,
    progress: barProgress,
    barMode,
    valid: validity.ok,
    hint: target && target.kind === 'npc' ? `Haz clic para conversar con ${target.npc.name}` : validity.ok ? tool.hint : validity.reason || tool.hint
  });

  updatePlacementPreview(target, validity, tool);
}

let perfFrames = 0;
let perfElapsed = 0;

/** Lectura de rendimiento una vez por segundo: fps, draw calls e instancias. */
function updatePerf(rawDelta) {
  perfFrames += 1;
  perfElapsed += rawDelta;
  if (perfElapsed < 1) return;

  let instances = 0;
  for (const mesh of terrain.meshes) instances += mesh.count;
  const fps = perfFrames / perfElapsed;
  hud.setPerf(
    `${Math.round(fps)} fps · ${engine.renderer.info.render.calls} draw calls · ${instances} instancias`
  );

  perfFrames = 0;
  perfElapsed = 0;
}

let lastTime = performance.now();
let accumulator = 0;

const lastShadowSample = { x: Infinity, y: Infinity, z: Infinity, yaw: Infinity };

/**
 * ¿Se movió algo del jugador que obligue a rehacer las sombras? Cubre tanto
 * el desplazamiento como la postura (paso, golpe de herramienta), porque el
 * cuerpo proyecta su sombra con la pose actual.
 */
function playerMovedShadows() {
  const position = player.position;
  const moved =
    Math.abs(position.x - lastShadowSample.x) > 0.0005 ||
    Math.abs(position.y - lastShadowSample.y) > 0.0005 ||
    Math.abs(position.z - lastShadowSample.z) > 0.0005 ||
    Math.abs(player.yaw - lastShadowSample.yaw) > 0.002;
  const posing =
    player.isSwinging ||
    Math.abs(player.legPivots[0].rotation.x) > 0.015 ||
    Math.abs(player.legPivots[1].rotation.x) > 0.015;

  if (!moved && !posing) return false;

  lastShadowSample.x = position.x;
  lastShadowSample.y = position.y;
  lastShadowSample.z = position.z;
  lastShadowSample.yaw = player.yaw;
  return true;
}

/**
 * Avanza la simulación en pasos fijos de FIXED_STEP. Si el frame llega antes
 * que un paso completo (más de 60 fps) se consume el remanente tal cual, para
 * no perder suavidad; si el frame es largo, se ejecutan varios pasos hasta el
 * tope, de modo que el mundo avanza en tiempo real sin saltarse colisiones.
 */
function stepSimulation(frameDelta) {
  accumulator += frameDelta;
  let steps = 0;

  while (accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
    player.update(FIXED_STEP, input, engine.camera);
    accumulator -= FIXED_STEP;
    steps += 1;
  }

  if (steps === 0) {
    player.update(accumulator, input, engine.camera);
    accumulator = 0;
  }
}

function frame(now) {
  const rawDelta = (now - lastTime) / 1000;
  const deltaTime = Math.min(rawDelta, MAX_FRAME_TIME);
  lastTime = now;
  updatePerf(rawDelta);

  if (player.firstPerson) {
    // Con el puntero capturado no hay cursor: el rayo sale por el centro de
    // la pantalla, hacia donde el jugador está mirando.
    interaction.pointer.set(0, 0);
    interaction.hasPointer = true;
    // Orientación de la cámara al día ANTES de simular: el movimiento WASD es
    // relativo a la mirada y así el primer frame ya avanza hacia donde miras.
    player.updateCamera(engine.camera, 0, true);
  }

  stepSimulation(deltaTime);
  npc.update(deltaTime, player.position);
  player.updateCamera(engine.camera, deltaTime);

  const target = interaction.update();
  const validity = evaluateTarget(target);
  interaction.setValid(validity.ok);
  player.setAimPoint(aimPointFor(target));

  farming.update(deltaTime);

  const diggingActive = pointerDown && hud.getActiveTool().id === 'pickaxe';
  const digState = digging.update(deltaTime, target, diggingActive);
  if (digging.consumeStrike()) player.playSwing();

  refreshStatus(target, validity, digState);

  if (playerMovedShadows() || npc.hasMovedShadows()) engine.requestShadowUpdate();

  engine.render(deltaTime);
  requestAnimationFrame(frame);
}

const stats = terrain.getStats();
console.info(
  `[Lays Horizon] Rejilla 30x6x30 generada · ${stats.visible} de ${stats.total} bloques visibles (culling de caras internas activo)`
);
console.info(
  '[Lays Horizon] Controles: WASD mover · Espacio saltar · Shift correr · 1-5 herramientas · clic para usar · V primera persona'
);

window.laysHorizon = {
  engine,
  grid,
  terrain,
  player,
  npc,
  farming,
  city,
  digging,
  interaction,
  hud,
  lighting,
  input,
  applyAction,
  evaluateTarget,
  enterFirstPerson,
  exitFirstPerson
};

player.syncMesh(false);
requestAnimationFrame(frame);
