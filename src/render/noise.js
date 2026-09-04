/** Small deterministic interpolation and random helpers shared by render modules. */

export const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

export function smoothstep(min, max, value) {
  const t = clamp01((value - min) / (max - min));
  return t * t * (3 - 2 * t);
}

export function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Stable pseudo-random sequence for reproducible particle and ring layouts. */
export function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

export function seedOf(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
