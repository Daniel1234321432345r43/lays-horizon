/**
 * Lighting.js
 * Atmósfera completa de la escena: domo de cielo con degradado en los vértices,
 * niebla a juego con el horizonte, sol direccional con sombras, luz ambiental
 * de relleno y luz hemisférica que tiñe cielo y suelo.
 */

import * as THREE from 'three';

const SKY_RADIUS = 240;

/* Caja que encierra todo lo que proyecta sombra: el terreno de 30x30 con sus
   6 capas de profundidad, los edificios y el propio jugador. */
const SHADOW_BOUNDS_MIN = new THREE.Vector3(-15.5, -5.5, -15.5);
const SHADOW_BOUNDS_MAX = new THREE.Vector3(15.5, 3.5, 15.5);
const SHADOW_MARGIN = 1.5;

export const HORIZON_COLOR = 0xd9ecff;
const ZENITH_COLOR = 0x3c7cc4;
const GROUND_HAZE = 0x8ea98c;

/** Domo invertido con degradado cenit -> horizonte -> bruma del suelo. */
function createSkyDome() {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 20);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);

  const horizon = new THREE.Color(HORIZON_COLOR);
  const zenith = new THREE.Color(ZENITH_COLOR);
  const ground = new THREE.Color(GROUND_HAZE);
  const vertex = new THREE.Vector3();
  const color = new THREE.Color();

  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i).normalize();
    if (vertex.y >= 0) {
      color.copy(horizon).lerp(zenith, Math.pow(vertex.y, 0.6));
    } else {
      color.copy(horizon).lerp(ground, Math.pow(-vertex.y, 0.7));
    }
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    toneMapped: false
  });

  const sky = new THREE.Mesh(geometry, material);
  sky.name = 'sky';
  sky.renderOrder = -1;
  return sky;
}

export class Lighting {
  constructor(scene) {
    this.sky = createSkyDome();
    scene.add(this.sky);

    scene.background = new THREE.Color(HORIZON_COLOR);
    scene.fog = new THREE.Fog(HORIZON_COLOR, 46, 120);

    this.hemisphere = new THREE.HemisphereLight(0xd3ebff, 0x6f5638, 1.0);
    this.hemisphere.position.set(0, 40, 0);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.28);

    this.sun = new THREE.DirectionalLight(0xfff1cf, 2.15);
    this.sun.position.set(22, 34, 15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // El recálculo del mapa se gobierna desde Engine.requestShadowUpdate(); a
    // nivel de luz se deja autoUpdate activo para que el pase, cuando corre,
    // incluya siempre a esta luz.
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;

    this.sun.target.position.set(0, -2, 0);
    this.#fitShadowCamera();

    scene.add(this.sun, this.sun.target, this.hemisphere, this.ambient);
  }

  /**
   * Ajusta el volumen ortogonal de la sombra a la caja real del mundo.
   * La caja fija de 48x48 dejaba fuera del mapa un 4% de resolución utilizable:
   * ajustada, la misma textura de 2048 da más texels por bloque (44.6 frente a
   * 42.7) y no se dibuja ni un píxel de sombra que no pueda verse.
   */
  #fitShadowCamera() {
    const shadowCamera = this.sun.shadow.camera;
    const origin = this.sun.position;
    const forward = new THREE.Vector3().subVectors(this.sun.target.position, origin).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();
    const up = new THREE.Vector3().crossVectors(forward, right).normalize();
    const corner = new THREE.Vector3();

    let halfWidth = 0;
    let halfHeight = 0;
    let near = Infinity;
    let far = -Infinity;

    for (let i = 0; i < 8; i += 1) {
      corner
        .set(
          i & 1 ? SHADOW_BOUNDS_MAX.x : SHADOW_BOUNDS_MIN.x,
          i & 2 ? SHADOW_BOUNDS_MAX.y : SHADOW_BOUNDS_MIN.y,
          i & 4 ? SHADOW_BOUNDS_MAX.z : SHADOW_BOUNDS_MIN.z
        )
        .sub(origin);

      halfWidth = Math.max(halfWidth, Math.abs(corner.dot(right)));
      halfHeight = Math.max(halfHeight, Math.abs(corner.dot(up)));
      const depth = corner.dot(forward);
      near = Math.min(near, depth);
      far = Math.max(far, depth);
    }

    halfWidth = Math.ceil(halfWidth) + SHADOW_MARGIN;
    halfHeight = Math.ceil(halfHeight) + SHADOW_MARGIN;

    shadowCamera.left = -halfWidth;
    shadowCamera.right = halfWidth;
    shadowCamera.top = halfHeight;
    shadowCamera.bottom = -halfHeight;
    shadowCamera.near = Math.max(1, near - 6);
    shadowCamera.far = far + 6;
    shadowCamera.updateProjectionMatrix();
  }

  dispose() {
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.sun.shadow.dispose();
    this.sun.dispose();
    this.hemisphere.dispose();
    this.ambient.dispose();
  }
}
