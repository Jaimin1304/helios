// 轻量程序化噪声工具（临时表面材质用，后续会被真实纹理取代）

function hash3(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** 3D 值噪声，返回 [0,1)。在球面方向上采样即可天然无缝。 */
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smoother(x - xi), yf = smoother(y - yi), zf = smoother(z - zi);

  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);

  const x00 = c000 + (c100 - c000) * xf;
  const x10 = c010 + (c110 - c010) * xf;
  const x01 = c001 + (c101 - c001) * xf;
  const x11 = c011 + (c111 - c011) * xf;
  const y0 = x00 + (x10 - x00) * yf;
  const y1 = x01 + (x11 - x01) * yf;
  return y0 + (y1 - y0) * zf;
}

/** 分形叠加，返回 [0,1] */
export function fbm(x, y, z, octaves = 5, lacunarity = 2.07, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * f, y * f, z * f);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

/** 脊状噪声，适合做山脉/裂纹感 */
export function ridged(x, y, z, octaves = 4, lacunarity = 2.13, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (1 - Math.abs(noise3(x * f, y * f, z * f) * 2 - 1));
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * 把调色板编译成 256 级查找表，采样时只需一次索引。
 * @param {string[]} palette 由暗到亮的若干 hex 颜色
 */
export function makeRamp(palette) {
  const stops = palette.map(hexToRgb);
  const lut = new Uint8Array(256 * 3);
  const seg = stops.length - 1;
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * seg;
    const k = Math.min(seg - 1, Math.floor(t));
    const f = t - k;
    for (let c = 0; c < 3; c++) {
      lut[i * 3 + c] = stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f;
    }
  }
  return lut;
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** 稳定的伪随机序列（同一 seed 每次生成相同表面） */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
