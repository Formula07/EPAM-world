import * as THREE from 'three';

export const EPAM_CYAN = '#39c2d7';

const cache = new Map();

export function textTexture(draw, width, height) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  draw(c.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function cached(key, draw, width, height) {
  if (!cache.has(key)) cache.set(key, textTexture(draw, width, height));
  return cache.get(key);
}

// Draws "<epam>" (optionally followed by a word like "CAB") centered on (cx, cy), shrunk to fit maxWidth.
export function drawEpamLogo(g, cx, cy, size, { word = '#ffffff', suffix = '', maxWidth = Infinity } = {}) {
  const parts = [['<', EPAM_CYAN], ['epam', word], ['>', EPAM_CYAN]];
  if (suffix) parts.push([' ' + suffix, word]);
  g.save();
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = `bold ${size}px Inter, Arial, sans-serif`;
  let total = parts.reduce((sum, [t]) => sum + g.measureText(t).width, 0);
  if (total > maxWidth) {
    size *= maxWidth / total;
    g.font = `bold ${size}px Inter, Arial, sans-serif`;
    total = parts.reduce((sum, [t]) => sum + g.measureText(t).width, 0);
  }
  let x = cx - total / 2;
  for (const [t, color] of parts) {
    g.fillStyle = color;
    g.fillText(t, x, cy);
    x += g.measureText(t).width;
  }
  g.restore();
}

// "<epam> SUFFIX" on an optional background, 4:1 aspect. Shared between all meshes that use it.
export function brandTexture(suffix = '', { fg = '#ffffff', bg = null, w = 512, h = 128 } = {}) {
  return cached(`brand:${suffix}:${fg}:${bg}:${w}x${h}`, (g) => {
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    drawEpamLogo(g, w / 2, h / 2, h * 0.62, { word: fg, suffix, maxWidth: w * 0.92 });
  }, w, h);
}

// Plain uppercase label, e.g. building name plaques.
export function labelTexture(text, { fg = '#ffffff', bg = '#15181d', w = 1024, h = 128 } = {}) {
  return cached(`label:${text}:${fg}:${bg}:${w}x${h}`, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = EPAM_CYAN; g.fillRect(0, h - 8, w, 8);
    g.fillStyle = fg;
    g.font = `600 ${Math.round(h * 0.45)}px Inter, Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text.toUpperCase(), w / 2, h * 0.47, w * 0.94);
  }, w, h);
}
