import * as THREE from 'three';
import { AVATARS, createAvatar } from './avatars.js';
import { inviteLink, normalizeRoomCode, randomRoomCode } from './net.js';

const NAME_KEY = 'epam-city-name';
const $ = id => document.getElementById(id);

// Turntable preview of the selected avatar, rendered into its own small canvas.
function createPreview(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#334', 2));
  const key = new THREE.DirectionalLight('#ffffff', 2.5);
  key.position.set(2, 4, 3);
  const rim = new THREE.DirectionalLight('#39c2d7', 3);
  rim.position.set(-3, 2, -3);
  scene.add(key, rim);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.04, 48),
    new THREE.MeshStandardMaterial({ color: '#15181d', emissive: '#0b3e47', roughness: 0.4 }));
  disc.position.y = -0.02;
  scene.add(disc);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 1.25, 4.4);
  camera.lookAt(0, 0.9, 0);

  let avatar = null;
  const clock = new THREE.Clock();
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (avatar) {
      avatar.root.rotation.y += dt * 0.6;
      avatar.update(dt);
    }
    renderer.render(scene, camera);
  });

  return {
    show(next) {
      if (avatar) scene.remove(avatar.root);
      avatar = next;
      if (avatar) { avatar.root.rotation.y = 0.4; scene.add(avatar.root); }
    },
    stop() { renderer.setAnimationLoop(null); },
  };
}

export function createMenu({ onJoin }) {
  const menu = $('menu');
  const nameInput = $('player-name');
  const joinBtn = $('join');
  const status = $('avatar-status');
  const preview = createPreview($('avatar-preview'));
  const dots = $('avatar-dots');
  dots.innerHTML = AVATARS.map(() => '<i></i>').join('');

  let index = 0;
  let token = 0;

  async function select(i) {
    index = (i + AVATARS.length) % AVATARS.length;
    const def = AVATARS[index];
    $('avatar-name').textContent = def.name;
    $('avatar-blurb').textContent = def.blurb;
    [...dots.children].forEach((d, n) => d.classList.toggle('on', n === index));
    status.textContent = 'Loading…';
    preview.show(null);
    const mine = ++token;
    try {
      const avatar = await createAvatar(def);
      if (mine !== token) return;
      preview.show(avatar);
      status.textContent = '';
    } catch (e) {
      if (mine !== token) return;
      console.warn('Avatar failed to load', def.file, e);
      status.textContent = 'Could not download this avatar. The EPAM Consultant will be used instead.';
    }
  }

  const validate = () => { joinBtn.disabled = nameInput.value.trim().length === 0; };
  const join = () => {
    if (joinBtn.disabled) return;
    const name = nameInput.value.trim();
    localStorage.setItem(NAME_KEY, name);
    onJoin({ name, def: AVATARS[index], room: normalizeRoomCode(roomInput.value) || null });
  };

  // ---- optional multiplayer room: create one, or arrive through an invite link (?room=CODE)
  const roomInput = $('room-input');
  const showRoom = () => {
    const code = normalizeRoomCode(roomInput.value);
    if (roomInput.value !== code) roomInput.value = code;
    const ready = code.length === 6;
    $('room-invite').hidden = !ready;
    $('room-link').textContent = ready ? inviteLink(code) : '';
    $('room-note').textContent = !code ? 'Leave empty to play solo.'
      : ready ? 'Send the invite link to friends. Your browser will ask to use the microphone.'
        : 'Room codes have 6 characters.';
  };
  roomInput.value = normalizeRoomCode(new URLSearchParams(location.search).get('room'));
  roomInput.addEventListener('input', showRoom);
  roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  $('room-create').onclick = () => { roomInput.value = randomRoomCode(); showRoom(); };
  $('room-link-copy').onclick = async () => {
    const btn = $('room-link-copy');
    try { await navigator.clipboard.writeText($('room-link').textContent); btn.textContent = 'Copied!'; }
    catch { prompt('Copy this invite link:', $('room-link').textContent); }
    setTimeout(() => { btn.textContent = 'Copy invite'; }, 1500);
  };
  showRoom();

  nameInput.value = localStorage.getItem(NAME_KEY) || '';
  nameInput.addEventListener('input', validate);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  $('avatar-prev').onclick = () => select(index - 1);
  $('avatar-next').onclick = () => select(index + 1);
  addEventListener('keydown', e => {
    if (menu.hidden || e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowLeft') select(index - 1);
    if (e.key === 'ArrowRight') select(index + 1);
  });
  joinBtn.onclick = join;

  validate();
  select(0);
  nameInput.focus();

  return {
    hide() { menu.hidden = true; preview.stop(); },
  };
}
