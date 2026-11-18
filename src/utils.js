export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

export const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

export const randRange = (lo, hi, rnd = Math.random) => lo + (hi - lo) * rnd();

export const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// heading convention used everywhere: heading 0 faces +Z, forward = (sin h, cos h)
export const headingTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
