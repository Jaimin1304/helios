import { Texture, SRGBColorSpace, LinearSRGBColorSpace, TextureLoader } from 'three';
import { TEXTURE_MAX_WIDTH } from '../config.js';

/**
 * 真实纹理加载。
 *
 * 素材里不少是 8192×4096 的 jpg，解码后每张要 8192*4096*4 ≈ 134 MB 显存，
 * 十来张就上 GB 了。所以统一在**解码阶段**降采样到 TEXTURE_MAX_WIDTH
 * （createImageBitmap 的 resizeWidth 是离线程做的，比 <img>+canvas 快很多）。
 * 想要更高清就调大 config.js 里那个常量，然后重跑 scripts/build-textures.mjs。
 */

/* global __TEX_MAP__ */
/**
 * 构建期生成的「原始文件名 → 派生文件名」映射（见 vite.config.js）。
 * 生产构建里纹理已经被缩到 TEXTURE_MAX_WIDTH 并转成 webp，文件名跟着变；
 * 开发时这张表是空的，直接用 solar_textures/ 下的原图。
 */
const TEX_MAP = __TEX_MAP__;

/** 只在真正发请求前替换，缓存键仍用 bodies.js 里写的原始 url */
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

  // three 对 ImageBitmap 不做 flipY，这里在解码时就翻好，并把 texture.flipY 关掉
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

/** @param {'srgb'|'linear'} colorSpace 颜色贴图用 srgb；当数据用（云层 alpha）用 linear */
export async function loadTexture(url, colorSpace = 'srgb', maxWidth = TEXTURE_MAX_WIDTH) {
  const key = `${url}|${colorSpace}|${maxWidth}`;
  if (cache.has(key)) return cache.get(key);

  const promise = (async () => {
    let tex;
    try {
      const bmp = await decodeScaled(url, maxWidth);
      tex = new Texture(bmp);
      tex.flipY = false; // 已在解码时翻好
    } catch (err) {
      // createImageBitmap 不可用 / 取不到 blob 时退回原始尺寸加载
      console.warn(`[helios] ${url} 降采样加载失败，退回原始尺寸`, err);
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
 * 预加载天体表里声明的全部真实纹理。
 * @returns {Promise<Map<string, Texture>>} key 为 `url|colorSpace`
 */
export async function preloadBodyTextures(bodies, onProgress) {
  /** @type {{url:string, colorSpace:string}[]} */
  const jobs = [];
  const seen = new Set();
  for (const def of bodies) {
    if (!def.tex) continue;
    for (const [slot, url] of Object.entries(def.tex)) {
      const colorSpace = slot === 'clouds' ? 'linear' : 'srgb';
      const key = `${url}|${colorSpace}`;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push({ url, colorSpace, key });
    }
  }

  const out = new Map();
  let done = 0;
  // 并发但限流，免得同时解十几张 8K 图把内存顶穿
  const LANES = 3;
  await Promise.all(
    Array.from({ length: LANES }, async () => {
      while (jobs.length) {
        const job = jobs.shift();
        try {
          out.set(job.key, await loadTexture(job.url, job.colorSpace));
        } catch (err) {
          console.warn(`[helios] 纹理加载失败：${job.url}`, err);
        }
        onProgress?.(++done, done + jobs.length, job.url);
      }
    }),
  );
  return out;
}

/** 从预加载结果里取图；取不到返回 null，调用方回退到程序化材质 */
export function pickTexture(assets, url, colorSpace = 'srgb') {
  if (!url) return null;
  return assets.get(`${url}|${colorSpace}`) ?? null;
}
