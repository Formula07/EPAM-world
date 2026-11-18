import * as THREE from 'three';
import { lerpAngle } from './utils.js';

const MIN_PITCH = -0.35;
const MAX_PITCH = 1.1;
const SENSITIVITY = 0.0025;

const _pivot = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ray = new THREE.Ray();

// Orbiting third-person camera that pulls in when a wall is between it and the player.
export class ThirdPersonCamera {
  constructor(camera, octree, dom) {
    this.camera = camera;
    this.octree = octree;
    this.yaw = 0;
    this.pitch = 0.25;
    this.zoom = 1;
    this.baseDistance = 4.5;
    this.pivotHeight = 1.55;
    this.current = this.baseDistance;
    this.lastMouse = 0;
    this.shake = 0;

    dom.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== dom) return;
      this.yaw -= e.movementX * SENSITIVITY;
      this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * SENSITIVITY, MIN_PITCH, MAX_PITCH);
      this.lastMouse = performance.now();
    });
    dom.addEventListener('wheel', e => {
      this.zoom = THREE.MathUtils.clamp(this.zoom + e.deltaY * 0.001, 0.45, 2);
    }, { passive: true });
  }

  // On foot: 4.5m behind the head. Vehicles pass their own distance/height.
  setMode(distance = 4.5, pivotHeight = 1.55) {
    this.baseDistance = distance;
    this.pivotHeight = pivotHeight;
  }

  // Swing behind a vehicle's heading unless the player recently moved the mouse.
  follow(heading, dt, rate = 2.5) {
    if (performance.now() - this.lastMouse < 1500) return;
    this.yaw = lerpAngle(this.yaw, heading + Math.PI, 1 - Math.exp(-rate * dt));
    this.pitch += (0.22 - this.pitch) * (1 - Math.exp(-rate * dt));
  }

  // heading the camera looks along (same convention as characters: 0 = +Z)
  get lookHeading() { return this.yaw + Math.PI; }

  update(dt, focus) {
    _pivot.copy(focus).y += this.pivotHeight;
    _dir.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    _ray.set(_pivot, _dir);
    let wanted = this.baseDistance * this.zoom;
    const hit = this.octree.rayIntersect(_ray);
    if (hit && hit.distance < wanted + 0.3) wanted = Math.max(0.6, hit.distance - 0.3);
    // snap in instantly when blocked, ease back out when clear
    this.current = wanted < this.current ? wanted : THREE.MathUtils.lerp(this.current, wanted, 1 - Math.exp(-5 * dt));

    this.camera.position.copy(_pivot).addScaledVector(_dir, this.current);
    this.camera.lookAt(_pivot);
    if (this.shake > 0.01) {
      const s = this.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }
  }
}
