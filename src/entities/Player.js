/**
 * Player.js
 * Jugador isométrico: modelo low-poly con herramienta en la mano, movimiento
 * WASD relativo a la cámara, gravedad, salto, sprint y colisiones AABB
 * resueltas eje por eje contra los bloques sólidos de la rejilla.
 */

import * as THREE from 'three';

import { MAX_Y, MIN_Y, ORIGIN_X, ORIGIN_Z, SIZE_X, SIZE_Z } from '../world/WorldGrid.js';

const WORLD_FLOOR = MIN_Y;

export const PLAYER_RADIUS = 0.34;
export const PLAYER_HEIGHT = 1.7;

const WALK_SPEED = 4.6;
const SPRINT_SPEED = 7.5;
const GRAVITY = 24;
const JUMP_SPEED = 8.6;
const GROUND_TOLERANCE = 0.08;
const STEP_HEIGHT = 1.05;
// Margen para no perder un salto pulsado justo entre dos frames: la petición se
// recuerda un instante y se aplica en cuanto el jugador toca el suelo.
const JUMP_BUFFER = 0.25;
const COLLISION_EPSILON = 0.001;
const CAMERA_OFFSET = new THREE.Vector3(15, 18, 15);
const CAMERA_DAMPING = 6;
const TURN_DAMPING = 14;
const EYE_HEIGHT = 1.1;
const WALK_LEG_SWING = 0.5;
const SWING_DURATION = 0.3;
const LIMB_DAMPING = 12;
const IDLE_BREATH_SPEED = 2.1;
const IDLE_BREATH_AMPLITUDE = 0.035;
const IDLE_BOB = 0.012;
const HEAD_NECK_HEIGHT = 1.2;
const HEAD_EYE_HEIGHT = 1.44;
const HEAD_DAMPING = 7;
const HEAD_MAX_YAW = 0.7;
const HEAD_MAX_PITCH = 0.26;

/* Primera persona: ojo a la altura de la mirada, inclinación acotada y
   balanceo sutil de cámara al caminar. */
const FP_EYE_HEIGHT = 1.44;
const PITCH_LIMIT = 1.35;
const MOUSE_SENSITIVITY = 0.0026;
const FP_WALK_BOB = 0.05;
const FP_IDLE_BOB = 0.008;
const FP_EULER = new THREE.Euler(0, 0, 0, 'YXZ');

export class Player {
  constructor(grid) {
    this.grid = grid;
    this.position = new THREE.Vector3(0.5, 1, 0.5);
    this.velocityY = 0;
    this.grounded = false;
    this.jumpBuffer = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.firstPerson = false;
    this.walkPhase = 0;
    this.limbCycle = 0;
    this.idlePhase = 0;
    this.swingTimer = 0;
    this.activeTool = 'pickaxe';
    this.aimPoint = new THREE.Vector3();
    this.hasAim = false;

    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.moveDirection = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.cameraTarget = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.cellRange = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };

    this.materials = this.#createMaterials();
    this.toolModels = this.#createToolModels();
    this.mesh = this.#createModel();
    this.spawn();
  }

  /** Coloca al jugador sobre la primera superficie sólida de la columna central. */
  spawn() {
    let surface = MIN_Y;
    for (let y = 0; y >= MIN_Y; y -= 1) {
      if (this.grid.isSolid(0, y, 0)) {
        surface = y;
        break;
      }
    }
    this.position.set(0.5, surface + 1 + COLLISION_EPSILON, 0.5);
    this.velocityY = 0;
    this.grounded = true;
    this.syncMesh();
  }

  setTool(toolId) {
    this.activeTool = toolId;
    for (const [id, model] of Object.entries(this.toolModels)) {
      model.visible = id === toolId;
    }
  }

  /**
   * Gira la vista en primera persona: el movimiento del ratón (movementX/Y)
   * se traduce en guiñada e inclinación, con esta última acotada para no
   * permitir volteretas.
   */
  addLook(deltaX, deltaY) {
    this.yaw -= deltaX * MOUSE_SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch - deltaY * MOUSE_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /**
   * Alterna cámara isométrica ↔ primera persona. En primera persona se
   * oculta el cuerpo salvo el brazo derecho con la herramienta, que queda a
   * la vista como en los juegos de vóxeles; al volver, la inclinación se
   * resetea para que la cámara isométrica no llegue torcida.
   */
  setFirstPerson(on) {
    this.firstPerson = on;
    for (const part of this.bodyParts) part.visible = !on;
    if (!on) this.pitch = 0;
  }

  togglePerspective() {
    this.setFirstPerson(!this.firstPerson);
    return this.firstPerson;
  }

  /** Movimiento, colisiones y física. */
  update(deltaTime, input, camera) {
    this.#updateDirections(camera);

    const direction = this.moveDirection.set(0, 0, 0);
    if (input.forward) direction.add(this.forward);
    if (input.backward) direction.sub(this.forward);
    if (input.right) direction.add(this.right);
    if (input.left) direction.sub(this.right);

    const moving = direction.lengthSq() > 0.000001;
    if (moving) direction.normalize();

    const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
    this.moveAxisX(direction.x * speed * deltaTime);
    this.moveAxisZ(direction.z * speed * deltaTime);

    this.grounded = this.#isGrounded();
    this.jumpBuffer = Math.max(0, this.jumpBuffer - deltaTime);
    if ((input.jump || this.jumpBuffer > 0) && this.grounded) {
      this.velocityY = JUMP_SPEED;
      this.grounded = false;
      this.jumpBuffer = 0;
    }

    this.velocityY -= GRAVITY * deltaTime;
    this.moveAxisY(this.velocityY * deltaTime);

    this.position.x = THREE.MathUtils.clamp(
      this.position.x,
      ORIGIN_X + PLAYER_RADIUS,
      ORIGIN_X + SIZE_X - PLAYER_RADIUS
    );
    this.position.z = THREE.MathUtils.clamp(
      this.position.z,
      ORIGIN_Z + PLAYER_RADIUS,
      ORIGIN_Z + SIZE_Z - PLAYER_RADIUS
    );

    if (this.firstPerson) {
      // En primera persona el ratón manda: el modelo mira hacia la vista y el
      // movimiento relativo a la cámara es el correcto en cualquier rumbo.
      this.walkPhase += moving ? deltaTime * (input.sprint ? 13 : 9) : deltaTime * 3;
    } else if (moving) {
      const targetYaw = Math.atan2(direction.x, direction.z);
      let delta = targetYaw - this.yaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.yaw += delta * (1 - Math.exp(-TURN_DAMPING * deltaTime));
      this.walkPhase += deltaTime * (input.sprint ? 13 : 9);
    } else {
      this.walkPhase += deltaTime * 3;
    }

    this.#animate(deltaTime, moving, input.sprint);
    this.#updateHead(deltaTime);
    this.syncMesh(moving);
    return { moving };
  }

  /**
   * Pide un salto. Se recuerda brevemente para que una pulsación corta no se
   * pierda si el frame llega después de soltar la tecla.
   */
  requestJump() {
    this.jumpBuffer = JUMP_BUFFER;
  }

  /** Arranca un golpe de herramienta (minar, labrar, sembrar, construir). */
  playSwing() {
    this.swingTimer = SWING_DURATION;
  }

  /**
   * Fija el punto del mundo que el jugador tiene delante (el bloque apuntado,
   * una planta o un edificio) para orientar la cabeza hacia él. `null` la
   * devuelve al frente.
   */
  setAimPoint(point) {
    if (!point) {
      this.hasAim = false;
      return;
    }
    this.aimPoint.set(point.x, point.y, point.z);
    this.hasAim = true;
  }

  get isSwinging() {
    return this.swingTimer > 0;
  }

  /**
   * Ciclo de caminar y golpe de herramienta. Las extremidades giran sobre sus
   * pivotes (cadera y hombro) y el ciclo se amortigua al detenerse.
   */
  #animate(deltaTime, moving, sprinting) {
    const target = moving ? Math.sin(this.walkPhase) * WALK_LEG_SWING * (sprinting ? 1.3 : 1) : 0;
    this.limbCycle += (target - this.limbCycle) * (1 - Math.exp(-LIMB_DAMPING * deltaTime));

    this.legPivots[0].rotation.x = this.limbCycle;
    this.legPivots[1].rotation.x = -this.limbCycle;
    this.armPivots[0].rotation.x = this.armBase[0] - this.limbCycle * 0.7;
    this.armPivots[1].rotation.x = this.armBase[1] + this.limbCycle * 0.5;

    this.swingTimer = Math.max(0, this.swingTimer - deltaTime);
    const swing = this.swingTimer > 0 ? Math.sin((1 - this.swingTimer / SWING_DURATION) * Math.PI) : 0;
    this.armPivots[1].rotation.x += swing * 0.6;
    this.hand.rotation.x = -swing * 1.1;

    if (this.firstPerson) {
      // Brazo derecho en alto sosteniendo la herramienta: es lo único del
      // cuerpo que se ve, así que marca el golpe desde la propia vista e inclina con la mirada.
      this.armPivots[1].rotation.x = -1.15 + swing * 0.9 + this.pitch * 0.5;
      this.hand.rotation.x = -0.35 - swing * 0.6;
    }

    // Respirar en reposo: sin esta respiración el modelo queda congelado
    // cuando no se mueve ni usa la herramienta.
    if (!moving) {
      this.idlePhase += deltaTime * IDLE_BREATH_SPEED;
      const breath = Math.sin(this.idlePhase) * IDLE_BREATH_AMPLITUDE;
      this.armPivots[0].rotation.x += breath;
      this.armPivots[1].rotation.x += breath * 0.8;
    }
  }

  /**
   * Gira la cabeza hacia el objetivo apuntado, con el ángulo acotado para que
   * el cuello no se retuerza y retornando suavemente al frente al perderlo.
   */
  #updateHead(deltaTime) {
    if (this.firstPerson) return;
    let targetYaw = 0;
    let targetPitch = 0;

    if (this.hasAim) {
      const dx = this.aimPoint.x - this.position.x;
      const dz = this.aimPoint.z - this.position.z;
      const flat = Math.hypot(dx, dz);
      if (flat > 0.2) {
        const local = Math.atan2(dx, dz) - this.yaw;
        const wrapped = Math.atan2(Math.sin(local), Math.cos(local));
        targetYaw = THREE.MathUtils.clamp(wrapped, -HEAD_MAX_YAW, HEAD_MAX_YAW);
        const dy = this.aimPoint.y - (this.position.y + HEAD_EYE_HEIGHT);
        targetPitch = THREE.MathUtils.clamp(
          -Math.atan2(dy, flat) * 0.85,
          -HEAD_MAX_PITCH,
          HEAD_MAX_PITCH
        );
      }
    }

    const k = 1 - Math.exp(-HEAD_DAMPING * deltaTime);
    this.head.rotation.y += (targetYaw - this.head.rotation.y) * k;
    this.head.rotation.x += (targetPitch - this.head.rotation.x) * k;
  }

  /**
   * Reubica al jugador en la superficie sólida más alta de su entorno.
   * Evita quedarse atrapado en pozos profundos: sin herramienta para colocar
   * bloques, un pozo de tres o más bloques sería irrecuperable.
   */
  rescue(radius = 2) {
    const centerX = Math.floor(this.position.x);
    const centerZ = Math.floor(this.position.z);
    let best = null;

    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const x = centerX + dx;
        const z = centerZ + dz;
        if (!this.grid.inBounds(x, MAX_Y, z)) continue;

        let top = null;
        for (let y = MAX_Y; y >= MIN_Y; y -= 1) {
          if (this.grid.isSolid(x, y, z)) {
            top = y;
            break;
          }
        }
        if (top === null) continue;
        if (best === null || top > best.top) best = { x, z, top };
      }
    }

    if (!best) return { ok: false, reason: 'No hay terreno firme cerca' };

    this.position.set(best.x + 0.5, best.top + 1 + COLLISION_EPSILON, best.z + 0.5);
    this.velocityY = 0;
    this.grounded = true;
    this.syncMesh(false);
    return { ok: true, x: best.x, z: best.z, layer: best.top };
  }

  /** Cámara: en primera persona va pegada a la mirada; si no, isométrica. */
  updateCamera(camera, deltaTime, immediate = false) {
    if (this.firstPerson) {
      camera.position.set(
        this.position.x,
        this.position.y + FP_EYE_HEIGHT + this.#viewBob(),
        this.position.z
      );
      // Orden YXZ: primero la guiñada y luego la inclinación, como en un FPS.
      // La guiñada lleva +PI porque la cámara mira por su -Z y el modelo
      // orientaba su rostro por +Z.
      FP_EULER.set(this.pitch, this.yaw + Math.PI, 0, 'YXZ');
      camera.quaternion.setFromEuler(FP_EULER);
      return;
    }

    this.cameraTarget.copy(this.position).add(CAMERA_OFFSET);
    if (immediate) {
      camera.position.copy(this.cameraTarget);
    } else {
      camera.position.lerp(this.cameraTarget, 1 - Math.exp(-CAMERA_DAMPING * deltaTime));
    }
    this.lookAt.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
    camera.lookAt(this.lookAt);
  }

  /** Balanceo sutil de cámara: al caminar marca el paso, en reposo respira. */
  #viewBob() {
    const walking = Math.abs(this.limbCycle) > 0.02;
    return walking
      ? Math.abs(Math.sin(this.walkPhase)) * FP_WALK_BOB
      : Math.sin(this.idlePhase) * FP_IDLE_BOB;
  }

  syncMesh(moving = false) {
    if (this.firstPerson) {
      this.mesh.position.set(this.position.x, this.position.y, this.position.z);
      this.mesh.rotation.y = this.yaw;
      return;
    }

    const bob = moving
      ? Math.abs(Math.sin(this.walkPhase)) * 0.035
      : Math.sin(this.idlePhase) * IDLE_BOB;
    this.mesh.position.set(this.position.x, this.position.y + bob, this.position.z);
    this.mesh.rotation.y = this.yaw;
  }

  moveAxisX(amount) {
    if (amount === 0) return;
    const startY = this.position.y;
    this.position.x += amount;

    if (!this.#overlapsSolid()) return;
    if (this.#tryStepUp(startY)) return;

    const push = Math.sign(amount) > 0 ? -1 : 1;
    const range = this.#cellRange();
    for (let y = range.y0; y <= range.y1; y += 1) {
      for (let z = range.z0; z <= range.z1; z += 1) {
        for (let x = range.x0; x <= range.x1; x += 1) {
          if (!this.grid.isSolid(x, y, z)) continue;
          if (push < 0) {
            this.position.x = Math.min(this.position.x, x - PLAYER_RADIUS - COLLISION_EPSILON);
          } else {
            this.position.x = Math.max(this.position.x, x + 1 + PLAYER_RADIUS + COLLISION_EPSILON);
          }
        }
      }
    }
  }

  moveAxisZ(amount) {
    if (amount === 0) return;
    const startY = this.position.y;
    this.position.z += amount;

    if (!this.#overlapsSolid()) return;
    if (this.#tryStepUp(startY)) return;

    const push = Math.sign(amount) > 0 ? -1 : 1;
    const range = this.#cellRange();
    for (let y = range.y0; y <= range.y1; y += 1) {
      for (let z = range.z0; z <= range.z1; z += 1) {
        for (let x = range.x0; x <= range.x1; x += 1) {
          if (!this.grid.isSolid(x, y, z)) continue;
          if (push < 0) {
            this.position.z = Math.min(this.position.z, z - PLAYER_RADIUS - COLLISION_EPSILON);
          } else {
            this.position.z = Math.max(this.position.z, z + 1 + PLAYER_RADIUS + COLLISION_EPSILON);
          }
        }
      }
    }
  }

  /**
   * Escalón automático: si el avance horizontal choca con un desnivel de
   * hasta STEP_HEIGHT, sube al jugador en lugar de bloquearlo. Permite caminar
   * por bordes de un bloque y, combinado con el salto, salir de pozos de dos.
   */
  #tryStepUp(startY) {
    const top = this.#stepTop();
    if (top === null) return false;

    const delta = top - startY;
    if (delta <= 0 || delta > STEP_HEIGHT) return false;

    this.position.y = top + COLLISION_EPSILON;
    if (!this.#overlapsSolid()) {
      this.velocityY = Math.max(0, this.velocityY);
      return true;
    }

    this.position.y = startY;
    return false;
  }

  /** true si la caja del jugador solapa algún bloque sólido. */
  #overlapsSolid() {
    const range = this.#cellRange();
    for (let y = range.y0; y <= range.y1; y += 1) {
      for (let z = range.z0; z <= range.z1; z += 1) {
        for (let x = range.x0; x <= range.x1; x += 1) {
          if (this.grid.isSolid(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  /** Techo del bloque sólido más alto que solapa la caja del jugador. */
  #stepTop() {
    const range = this.#cellRange();
    let top = null;
    for (let y = range.y0; y <= range.y1; y += 1) {
      for (let z = range.z0; z <= range.z1; z += 1) {
        for (let x = range.x0; x <= range.x1; x += 1) {
          if (!this.grid.isSolid(x, y, z)) continue;
          const cellTop = y + 1;
          if (top === null || cellTop > top) top = cellTop;
        }
      }
    }
    return top;
  }

  moveAxisY(amount) {
    if (amount === 0) return;
    this.position.y += amount;
    const range = this.#cellRange();
    const falling = amount < 0;
    let collided = false;

    for (let y = range.y0; y <= range.y1; y += 1) {
      for (let z = range.z0; z <= range.z1; z += 1) {
        for (let x = range.x0; x <= range.x1; x += 1) {
          if (!this.grid.isSolid(x, y, z)) continue;
          collided = true;
          if (falling) {
            this.position.y = Math.max(this.position.y, y + 1 + COLLISION_EPSILON);
          } else {
            this.position.y = Math.min(this.position.y, y - PLAYER_HEIGHT - COLLISION_EPSILON);
          }
        }
      }
    }

    if (collided) this.velocityY = 0;

    if (this.position.y <= WORLD_FLOOR) {
      this.position.y = WORLD_FLOOR;
      this.velocityY = 0;
      this.grounded = true;
    }
  }

  #isGrounded() {
    if (this.position.y <= WORLD_FLOOR + GROUND_TOLERANCE) return true;

    const probe = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
    probe.x0 = Math.floor(this.position.x - PLAYER_RADIUS + COLLISION_EPSILON);
    probe.x1 = Math.floor(this.position.x + PLAYER_RADIUS - COLLISION_EPSILON);
    probe.z0 = Math.floor(this.position.z - PLAYER_RADIUS + COLLISION_EPSILON);
    probe.z1 = Math.floor(this.position.z + PLAYER_RADIUS - COLLISION_EPSILON);
    probe.y0 = Math.floor(this.position.y - GROUND_TOLERANCE);
    probe.y1 = Math.floor(this.position.y - COLLISION_EPSILON);

    for (let y = probe.y0; y <= probe.y1; y += 1) {
      for (let z = probe.z0; z <= probe.z1; z += 1) {
        for (let x = probe.x0; x <= probe.x1; x += 1) {
          if (this.grid.isSolid(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  #cellRange() {
    const range = this.cellRange;
    range.x0 = Math.floor(this.position.x - PLAYER_RADIUS + COLLISION_EPSILON);
    range.x1 = Math.floor(this.position.x + PLAYER_RADIUS - COLLISION_EPSILON);
    range.z0 = Math.floor(this.position.z - PLAYER_RADIUS + COLLISION_EPSILON);
    range.z1 = Math.floor(this.position.z + PLAYER_RADIUS - COLLISION_EPSILON);
    range.y0 = Math.floor(this.position.y + COLLISION_EPSILON);
    range.y1 = Math.floor(this.position.y + PLAYER_HEIGHT - COLLISION_EPSILON);
    return range;
  }

  #updateDirections(camera) {
    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 0.000001) {
      this.forward.set(0, 0, -1);
    } else {
      this.forward.normalize();
    }
    this.right.crossVectors(this.forward, this.up).normalize();
  }

  #createMaterials() {
    return {
      skin: new THREE.MeshLambertMaterial({ color: 0xf2c49b, flatShading: true }),
      shirt: new THREE.MeshLambertMaterial({ color: 0x3f7ac4, flatShading: true }),
      pants: new THREE.MeshLambertMaterial({ color: 0x2f3b52, flatShading: true }),
      hair: new THREE.MeshLambertMaterial({ color: 0x3a2a1c, flatShading: true }),
      eye: new THREE.MeshLambertMaterial({ color: 0x241d19, flatShading: true }),
      metal: new THREE.MeshLambertMaterial({ color: 0xb9c2cb, flatShading: true }),
      wood: new THREE.MeshLambertMaterial({ color: 0x8a5a2b, flatShading: true }),
      seed: new THREE.MeshLambertMaterial({ color: 0xd8c08a, flatShading: true }),
      blueprint: new THREE.MeshLambertMaterial({ color: 0x6fa8dc, flatShading: true }),
      asphalt: new THREE.MeshLambertMaterial({ color: 0x2a2a30, flatShading: true })
    };
  }

  #createModel() {
    const group = new THREE.Group();
    group.name = 'player';
    const materials = this.materials;

    // Piernas con pivote en la cadera y brazos con pivote en el hombro, para
    // que el ciclo de caminar y el golpe giren desde la articulación.
    this.legPivots = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.12, 0.58, 0);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.56, 10), materials.pants);
      leg.position.y = -0.29;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.09, 0.3), materials.pants);
      foot.position.set(0, -0.54, 0.05);
      pivot.add(leg, foot);
      group.add(pivot);
      this.legPivots.push(pivot);
    }

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.62, 12), materials.shirt);
    torso.position.y = 0.87;

    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 0.12, 12), materials.pants);
    collar.position.y = 1.16;

    // La cabeza cuelga de un grupo anclado en el cuello, para poder girarla
    // hacia lo que el jugador está mirando.
    this.head = new THREE.Group();
    this.head.position.y = HEAD_NECK_HEIGHT;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), materials.skin);
    head.position.y = 0.24;

    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      materials.hair
    );
    hair.position.y = 0.26;

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.08), materials.skin);
    nose.position.set(0, 0.22, 0.24);

    // Ojos esféricos y separados: dos cajas anchas se leían como una sola
    // banda oscura a la distancia de la cámara isométrica.
    const eyeGeometry = new THREE.SphereGeometry(0.038, 8, 6);
    const leftEye = new THREE.Mesh(eyeGeometry, materials.eye);
    // Por debajo del borde del flequillo (y = 0.26): a su altura el pelo
    // ocultaba la mitad superior de cada ojo.
    leftEye.position.set(-0.1, 0.23, 0.235);
    const rightEye = new THREE.Mesh(eyeGeometry, materials.eye);
    rightEye.position.set(0.1, 0.23, 0.235);

    this.head.add(head, hair, nose, leftEye, rightEye);
    group.add(torso, collar, this.head);

    this.armBase = [-0.08, -0.4];
    this.armPivots = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.33, 1.1, 0);
      pivot.rotation.x = this.armBase[side < 0 ? 0 : 1];
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.5, 8), materials.shirt);
      arm.position.y = -0.25;
      const handMesh = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), materials.skin);
      handMesh.position.y = -0.52;
      pivot.add(arm, handMesh);
      group.add(pivot);
      this.armPivots.push(pivot);
    }

    // La herramienta cuelga de la mano derecha.
    this.hand = new THREE.Group();
    this.hand.position.set(0, -0.52, 0.1);
    this.armPivots[1].add(this.hand);

    for (const [id, model] of Object.entries(this.toolModels)) {
      model.visible = false;
      this.hand.add(model);
      model.userData.toolId = id;
    }

    // En primera persona todo el cuerpo se oculta menos el brazo derecho,
    // que sostiene la herramienta a la vista.
    this.bodyParts = [torso, collar, this.head, this.legPivots[0], this.legPivots[1], this.armPivots[0]];

    group.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return group;
  }

  #createToolModels() {
    const materials = this.materials;

    const pickaxe = new THREE.Group();
    const pickHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.66, 6), materials.wood);
    pickHandle.position.set(0, 0.14, 0.16);
    pickHandle.rotation.x = -0.55;
    const pickHead = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.075, 0.085), materials.metal);
    pickHead.position.set(0, 0.44, 0.05);
    const pickTipA = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), materials.metal);
    pickTipA.position.set(0.24, 0.44, 0.05);
    pickTipA.rotation.z = -Math.PI / 2;
    const pickTipB = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), materials.metal);
    pickTipB.position.set(-0.24, 0.44, 0.05);
    pickTipB.rotation.z = Math.PI / 2;
    pickaxe.add(pickHandle, pickHead, pickTipA, pickTipB);

    // El mango inclina el extremo libre hacia abajo y adelante: la hoja va
    // anclada a ese extremo, no flotando por delante de la mano.
    const hoe = new THREE.Group();
    const hoeHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.62, 6), materials.wood);
    hoeHandle.position.set(0, 0.1, 0.14);
    hoeHandle.rotation.x = -0.5;
    const hoeBlade = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.055, 0.2), materials.metal);
    hoeBlade.position.set(0, -0.2, 0.3);
    hoeBlade.rotation.x = 0.35;
    const hoeFerrule = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.09, 6), materials.metal);
    hoeFerrule.position.set(0, -0.16, 0.28);
    hoeFerrule.rotation.x = -0.5;
    hoe.add(hoeHandle, hoeFerrule, hoeBlade);

    const seeds = new THREE.Group();
    const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), materials.seed);
    pouch.position.set(0, 0.04, 0.18);
    pouch.scale.set(1, 1.15, 0.9);
    const pouchCord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 4), materials.wood);
    pouchCord.position.set(0, 0.2, 0.18);
    const grainA = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), materials.wood);
    grainA.position.set(0.08, 0.14, 0.1);
    const grainB = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), materials.wood);
    grainB.position.set(-0.07, 0.16, 0.24);
    seeds.add(pouch, pouchCord, grainA, grainB);

    const road = new THREE.Group();
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.34, 12), materials.asphalt);
    roller.position.set(0, -0.02, 0.2);
    roller.rotation.z = Math.PI / 2;
    const rollerFrame = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), materials.metal);
    rollerFrame.position.set(0, 0.2, 0.12);
    rollerFrame.rotation.x = -0.35;
    road.add(roller, rollerFrame);

    const building = new THREE.Group();
    const blueprint = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.32), materials.blueprint);
    blueprint.position.set(0, 0.04, 0.12);
    blueprint.rotation.x = 0.25;
    const modelRoof = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.11, 4), materials.metal);
    modelRoof.position.set(0, 0.14, 0.12);
    modelRoof.rotation.y = Math.PI / 4;
    building.add(blueprint, modelRoof);

    return { pickaxe, hoe, seeds, road, building };
  }
}
