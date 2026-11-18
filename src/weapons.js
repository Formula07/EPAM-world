import * as THREE from 'three';
import { brandTexture } from './branding.js';

// Melee weapons. range in metres, arc is the half-angle of the hit cone in radians.
export const FISTS = { id: 'fists', name: 'Fists', damage: 18, range: 1.5, arc: 1.0, cooldown: 0.42, force: 3 };

export const LAPTOPS = {
  thinkpad: { id: 'thinkpad', name: 'EPAM ThinkPad', damage: 40, range: 1.9, arc: 1.1, cooldown: 0.55, force: 5, body: '#1c1e22', lid: '#26292e' },
  macbook: { id: 'macbook', name: 'EPAM MacBook', damage: 32, range: 1.8, arc: 1.1, cooldown: 0.38, force: 4, body: '#c5c9cf', lid: '#d9dce0' },
  gaming: { id: 'gaming', name: 'EPAM Gaming Rig', damage: 70, range: 2.1, arc: 1.2, cooldown: 0.85, force: 9, body: '#24152e', lid: '#1a1020', glow: '#ff3df0' },
};

export const LAPTOP_IDS = Object.keys(LAPTOPS);

const baseGeo = new THREE.BoxGeometry(0.34, 0.022, 0.24);
const lidGeo = new THREE.BoxGeometry(0.34, 0.014, 0.24);
const logoGeo = new THREE.PlaneGeometry(0.16, 0.04).rotateX(-Math.PI / 2);
const glowGeo = new THREE.BoxGeometry(0.345, 0.006, 0.245);
const mats = new Map();
const mat = (color, opts = {}) => {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.4, ...opts }));
  return mats.get(key);
};
let logoMat = null;

// Closed laptop lying flat: long side along X, lid (with the logo) facing +Y.
export function createLaptopMesh(id) {
  const t = LAPTOPS[id] || LAPTOPS.thinkpad;
  logoMat ??= new THREE.MeshBasicMaterial({ map: brandTexture(''), transparent: true, toneMapped: false });
  const g = new THREE.Group();
  const base = new THREE.Mesh(baseGeo, mat(t.body));
  base.position.y = 0.011;
  const lid = new THREE.Mesh(lidGeo, mat(t.lid));
  lid.position.y = 0.029;
  const logo = new THREE.Mesh(logoGeo, logoMat);
  logo.position.y = 0.0365;
  g.add(base, lid, logo);
  if (t.glow) {
    const glow = new THREE.Mesh(glowGeo, mat(t.glow, { emissive: t.glow, emissiveIntensity: 1.5 }));
    glow.position.y = 0.021;
    g.add(glow);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
