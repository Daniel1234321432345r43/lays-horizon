/**
 * NPC.js
 * Entidad de personaje no jugador (NPC) para Lays Horizon.
 * Representa a Alex, una simpática aldeana/exploradora de la isla con:
 *  - Modelo 3D low-poly con ropa distintiva (chaqueta terracota/naranja, mochila, gorro).
 *  - Animaciones procedurales: respiración, caminar con balanceo de extremidades y saludo con la mano.
 *  - Inteligencia artificial: pasea por la superficie sin caerse, reconoce la cercanía del jugador,
 *    se gira para mirarlo y le saluda.
 *  - Sistema de diálogo interactivo al hacer clic o interactuar con ella.
 *  - Indicador flotante sobre la cabeza (etiqueta 3D).
 */

import * as THREE from 'three';
import { MAX_Y, MIN_Y, ORIGIN_X, ORIGIN_Z, SIZE_X, SIZE_Z } from '../world/WorldGrid.js';

const WALK_SPEED = 1.8;
const IDLE_TIME_MIN = 2.5;
const IDLE_TIME_MAX = 5.5;
const WANDER_RADIUS = 5;

const DIALOGUES = [
  '¡Hola! Bienvenido a Lays Horizon. ¡Qué alegría tener compañía en la isla!',
  '¿Sabías que con la azada puedes labrar el césped y plantar deliciosos cultivos?',
  'Con el pico puedes excavar bajo la superficie para extraer piedra y minerales preciosos.',
  '¡Podemos construir carreteras y edificios para convertir esto en un próspero pueblo!',
  'El clima está fantástico hoy. ¡Dime si necesitas ayuda explorando!',
  'Si alguna vez quedas atrapado en un pozo excavando, ¡recuerda presionar "R" para volver arriba!',
  '¡Me encanta pasear por aquí y ver cómo transformas el paisaje!'
];

export class NPC {
  constructor(grid, options = {}) {
    this.grid = grid;
    this.name = options.name || 'Alex';
    this.role = options.role || 'Aldeana';

    this.position = new THREE.Vector3(options.x ?? 3.5, 1, options.z ?? 2.5);
    this.homePosition = this.position.clone();
    this.targetPosition = this.position.clone();
    this.yaw = options.yaw ?? Math.PI * 0.75;
    this.targetYaw = this.yaw;

    this.state = 'idle'; // 'idle' | 'walk' | 'interact'
    this.stateTimer = 2.0;
    this.walkPhase = 0;
    this.idlePhase = Math.random() * Math.PI * 2;
    this.isWaving = false;
    this.waveTimer = 0;
    this.dialogueIndex = 0;

    this.lastShadowPos = new THREE.Vector3(Infinity, Infinity, Infinity);
    this.shadowMoved = true;

    this.materials = this.#createMaterials();
    this.mesh = this.#createModel();
    this.spawn();
  }

  /** Ubica a Alex sobre la superficie sólida más alta en su posición inicial. */
  spawn() {
    const groundY = this.getGroundY(this.position.x, this.position.z);
    this.position.y = groundY;
    this.targetPosition.copy(this.position);
    this.homePosition.copy(this.position);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
  }

  /** Devuelve la altura superior del bloque sólido más alto en (x, z). */
  getGroundY(x, z) {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    for (let y = MAX_Y; y >= MIN_Y; y -= 1) {
      if (this.grid.isSolid(bx, y, bz)) {
        return y + 1;
      }
    }
    return 1;
  }

  /** Comprueba si una coordenada (x, z) es segura para caminar (terreno firme y dentro de la isla). */
  isWalkable(x, z) {
    const margin = 2;
    if (
      x < ORIGIN_X + margin ||
      x >= ORIGIN_X + SIZE_X - margin ||
      z < ORIGIN_Z + margin ||
      z >= ORIGIN_Z + SIZE_Z - margin
    ) {
      return false;
    }

    const bx = Math.floor(x);
    const bz = Math.floor(z);
    const currentGround = this.getGroundY(this.position.x, this.position.z);
    const targetGround = this.getGroundY(bx + 0.5, bz + 0.5);

    // Evita saltar al vacío o trepar desniveles mayores a 1 bloque
    if (Math.abs(targetGround - currentGround) > 1.05) return false;
    if (targetGround <= MIN_Y + 1) return false;

    return true;
  }

  /** Inicia un diálogo interactivo: saluda, habla y devuelve el mensaje. */
  talk() {
    this.wave(3.0);
    const text = DIALOGUES[this.dialogueIndex % DIALOGUES.length];
    this.dialogueIndex += 1;
    this.state = 'interact';
    this.stateTimer = 4.0;
    return text;
  }

  /** Activa la animación de saludo con la mano levantada. */
  wave(duration = 2.2) {
    this.isWaving = true;
    this.waveTimer = duration;
  }

  /** Actualización por fotograma: lógica de IA, animaciones y movimiento. */
  update(deltaTime, playerPosition) {
    this.idlePhase += deltaTime * 2.5;

    const distToPlayer = playerPosition ? this.position.distanceTo(playerPosition) : 999;
    const playerNearby = distToPlayer < 4.2;

    // Control de visibilidad del badge según proximidad
    if (this.nameplate) {
      this.nameplate.visible = distToPlayer < 9.0;
      if (this.nameplate.visible) {
        this.nameplate.position.y = 2.15 + Math.sin(this.idlePhase * 1.5) * 0.04;
      }
    }

    // Si el jugador está muy cerca o estamos interactuando, miramos al jugador
    if (playerNearby || this.state === 'interact') {
      const dx = playerPosition.x - this.position.x;
      const dz = playerPosition.z - this.position.z;
      this.targetYaw = Math.atan2(dx, dz);

      if (distToPlayer < 3.2 && !this.wasPlayerClose && !this.isWaving) {
        this.wave(2.0);
      }
      this.wasPlayerClose = true;

      // Pausamos el paseo mientras el jugador esté al lado
      if (this.state === 'walk') {
        this.state = 'idle';
        this.stateTimer = 2.0;
      }
    } else {
      this.wasPlayerClose = false;
    }

    // Gestión del temporizador de saludo
    if (this.isWaving) {
      this.waveTimer -= deltaTime;
      if (this.waveTimer <= 0) {
        this.isWaving = false;
        this.armPivots[1].rotation.z = 0;
      }
    }

    // Máquina de estados de IA
    if (this.state === 'interact') {
      this.stateTimer -= deltaTime;
      if (this.stateTimer <= 0) {
        this.state = 'idle';
        this.stateTimer = IDLE_TIME_MIN + Math.random() * (IDLE_TIME_MAX - IDLE_TIME_MIN);
      }
    } else if (this.state === 'idle') {
      if (!playerNearby) {
        this.stateTimer -= deltaTime;
        if (this.stateTimer <= 0) {
          this.#pickNewDestination();
        }
      }
    } else if (this.state === 'walk') {
      const toTarget = new THREE.Vector3().subVectors(this.targetPosition, this.position);
      toTarget.y = 0;
      const distRemaining = toTarget.length();

      if (distRemaining < 0.15) {
        // Llegó al destino
        this.position.x = this.targetPosition.x;
        this.position.z = this.targetPosition.z;
        this.state = 'idle';
        this.stateTimer = IDLE_TIME_MIN + Math.random() * (IDLE_TIME_MAX - IDLE_TIME_MIN);
      } else {
        toTarget.normalize();
        this.targetYaw = Math.atan2(toTarget.x, toTarget.z);

        const moveAmount = Math.min(distRemaining, WALK_SPEED * deltaTime);
        const nextX = this.position.x + toTarget.x * moveAmount;
        const nextZ = this.position.z + toTarget.z * moveAmount;

        if (this.isWalkable(nextX, nextZ)) {
          this.position.x = nextX;
          this.position.z = nextZ;
          this.position.y = this.getGroundY(this.position.x, this.position.z);
          this.walkPhase += deltaTime * 8.5;
        } else {
          // Si el camino se bloqueó, vuelve a reposar
          this.state = 'idle';
          this.stateTimer = 2.0;
        }
      }
    }

    // Suavizado del giro del cuerpo (rotación yaw)
    const yawDiff = Math.atan2(Math.sin(this.targetYaw - this.yaw), Math.cos(this.targetYaw - this.yaw));
    this.yaw += yawDiff * Math.min(1, deltaTime * 8);

    // Animación de articulaciones
    this.#animateLimbs(deltaTime);

    // Sincronizar posición y rotación del modelo
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;

    // Evaluar si las sombras necesitan refresco
    const moved =
      this.position.distanceToSquared(this.lastShadowPos) > 0.0004 ||
      Math.abs(this.yaw - this.lastShadowYaw) > 0.01 ||
      this.isWaving;

    if (moved) {
      this.lastShadowPos.copy(this.position);
      this.lastShadowYaw = this.yaw;
      this.shadowMoved = true;
    } else {
      this.shadowMoved = false;
    }
  }

  hasMovedShadows() {
    return this.shadowMoved;
  }

  #pickNewDestination() {
    for (let attempts = 0; attempts < 8; attempts += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.5 + Math.random() * (WANDER_RADIUS - 1.5);
      const testX = this.homePosition.x + Math.cos(angle) * radius;
      const testZ = this.homePosition.z + Math.sin(angle) * radius;

      if (this.isWalkable(testX, testZ)) {
        this.targetPosition.set(testX, this.getGroundY(testX, testZ), testZ);
        this.state = 'walk';
        return;
      }
    }

    // Si no encontró destino, espera otro momento
    this.state = 'idle';
    this.stateTimer = 2.5;
  }

  #animateLimbs(deltaTime) {
    const isWalking = this.state === 'walk';

    // Animación de piernas
    if (isWalking) {
      const legAngle = Math.sin(this.walkPhase) * 0.45;
      this.legPivots[0].rotation.x = legAngle;
      this.legPivots[1].rotation.x = -legAngle;
    } else {
      this.legPivots[0].rotation.x = THREE.MathUtils.damp(this.legPivots[0].rotation.x, 0, 10, deltaTime);
      this.legPivots[1].rotation.x = THREE.MathUtils.damp(this.legPivots[1].rotation.x, 0, 10, deltaTime);
    }

    // Animación del brazo izquierdo
    if (isWalking) {
      this.armPivots[0].rotation.x = -Math.sin(this.walkPhase) * 0.35;
    } else {
      this.armPivots[0].rotation.x = THREE.MathUtils.damp(this.armPivots[0].rotation.x, -0.06, 8, deltaTime);
    }

    // Animación del brazo derecho (caminar o saludar)
    if (this.isWaving) {
      // Brazo levantado saludando alegremente
      this.armPivots[1].rotation.x = THREE.MathUtils.damp(this.armPivots[1].rotation.x, -Math.PI * 0.82, 14, deltaTime);
      this.armPivots[1].rotation.z = THREE.MathUtils.damp(
        this.armPivots[1].rotation.z,
        -0.35 + Math.sin(this.idlePhase * 9.0) * 0.35,
        18,
        deltaTime
      );
    } else if (isWalking) {
      this.armPivots[1].rotation.x = Math.sin(this.walkPhase) * 0.35;
      this.armPivots[1].rotation.z = THREE.MathUtils.damp(this.armPivots[1].rotation.z, 0, 10, deltaTime);
    } else {
      this.armPivots[1].rotation.x = THREE.MathUtils.damp(this.armPivots[1].rotation.x, -0.06, 8, deltaTime);
      this.armPivots[1].rotation.z = THREE.MathUtils.damp(this.armPivots[1].rotation.z, 0, 10, deltaTime);
    }

    // Sutil respiración en el torso y cabeza
    const breath = Math.sin(this.idlePhase) * 0.015;
    this.torso.position.y = 0.87 + breath;
    this.head.position.y = 1.2 + breath;

    // Giro sutil de la cabeza al reposar
    if (this.state === 'idle' && !this.wasPlayerClose) {
      this.head.rotation.y = Math.sin(this.idlePhase * 0.6) * 0.22;
    } else {
      this.head.rotation.y = THREE.MathUtils.damp(this.head.rotation.y, 0, 8, deltaTime);
    }
  }

  #createMaterials() {
    return {
      skin: new THREE.MeshLambertMaterial({ color: 0xf6cfab, flatShading: true }),
      jacket: new THREE.MeshLambertMaterial({ color: 0xe67e22, flatShading: true }), // Chaqueta naranja cálida
      shirt: new THREE.MeshLambertMaterial({ color: 0xf5f7fa, flatShading: true }),
      pants: new THREE.MeshLambertMaterial({ color: 0x2c3e50, flatShading: true }), // Jeans azul marino
      boots: new THREE.MeshLambertMaterial({ color: 0x4a3525, flatShading: true }),
      hair: new THREE.MeshLambertMaterial({ color: 0x5d4037, flatShading: true }), // Cabello castaño
      hat: new THREE.MeshLambertMaterial({ color: 0xd35400, flatShading: true }),
      hatBand: new THREE.MeshLambertMaterial({ color: 0xf1c40f, flatShading: true }),
      backpack: new THREE.MeshLambertMaterial({ color: 0x795548, flatShading: true }),
      eye: new THREE.MeshLambertMaterial({ color: 0x1f2421, flatShading: true })
    };
  }

  #createModel() {
    const group = new THREE.Group();
    group.name = 'npc_alex';
    const m = this.materials;

    // Registro para que el sistema de interacción reconozca los clics en cualquier parte de Alex
    const registerPick = (obj) => {
      obj.userData.pickOwner = { kind: 'npc', npc: this };
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    };

    // Piernas con pivotes en las caderas
    this.legPivots = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.12, 0.58, 0);

      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.56, 10), m.pants);
      leg.position.y = -0.28;

      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.28), m.boots);
      boot.position.set(0, -0.53, 0.04);

      pivot.add(leg, boot);
      group.add(pivot);
      this.legPivots.push(pivot);
    }

    // Torso con chaqueta y cuello blanco
    this.torso = new THREE.Group();
    this.torso.position.y = 0.87;

    const jacketBody = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.32, 0.60, 12), m.jacket);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 0.10, 12), m.shirt);
    collar.position.y = 0.29;

    // Pequeña mochila de explorador en la espalda
    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.38, 0.16), m.backpack);
    backpack.position.set(0, 0.02, -0.22);

    this.torso.add(jacketBody, collar, backpack);
    group.add(this.torso);

    // Cabeza anclada en el cuello
    this.head = new THREE.Group();
    this.head.position.y = 1.2;

    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), m.skin);
    headMesh.position.y = 0.24;

    const hairMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.265, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      m.hair
    );
    hairMesh.position.y = 0.25;

    // Gorro con visera
    const hatCap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.12, 12), m.hat);
    hatCap.position.y = 0.38;

    const hatBand = new THREE.Mesh(new THREE.CylinderGeometry(0.282, 0.282, 0.04, 12), m.hatBand);
    hatBand.position.y = 0.34;

    const hatBrim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.18), m.hat);
    hatBrim.position.set(0, 0.32, 0.26);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.07), m.skin);
    nose.position.set(0, 0.22, 0.24);

    // Ojos
    const eyeGeom = new THREE.SphereGeometry(0.036, 8, 6);
    const leftEye = new THREE.Mesh(eyeGeom, m.eye);
    leftEye.position.set(-0.09, 0.23, 0.23);
    const rightEye = new THREE.Mesh(eyeGeom, m.eye);
    rightEye.position.set(0.09, 0.23, 0.23);

    this.head.add(headMesh, hairMesh, hatCap, hatBand, hatBrim, nose, leftEye, rightEye);
    group.add(this.head);

    // Brazos articulados
    this.armPivots = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.32, 1.1, 0);

      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.085, 0.48, 8), m.jacket);
      sleeve.position.y = -0.24;

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), m.skin);
      hand.position.y = -0.50;

      pivot.add(sleeve, hand);
      group.add(pivot);
      this.armPivots.push(pivot);
    }

    // Etiqueta flotante con nombre sobre la cabeza (billboard sprite)
    this.nameplate = this.#createNameplate();
    group.add(this.nameplate);

    // Habilitar sombras y registro de selección para todos los elementos
    group.traverse(registerPick);

    return group;
  }

  #createNameplate() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Fondo redondeado elegante con borde verde esmeralda
    ctx.fillStyle = 'rgba(18, 26, 36, 0.88)';
    ctx.strokeStyle = '#8ee27a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(16, 16, 480, 96, 28);
    ctx.fill();
    ctx.stroke();

    // Texto del nombre y rol
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💬 Alex · Aldeana', 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false
    });

    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.7, 0.42, 1);
    sprite.position.set(0, 2.15, 0);
    return sprite;
  }
}
