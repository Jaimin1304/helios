import { CanvasTexture, SRGBColorSpace, LinearSRGBColorSpace, RepeatWrapping } from 'three';
import { fbm, ridged, makeRamp, clamp01, smoothstep, rng, seedOf, hexToRgb } from './noise.js';

/**
 * 程序化天体表面。生成等距柱状投影(equirectangular)的 albedo + 高度图。
 * 噪声在球面方向上采样，因此左右接缝天然连续。
 *
 * ⚠️ 这是"占位"材质，等后续接入真实纹理时整个模块可以直接换掉，
 *    对外只需保持 makeSurface(def) → {map, bump} 这个接口。
 */

function sizeFor(def) {
  if (def.kind === 'star') return [512, 256];
  if (def.style === 'banded') return [768, 384];
  if (def.kind === 'planet') return [512, 256];
  if (def.radius > 900) return [384, 192];
  if (def.radius > 150) return [256, 128];
  return [128, 64];
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 在等距柱状图上画一个环形山（含边缘的经度拉伸补偿与横向绕回） */
function drawCrater(ctx, cx, cy, r, W, sx, strength) {
  for (const dx of [0, -W, W]) {
    ctx.save();
    ctx.translate(cx + dx, cy);
    ctx.scale(sx, 1);
    const g = ctx.createRadialGradient(0, 0, r * 0.05, 0, 0, r);
    g.addColorStop(0.0, `rgba(0,0,0,${0.34 * strength})`);
    g.addColorStop(0.62, `rgba(0,0,0,${0.21 * strength})`);
    g.addColorStop(0.82, `rgba(0,0,0,${0.04 * strength})`);
    g.addColorStop(0.90, `rgba(255,255,255,${0.14 * strength})`);
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** 沿大圆画一条裂纹（冰卫星） */
function drawCrack(ctx, W, H, rand, color, width) {
  // 随机正交基，构造一条大圆
  const a = rand() * Math.PI * 2, b = Math.acos(2 * rand() - 1);
  const u = [Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b)];
  const t = rand() * Math.PI * 2;
  let v = [Math.cos(t), Math.sin(t), 0];
  // 施密特正交化
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  v = [v[0] - d * u[0], v[1] - d * u[1], v[2] - d * u[2]];
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  v = [v[0] / len, v[1] / len, v[2] / len];

  const start = rand() * Math.PI * 2;
  const span = (0.4 + rand() * 1.5) * Math.PI;
  const steps = 90;

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let prevX = null;
  for (let i = 0; i <= steps; i++) {
    const th = start + (span * i) / steps;
    const c = Math.cos(th), s = Math.sin(th);
    const p = [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s];
    const lon = Math.atan2(p[1], p[0]);
    const lat = Math.asin(Math.max(-1, Math.min(1, p[2])));
    const x = ((lon + Math.PI) / (2 * Math.PI)) * W;
    const y = (0.5 - lat / Math.PI) * H;
    if (prevX === null || Math.abs(x - prevX) > W * 0.5) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    prevX = x;
  }
  ctx.stroke();
}

export function makeSurface(def) {
  const [W, H] = sizeFor(def);
  const ramp = makeRamp(def.palette || ['#3a3a3a', '#7a7a7a', '#b0b0b0', '#e0e0e0']);
  const seed = seedOf(def.id);
  const rand = rng(seed);
  const jitter = (seed % 997) * 0.37; // 每个天体的噪声偏移，避免长得一样

  const colorCanvas = makeCanvas(W, H);
  const cctx = colorCanvas.getContext('2d', { willReadFrequently: false });
  const cimg = cctx.createImageData(W, H);
  const cdata = cimg.data;

  const wantsBump = def.style !== 'banded' && def.style !== 'star' && def.style !== 'cloudy';
  let hdata = null;
  if (wantsBump) hdata = new Uint8ClampedArray(W * H * 4);

  const octaves = W >= 512 ? 6 : W >= 256 ? 5 : 4;
  const bands = def.bands || 6;

  for (let j = 0; j < H; j++) {
    const lat = Math.PI / 2 - ((j + 0.5) / H) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    const latN = lat / (Math.PI / 2); // -1..1
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W) * 2 * Math.PI - Math.PI;
      const dx = cl * Math.cos(lon) + jitter;
      const dy = cl * Math.sin(lon) + jitter;
      const dz = sl + jitter;

      let t; // 0..1 → 调色板
      let height = 0.5;

      switch (def.style) {
        case 'star': {
          const gran = fbm(dx * 26, dy * 26, dz * 26, 4);
          const cell = ridged(dx * 12, dy * 12, dz * 12, 3);
          t = clamp01(0.55 + (gran - 0.5) * 0.85 + (cell - 0.5) * 0.4);
          break;
        }
        case 'banded': {
          const warp = (fbm(dx * 2.4, dy * 2.4, dz * 2.4, 4) - 0.5) * 0.55;
          const fine = (fbm(dx * 9, dy * 22, dz * 9, 4) - 0.5) * 0.22;
          const s = Math.sin((latN * bands + warp * 1.6) * Math.PI);
          t = clamp01(0.5 + 0.42 * s + fine);
          // 极区略暗
          t *= 1 - 0.28 * Math.pow(Math.abs(latN), 3.5);
          break;
        }
        case 'cloudy': {
          const n = fbm(dx * 3.5, dy * 8, dz * 3.5, 5);
          const swirl = fbm(dx * 1.6 + n, dy * 4 + n, dz * 1.6, 3);
          t = clamp01(0.45 + (n - 0.5) * 0.9 + (swirl - 0.5) * 0.5);
          break;
        }
        case 'terrestrial': {
          const cont = fbm(dx * 1.9, dy * 1.9, dz * 1.9, octaves);
          const detail = fbm(dx * 7, dy * 7, dz * 7, 4);
          const land = cont + (detail - 0.5) * 0.14;
          const ice = smoothstep(0.72, 0.95, Math.abs(latN));
          if (land < 0.52) {
            // 海洋：深浅两级
            t = clamp01((land / 0.52) * 0.28);
            height = 0.34;
          } else {
            const alt = (land - 0.52) / 0.48;
            t = clamp01(0.5 + alt * 0.45 + (detail - 0.5) * 0.12);
            height = 0.5 + alt * 0.5;
          }
          if (ice > 0) t = t + (1 - t) * ice;
          break;
        }
        case 'desert': {
          const base = fbm(dx * 2.6, dy * 2.6, dz * 2.6, octaves);
          const dust = fbm(dx * 11, dy * 11, dz * 11, 4);
          t = clamp01(0.2 + base * 0.75 + (dust - 0.5) * 0.28);
          const cap = smoothstep(0.86, 0.99, Math.abs(latN));
          t = t + (1 - t) * cap * 0.92;
          height = clamp01(base * 0.8 + dust * 0.2);
          break;
        }
        case 'volcanic': {
          const flows = fbm(dx * 3.4, dy * 3.4, dz * 3.4, octaves);
          const vents = ridged(dx * 8, dy * 8, dz * 8, 4);
          t = clamp01(0.25 + flows * 0.8 + Math.pow(vents, 6) * 0.9 - 0.1);
          height = clamp01(flows);
          break;
        }
        case 'icy': {
          const base = fbm(dx * 2.8, dy * 2.8, dz * 2.8, octaves);
          const fine = fbm(dx * 14, dy * 14, dz * 14, 4);
          t = clamp01(0.42 + base * 0.55 + (fine - 0.5) * 0.24);
          height = clamp01(base * 0.7 + fine * 0.3);
          break;
        }
        case 'cratered':
        default: {
          const base = fbm(dx * 2.2, dy * 2.2, dz * 2.2, octaves);
          const rough = fbm(dx * 9, dy * 9, dz * 9, 4);
          const mare = smoothstep(0.42, 0.5, base) * 0.35; // 暗色平原
          t = clamp01(0.22 + base * 0.72 + (rough - 0.5) * 0.3 - mare);
          height = clamp01(base * 0.65 + rough * 0.35);
          break;
        }
      }

      const idx = (j * W + i) * 4;
      const li = (clamp01(t) * 255) | 0;
      cdata[idx] = ramp[li * 3];
      cdata[idx + 1] = ramp[li * 3 + 1];
      cdata[idx + 2] = ramp[li * 3 + 2];
      cdata[idx + 3] = 255;

      if (hdata) {
        const hv = (clamp01(height) * 255) | 0;
        hdata[idx] = hv;
        hdata[idx + 1] = hv;
        hdata[idx + 2] = hv;
        hdata[idx + 3] = 255;
      }
    }
  }

  cctx.putImageData(cimg, 0, 0);

  let bumpCanvas = null, bctx = null;
  if (hdata) {
    bumpCanvas = makeCanvas(W, H);
    bctx = bumpCanvas.getContext('2d');
    bctx.putImageData(new ImageData(hdata, W, H), 0, 0);
  }

  // ---- 后期：环形山 / 裂纹 / 大红斑 ----
  if (def.craters) {
    for (let k = 0; k < def.craters; k++) {
      const lat = Math.asin(2 * rand() - 1) * 0.94;
      const cy = (0.5 - lat / Math.PI) * H;
      const cx = rand() * W;
      // 幂律尺寸分布：绝大多数是小坑，偶尔一个大盆地
      const r = (0.0035 + Math.pow(rand(), 4) * 0.05) * W;
      const sx = Math.min(4, 1 / Math.max(0.25, Math.cos(lat)));
      const strength = 0.45 + rand() * 0.55;
      drawCrater(cctx, cx, cy, r, W, sx, strength);
      if (bctx) drawCrater(bctx, cx, cy, r, W, sx, strength * 1.3);
    }
  }

  if (def.cracks) {
    const tint = def.palette ? def.palette[0] : '#404040';
    const [r0, g0, b0] = hexToRgb(tint);
    for (let k = 0; k < def.cracks; k++) {
      const alpha = 0.10 + rand() * 0.28;
      drawCrack(cctx, W, H, rand, `rgba(${r0},${g0},${b0},${alpha})`, 0.6 + rand() * 2.2);
      if (bctx) drawCrack(bctx, W, H, rand, `rgba(0,0,0,${alpha * 0.8})`, 0.6 + rand() * 2);
    }
  }

  if (def.spot) {
    const { lat, lon, size, color } = def.spot;
    const cx = ((lon + 180) / 360) * W;
    const cy = (0.5 - lat / 180) * H;
    const rx = size * W * 0.5, ry = size * H * 0.62;
    cctx.save();
    cctx.translate(cx, cy);
    cctx.scale(1, ry / rx);
    const g = cctx.createRadialGradient(0, 0, rx * 0.15, 0, 0, rx);
    g.addColorStop(0, color);
    g.addColorStop(0.6, color + 'b0');
    g.addColorStop(1, color + '00');
    cctx.fillStyle = g;
    cctx.beginPath();
    cctx.arc(0, 0, rx, 0, Math.PI * 2);
    cctx.fill();
    cctx.restore();
  }

  const map = new CanvasTexture(colorCanvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  map.wrapS = RepeatWrapping;

  let bump = null;
  if (bumpCanvas) {
    bump = new CanvasTexture(bumpCanvas);
    bump.colorSpace = LinearSRGBColorSpace;
    bump.wrapS = RepeatWrapping;
  }

  return { map, bump };
}

/** 土星/天王星环：1D 径向 RGBA 带（含卡西尼缝） */
export function makeRingTexture(def) {
  const N = 1024;
  const canvas = makeCanvas(N, 1);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(N, 1);
  const [r0, g0, b0] = hexToRgb(def.rings.tint || '#d0c0a0');
  const rand = rng(seedOf(def.id + 'ring'));
  const noiseSeed = rand() * 100;

  for (let i = 0; i < N; i++) {
    const x = i / (N - 1); // 0=内缘 1=外缘
    let a = 1;
    // 大尺度分区
    a *= 0.35 + 0.65 * smoothstep(0.0, 0.08, x);
    a *= 1 - smoothstep(0.93, 1.0, x);
    if (def.id === 'saturn') {
      const cassini = 1 - 0.88 * Math.exp(-Math.pow((x - 0.70) / 0.028, 2));
      const encke = 1 - 0.5 * Math.exp(-Math.pow((x - 0.90) / 0.006, 2));
      const bRing = 0.55 + 0.45 * smoothstep(0.18, 0.30, x) * (1 - smoothstep(0.62, 0.70, x));
      a *= cassini * encke * (0.55 + bRing);
    }
    // 细环纹
    let fine = 0;
    for (let o = 1; o <= 4; o++) {
      fine += Math.sin((x * 140 * o + noiseSeed * o) * Math.PI) / o;
    }
    a *= 0.82 + 0.18 * (fine * 0.5 + 0.5);
    a = clamp01(a) * (def.rings.opacity ?? 0.92);

    const shade = 0.78 + 0.22 * (Math.sin(x * 90 + noiseSeed) * 0.5 + 0.5);
    img.data[i * 4] = r0 * shade;
    img.data[i * 4 + 1] = g0 * shade;
    img.data[i * 4 + 2] = b0 * shade;
    img.data[i * 4 + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * 日冕：径向底色 + 大量放射状流苏。
 * 真实日冕不是干净的圆形辉光，而是一圈长短不一的等离子体流，
 * 加上这层结构之后太阳一下子就"活"了。
 */
let coronaTexture = null;
export function getCoronaTexture() {
  if (coronaTexture) return coronaTexture;
  const N = 512;
  const c = N / 2;
  const canvas = makeCanvas(N, N);
  const ctx = canvas.getContext('2d');
  const rand = rng(seedOf('corona'));

  const base = ctx.createRadialGradient(c, c, N * 0.14, c, c, N * 0.5);
  base.addColorStop(0.00, 'rgba(255,244,214,0.90)');
  base.addColorStop(0.10, 'rgba(255,206,132,0.42)');
  base.addColorStop(0.30, 'rgba(255,158,68,0.15)');
  base.addColorStop(0.62, 'rgba(255,126,44,0.045)');
  base.addColorStop(1.00, 'rgba(255,110,30,0)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, N, N);

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 0; i < 220; i++) {
    const a = rand() * Math.PI * 2;
    const r0 = N * (0.135 + rand() * 0.03);
    const r1 = r0 + N * (0.05 + Math.pow(rand(), 1.7) * 0.32);
    const x0 = c + Math.cos(a) * r0, y0 = c + Math.sin(a) * r0;
    const x1 = c + Math.cos(a) * r1, y1 = c + Math.sin(a) * r1;
    const alpha = 0.05 + rand() * 0.13;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(255,228,170,${alpha})`);
    g.addColorStop(0.45, `rgba(255,180,96,${alpha * 0.5})`);
    g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 1 + rand() * 3.4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  coronaTexture = new CanvasTexture(canvas);
  coronaTexture.colorSpace = SRGBColorSpace;
  return coronaTexture;
}

/**
 * 星芒：核心光斑 + 四长四短的衍射芒。
 * 人眼/相机看强光源时必然带芒，这一层是"刺眼"观感的主要来源，
 * 而且它按恒定屏幕尺寸绘制，所以太阳退成一个点时依然是颗耀眼的星。
 */
let starburstTexture = null;
export function getStarburstTexture() {
  if (starburstTexture) return starburstTexture;
  const N = 512;
  const c = N / 2;
  const canvas = makeCanvas(N, N);
  const ctx = canvas.getContext('2d');

  const core = ctx.createRadialGradient(c, c, 0, c, c, N * 0.16);
  core.addColorStop(0.00, 'rgba(255,255,255,1)');
  core.addColorStop(0.22, 'rgba(255,246,214,0.72)');
  core.addColorStop(0.55, 'rgba(255,206,128,0.20)');
  core.addColorStop(1.00, 'rgba(255,170,80,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, N, N);

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const spike = (angle, len, width, alpha) => {
    const x = c + Math.cos(angle) * len, y = c + Math.sin(angle) * len;
    const g = ctx.createLinearGradient(c, c, x, y);
    g.addColorStop(0, `rgba(255,252,238,${alpha})`);
    g.addColorStop(0.18, `rgba(255,228,170,${alpha * 0.5})`);
    g.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2; // 四根长芒
    spike(a, N * 0.49, 9, 0.30);
    spike(a, N * 0.47, 2.4, 0.85);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4; // 四根短芒
    spike(a, N * 0.26, 5, 0.16);
    spike(a, N * 0.24, 1.6, 0.42);
  }

  starburstTexture = new CanvasTexture(canvas);
  starburstTexture.colorSpace = SRGBColorSpace;
  return starburstTexture;
}

/** 光点/光晕用的径向渐变精灵贴图（全场景共用一张） */
let glowTexture = null;
export function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const N = 128;
  const canvas = makeCanvas(N, N);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.32, 'rgba(255,255,255,0.30)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.07)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  glowTexture = new CanvasTexture(canvas);
  glowTexture.colorSpace = SRGBColorSpace;
  return glowTexture;
}
