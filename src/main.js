import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildWorld } from './world.js';
import { createAvatar, FALLBACK_AVATAR } from './avatars.js';
import { createMenu } from './menu.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Game } from './game.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const labels = new CSS2DRenderer();
Object.assign(labels.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
document.body.insertBefore(labels.domElement, canvas.nextSibling);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
const world = buildWorld(scene);
const input = new Input(canvas);
const sfx = new Sfx();

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let game = null;
let joining = false;

const menu = createMenu({ onJoin: join });

function lockPointer() {
  sfx.unlock();
  // returns a promise in Chromium and undefined elsewhere; it rejects when not called from a user gesture
  try { canvas.requestPointerLock()?.catch?.(() => {}); } catch {}
}

async function join({ name, def }) {
  if (joining) return;
  joining = true;
  sfx.unlock();                   // JOIN is a user gesture, so audio may start now
  document.activeElement?.blur(); // so Space doesn't re-press the JOIN button
  const loading = document.getElementById('loading');
  loading.hidden = false;
  let avatar;
  try {
    avatar = await createAvatar(def);
  } catch (e) {
    console.warn('Falling back to the EPAM Consultant', e);
    avatar = await createAvatar(FALLBACK_AVATAR);
  }
  menu.hide();
  loading.hidden = true;

  const tag = document.createElement('div');
  tag.className = 'name-tag';
  tag.textContent = name;
  const nameTag = new CSS2DObject(tag);
  nameTag.position.set(0, 2.15, 0);
  avatar.root.add(nameTag);

  input.clearQueue();
  game = new Game({ scene, camera, canvas, world, input, avatar, name, nameTag, sfx });
  canvas.addEventListener('click', lockPointer);
  lockPointer();
}

const clock = new THREE.Clock();
let menuTime = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (game) {
    game.update(dt);
  } else {
    // slow cinematic orbit behind the start screen
    menuTime += dt;
    const a = menuTime * 0.05 + 0.6;
    camera.position.set(Math.sin(a) * 75, 26, Math.cos(a) * 75 - 15);
    camera.lookAt(0, 14, -25);
  }
  renderer.render(scene, camera);
  labels.render(scene, camera);
});
