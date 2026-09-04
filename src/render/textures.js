import { CanvasTexture, SRGBColorSpace } from 'three';
import { clamp01, smoothstep, rng, seedOf, hexToRgb } from './noise.js';

/**
 * Small runtime-generated data and effect textures.
 *
 * Planetary surfaces are image assets declared in data/bodies.js. The canvases below are only
 * for a one-dimensional fallback ring strip and reusable screen-space light/marker sprites.
 */

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Saturn and Uranus rings: a 1D radial RGBA strip including the Cassini division. */
export function makeRingTexture(def) {
  const N = 1024;
  const canvas = makeCanvas(N, 1);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(N, 1);
  const [red, green, blue] = hexToRgb(def.rings.tint || '#d0c0a0');
  const rand = rng(seedOf(`${def.id}ring`));
  const noiseSeed = rand() * 100;

  for (let i = 0; i < N; i++) {
    const x = i / (N - 1); // 0 = inner edge, 1 = outer edge
    let alpha = 1;
    alpha *= 0.35 + 0.65 * smoothstep(0.0, 0.08, x);
    alpha *= 1 - smoothstep(0.93, 1.0, x);
    if (def.id === 'saturn') {
      const cassini = 1 - 0.88 * Math.exp(-Math.pow((x - 0.70) / 0.028, 2));
      const encke = 1 - 0.5 * Math.exp(-Math.pow((x - 0.90) / 0.006, 2));
      const bRing = 0.55 + 0.45 * smoothstep(0.18, 0.30, x)
        * (1 - smoothstep(0.62, 0.70, x));
      alpha *= cassini * encke * (0.55 + bRing);
    }

    let fine = 0;
    for (let octave = 1; octave <= 4; octave++) {
      fine += Math.sin((x * 140 * octave + noiseSeed * octave) * Math.PI) / octave;
    }
    alpha *= 0.82 + 0.18 * (fine * 0.5 + 0.5);
    alpha = clamp01(alpha) * (def.rings.opacity ?? 0.92);

    const shade = 0.78 + 0.22 * (Math.sin(x * 90 + noiseSeed) * 0.5 + 0.5);
    img.data[i * 4] = red * shade;
    img.data[i * 4 + 1] = green * shade;
    img.data[i * 4 + 2] = blue * shade;
    img.data[i * 4 + 3] = alpha * 255;
  }
  ctx.putImageData(img, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Wide, soft veiling glare approximating scattering inside a lens or the eye. */
let glareTexture = null;
export function getGlareTexture() {
  if (glareTexture) return glareTexture;
  const N = 512;
  const centre = N / 2;
  const canvas = makeCanvas(N, N);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(centre, centre, 0, centre, centre, N * 0.5);
  gradient.addColorStop(0.00, 'rgba(255,252,242,0.95)');
  gradient.addColorStop(0.05, 'rgba(255,245,218,0.56)');
  gradient.addColorStop(0.14, 'rgba(255,228,170,0.27)');
  gradient.addColorStop(0.30, 'rgba(255,205,128,0.115)');
  gradient.addColorStop(0.55, 'rgba(255,186,102,0.042)');
  gradient.addColorStop(0.80, 'rgba(255,172,90,0.013)');
  gradient.addColorStop(1.00, 'rgba(255,164,82,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, N, N);

  glareTexture = new CanvasTexture(canvas);
  glareTexture.colorSpace = SRGBColorSpace;
  return glareTexture;
}

/** Core highlight plus four long and four short diffraction spikes for the solar point sprite. */
let starburstTexture = null;
export function getStarburstTexture() {
  if (starburstTexture) return starburstTexture;
  const N = 512;
  const centre = N / 2;
  const canvas = makeCanvas(N, N);
  const ctx = canvas.getContext('2d');

  const core = ctx.createRadialGradient(centre, centre, 0, centre, centre, N * 0.16);
  core.addColorStop(0.00, 'rgba(255,255,255,1)');
  core.addColorStop(0.22, 'rgba(255,246,214,0.72)');
  core.addColorStop(0.55, 'rgba(255,206,128,0.20)');
  core.addColorStop(1.00, 'rgba(255,170,80,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, N, N);

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const spike = (angle, length, width, alpha) => {
    const x = centre + Math.cos(angle) * length;
    const y = centre + Math.sin(angle) * length;
    const gradient = ctx.createLinearGradient(centre, centre, x, y);
    gradient.addColorStop(0, `rgba(255,252,238,${alpha})`);
    gradient.addColorStop(0.18, `rgba(255,228,170,${alpha * 0.5})`);
    gradient.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(centre, centre);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  for (let k = 0; k < 4; k++) {
    const angle = (k / 4) * Math.PI * 2;
    spike(angle, N * 0.49, 9, 0.30);
    spike(angle, N * 0.47, 2.4, 0.85);
  }
  for (let k = 0; k < 4; k++) {
    const angle = (k / 4) * Math.PI * 2 + Math.PI / 4;
    spike(angle, N * 0.26, 5, 0.16);
    spike(angle, N * 0.24, 1.6, 0.42);
  }

  starburstTexture = new CanvasTexture(canvas);
  starburstTexture.colorSpace = SRGBColorSpace;
  return starburstTexture;
}

/** Hollow diamond and centre dot used by Lagrange-point sprites. */
let markerTexture = null;
export function getMarkerTexture() {
  if (markerTexture) return markerTexture;
  const N = 64;
  const centre = N / 2;
  const canvas = makeCanvas(N, N);
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(centre, 7);
  ctx.lineTo(N - 7, centre);
  ctx.lineTo(centre, N - 7);
  ctx.lineTo(7, centre);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(centre, centre, 3.2, 0, Math.PI * 2);
  ctx.fill();

  markerTexture = new CanvasTexture(canvas);
  return markerTexture;
}

/** Radial gradient shared by fixed-screen-size body dots and the solar halo. */
let glowTexture = null;
export function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const N = 128;
  const canvas = makeCanvas(N, N);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  gradient.addColorStop(0.0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.12, 'rgba(255,255,255,0.92)');
  gradient.addColorStop(0.32, 'rgba(255,255,255,0.30)');
  gradient.addColorStop(0.62, 'rgba(255,255,255,0.07)');
  gradient.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, N, N);
  glowTexture = new CanvasTexture(canvas);
  glowTexture.colorSpace = SRGBColorSpace;
  return glowTexture;
}
