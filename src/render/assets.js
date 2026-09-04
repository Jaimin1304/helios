import { Texture, SRGBColorSpace, LinearSRGBColorSpace, TextureLoader } from 'three';
import { TEXTURE_MAX_WIDTH } from '../config.js';

/**
 * Real texture loading.
 *
 * Many of the source images are 8192x4096 jpgs, and each one costs 8192*4096*4 bytes, about
 * 134 MB of VRAM, once decoded; a dozen of them runs past a gigabyte. Everything is therefore
 * downsampled to TEXTURE_MAX_WIDTH during decode, where createImageBitmap's resizeWidth does
 * the work off-thread and beats an <img> plus canvas by a wide margin.
 * For sharper surfaces raise the constant in config.js and re-run scripts/build-textures.mjs.
 */

/* global __TEX_MAP__ */
/**
 * Build-time map from original filename to derived filename, produced by vite.config.js.
 * A production build has already shrunk the textures to TEXTURE_MAX_WIDTH and converted them
 * to webp, so the names change with them. In development the map is empty and the originals
 * under solar_textures/ are used directly.
 */
const TEX_MAP = __TEX_MAP__;

/** Substituted only at request time; cache keys still use the original url from bodies.js */
export function resolveTextureUrl(url) {
  const i = url.lastIndexOf('/');
  const mapped = TEX_MAP[url.slice(i + 1)];
  return mapped ? url.slice(0, i + 1) + mapped : url;
}

const cache = new Map();

async function decodeScaled(url, maxWidth) {
  const res = await fetch(resolveTextureUrl(url));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();

  // three does not flip ImageBitmaps, so flip during decode and turn texture.flipY off
  let bmp = await createImageBitmap(blob, { imageOrientation: 'flipY' });
  if (bmp.width > maxWidth) {
    const w = maxWidth;
    const h = Math.max(1, Math.round((bmp.height * maxWidth) / bmp.width));
    const scaled = await createImageBitmap(bmp, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'high',
    });
    bmp.close();
    bmp = scaled;
  }
  return bmp;
}

/** @param {'srgb'|'linear'} colorSpace sRGB for colour maps, linear for data textures. */
async function loadTexture(url, colorSpace = 'srgb', maxWidth = TEXTURE_MAX_WIDTH) {
  const key = `${url}|${colorSpace}|${maxWidth}`;
  if (cache.has(key)) return cache.get(key);

  const promise = (async () => {
    let tex;
    try {
      const bmp = await decodeScaled(url, maxWidth);
      tex = new Texture(bmp);
      tex.flipY = false; // already flipped during decode
    } catch (err) {
      // Fall back to a full-size load when createImageBitmap is unavailable or the blob fails
      console.warn(`[helios] ${url} failed to load downsampled, falling back to full size`, err);
      tex = await new TextureLoader().loadAsync(resolveTextureUrl(url));
    }
    tex.colorSpace = colorSpace === 'srgb' ? SRGBColorSpace : LinearSRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  })();

  cache.set(key, promise);
  return promise;
}

/**
 * Preload every observed or generated texture declared in the body table.
 * @returns {Promise<Map<string, Texture>>} keyed by `url|colorSpace`
 */
export async function preloadBodyTextures(bodies, onProgress) {
  /** @type {{url:string, colorSpace:'srgb'|'linear', key:string}[]} */
  const jobs = [];
  const seen = new Set();
  for (const def of bodies) {
    if (!def.tex) continue;
    for (const [slot, url] of Object.entries(def.tex)) {
      // Texture objects may also carry provenance metadata for the UI.
      if (typeof url !== 'string') continue;
      const colorSpace = slot === 'clouds' ? 'linear' : 'srgb';
      const key = `${url}|${colorSpace}`;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push({ url, colorSpace, key });
    }
  }

  const out = new Map();
  const total = jobs.length;
  let done = 0;
  // Concurrent but throttled, so a dozen 8K decodes cannot blow out memory at once
  const LANES = 3;
  await Promise.all(
    Array.from({ length: LANES }, async () => {
      while (jobs.length) {
        const job = jobs.shift();
        try {
          out.set(job.key, await loadTexture(job.url, job.colorSpace));
        } catch (err) {
          console.warn(`[helios] failed to load texture: ${job.url}`, err);
        }
        onProgress?.(++done, total, job.url);
      }
    }),
  );
  return out;
}

/** Fetch a preloaded texture; null means the caller uses its solid-colour failure state. */
export function pickTexture(assets, url, colorSpace = 'srgb') {
  if (!url) return null;
  return assets.get(`${url}|${colorSpace}`) ?? null;
}
