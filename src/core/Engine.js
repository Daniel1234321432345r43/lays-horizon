/**
 * Engine.js
 * WebGLRenderer, escena, cámara isométrica y gestión de resize.
 */

import * as THREE from 'three';

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // El mapa de sombras no se recalcula solo: el pase completo de la escena
    // cuesta más que el render principal. Se marca sucio cuando algo que
    // proyecta sombra cambia (el jugador se mueve o el mundo se edita) y un
    // refresco periódico cubre lo que no se puede detectar por cambios.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.shadowTimer = 0;
    this.shadowInterval = 0.5;

    // El cielo, la niebla y las luces los aporta Lighting.js.
    this.scene = new THREE.Scene();

    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 400);
    this.camera.position.set(15, 18, 15);
    this.camera.lookAt(0, 1, 0);

    this.handleResize = () => this.resize();
    window.addEventListener('resize', this.handleResize);
    this.resize();
  }

  resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Fuerza el recálculo del mapa de sombras en el siguiente render. */
  requestShadowUpdate() {
    this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * Render de un frame. `deltaTime` se usa para el refresco de seguridad del
   * mapa de sombras, que mantiene las sombras al día aunque nada marque
   * cambios (por ejemplo la respiración en reposo del jugador).
   */
  render(deltaTime) {
    this.shadowTimer += deltaTime;
    if (this.shadowTimer >= this.shadowInterval) {
      this.shadowTimer = 0;
      this.requestShadowUpdate();
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
  }
}
