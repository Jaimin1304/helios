/**
 * 纹理派生图构建。
 *
 * 素材目录 solar_textures/ 里多是 8192×4096 的 jpg（合计 ~66 MB），但运行时
 * assets.js 一律在解码阶段降采样到 TEXTURE_MAX_WIDTH(2048) —— 也就是说
 * 下载下来的像素有 94% 是直接扔掉的。这里在构建期就把它们缩到目标宽度并
 * 转成 webp，实测 66 MB → 2.2 MB（30×），而且**画质零损失**：运行时本来
 * 看到的就是 2048 宽的图。
 *
 * 原始 8K 素材保留在 solar_textures/ 不动，以后想调高 TEXTURE_MAX_WIDTH
 * 只要重跑本脚本即可。
 *
 * 用法：
 *   npm run textures            （vite build 也会自动调用）
 *   npm run textures -- --force （忽略缓存，全部重压）
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import sharp from 'sharp';
import { TEXTURE_MAX_WIDTH } from '../src/config.js';

const ROOT = resolve(import.meta.dirname, '..');
const SRC_DIR = join(ROOT, 'solar_textures');
const OUT_DIR = join(ROOT, '.textures');
const MANIFEST = join(OUT_DIR, 'manifest.json');

/** 有损档位。源图本身已是有损 jpg，82 再压一道肉眼看不出差别。 */
const QUALITY = 82;
const EFFORT = 5;

/**
 * 逐文件的宽度上限覆盖。默认取 TEXTURE_MAX_WIDTH —— 运行时 assets.js 反正会
 * 降到那个宽度，所以预缩是无损的。
 *
 * 天球是唯一的例外：sky.js 不走 assets.js，它加载多大就用多大，而且铺满整个
 * 背景。50° 视场横跨的只有全图的 1/7，8192 宽也才勉强够 1:1 采样，缩到 2048
 * 会明显发糊。好在那张图大半是黑的，8192 的 webp 只要 0.30 MB，比原来的
 * 1.82 MB jpg 还小——等于白捡。
 */
const WIDTH_OVERRIDE = {
  '8k_stars_milky_way.jpg': 8192,
};

/** 扫 src/ 与 index.html，只转真正被引用到的纹理 */
async function referencedNames() {
  const names = new Set();
  const collect = (text) => {
    for (const m of text.matchAll(/solar_textures\/([\w.-]+)/g)) names.add(m[1]);
  };
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(js|html|css)$/.test(e.name)) collect(await readFile(p, 'utf8'));
    }
  };
  await walk(join(ROOT, 'src'));
  collect(await readFile(join(ROOT, 'index.html'), 'utf8'));
  return names;
}

const mb = (n) => (n / 1048576).toFixed(2);

/**
 * @returns {Promise<{map: Record<string,string>, outDir: string}>}
 *   map 是「原始文件名 → 派生文件名」，注入到前端供 resolveTextureUrl() 用
 */
export async function buildTextures({ force = false, quiet = false } = {}) {
  if (!existsSync(SRC_DIR)) throw new Error(`找不到素材目录 ${SRC_DIR}`);
  await mkdir(OUT_DIR, { recursive: true });

  const wanted = await referencedNames();
  const prev = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')) : {};
  const next = {};
  const rows = [];
  let totalIn = 0;
  let totalOut = 0;

  for (const name of [...wanted].sort()) {
    const srcPath = join(SRC_DIR, name);
    if (!existsSync(srcPath)) {
      throw new Error(`src 里引用了 solar_textures/${name}，但素材目录里没有这个文件`);
    }
    const st = await stat(srcPath);
    const maxWidth = WIDTH_OVERRIDE[name] ?? TEXTURE_MAX_WIDTH;
    const outName = `${basename(name, extname(name))}.webp`;
    const outPath = join(OUT_DIR, outName);

    // 增量：源文件大小/时间与参数都没变、产物还在，就跳过
    const stamp = {
      out: outName, size: st.size, mtimeMs: st.mtimeMs, width: maxWidth, q: QUALITY,
    };
    const c = prev[name];
    const hit = !force && c && existsSync(outPath)
      && c.size === stamp.size && c.mtimeMs === stamp.mtimeMs
      && c.width === stamp.width && c.q === stamp.q;

    let outSize;
    if (hit) {
      outSize = (await stat(outPath)).size;
    } else {
      const img = sharp(srcPath, { limitInputPixels: false });
      const meta = await img.metadata();
      // 带 alpha 的（土星环条带）走无损：那张图的 alpha 是**数据**不是外观，
      // 有损压缩会在卡西尼缝边缘糊出条带。反正它本来也只有几十 KB。
      const enc = meta.hasAlpha
        ? { lossless: true, effort: EFFORT }
        : { quality: QUALITY, effort: EFFORT };
      await img
        .resize({ width: Math.min(meta.width, maxWidth), withoutEnlargement: true })
        .webp(enc)
        .toFile(outPath);
      outSize = (await stat(outPath)).size;
    }

    next[name] = stamp;
    totalIn += st.size;
    totalOut += outSize;
    rows.push({ name, outName, inSize: st.size, outSize, hit, maxWidth });
  }

  await writeFile(MANIFEST, JSON.stringify(next, null, 2));

  if (!quiet) {
    console.log(`\n纹理派生图 → .textures/   (默认上限 ${TEXTURE_MAX_WIDTH} px, webp q${QUALITY})`);
    console.log('─'.repeat(68));
    for (const r of rows) {
      const note = r.maxWidth === TEXTURE_MAX_WIDTH ? '' : `  @${r.maxWidth}px`;
      console.log(`  ${r.name.padEnd(26)} ${mb(r.inSize).padStart(7)} → ${mb(r.outSize).padStart(6)} MB`
        + `${note}${r.hit ? '  (缓存)' : ''}`);
    }
    console.log('─'.repeat(68));
    console.log(`  ${'合计'.padEnd(25)} ${mb(totalIn).padStart(7)} → ${mb(totalOut).padStart(6)} MB`
      + `   ${(totalIn / totalOut).toFixed(1)}×\n`);
  }

  return { map: Object.fromEntries(rows.map((r) => [r.name, r.outName])), outDir: OUT_DIR };
}

// 直接运行时执行一次
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await buildTextures({ force: process.argv.includes('--force') });
}
