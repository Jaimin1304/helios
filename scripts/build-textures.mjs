/**
 * Texture derivative build.
 *
 * Most of the art in solar_textures/ is 8192x4096 jpg, about 66 MB for the files actually
 * referenced, yet assets.js downsamples everything to TEXTURE_MAX_WIDTH (2048) during decode
 * at runtime. Roughly 94% of the downloaded pixels are thrown away. Shrinking them to the
 * target width at build time and converting to webp measures 66 MB down to 2.5 MB, and the
 * quality is unchanged because 2048 wide is what the runtime was showing all along.
 *
 * The original 8K art stays untouched in solar_textures/, so raising TEXTURE_MAX_WIDTH later
 * only needs a re-run of this script.
 *
 * Usage:
 *   npm run textures            (vite build calls this automatically)
 *   npm run textures -- --force (ignore the cache and re-encode everything)
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';
import sharp from 'sharp';
import { TEXTURE_MAX_WIDTH } from '../src/config.js';
import { BODIES } from '../src/data/bodies.js';

const ROOT = resolve(import.meta.dirname, '..');
const SRC_DIR = join(ROOT, 'solar_textures');
const OUT_DIR = join(ROOT, '.textures');
const MANIFEST = join(OUT_DIR, 'manifest.json');

/** Lossy setting. The sources are already lossy jpg, and a second pass at 82 is invisible. */
const QUALITY = 82;
const EFFORT = 5;

/**
 * Per-file overrides for the width cap. The default is TEXTURE_MAX_WIDTH, and pre-shrinking to
 * it is lossless because assets.js would reduce the image to that width anyway.
 *
 * The sky is the one exception. sky.js bypasses assets.js and uses whatever it loads, and the
 * texture covers the entire background. A 50 degree field spans only a seventh of the image,
 * so even 8192 wide is barely 1:1 sampling and 2048 goes visibly soft. The image is mostly
 * black, so 8192 in webp costs 0.30 MB, less than the 1.82 MB jpg it replaces.
 */
const WIDTH_OVERRIDE = {
  '8k_stars_milky_way.jpg': 8192,
};

/**
 * Find every shipped texture. Most URLs are literals and can be found by scanning source, but
 * generatedTexture() deliberately constructs its clearly-labelled filenames from body ids.
 * Reading the declarative body table as well keeps the derivative build independent of how a
 * texture URL happens to be written in source code.
 */
async function referencedNames() {
  const names = new Set();
  const collect = (text) => {
    // Requiring a complete image extension ignores partial template literals such as
    // `2k_${id}_generated.jpg`; their resolved values come from BODIES below.
    for (const m of text.matchAll(/solar_textures\/([\w.-]+\.(?:jpe?g|png|webp))/gi)) {
      names.add(m[1]);
    }
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
  for (const definition of BODIES) {
    for (const url of Object.values(definition.tex ?? {})) {
      if (typeof url === 'string') collect(url);
    }
  }
  return names;
}

const mb = (n) => (n / 1048576).toFixed(2);

/**
 * @returns {Promise<{map: Record<string,string>, outDir: string}>}
 *   map is the original-to-derived filename mapping, injected for resolveTextureUrl()
 */
export async function buildTextures({ force = false, quiet = false } = {}) {
  if (!existsSync(SRC_DIR)) throw new Error(`source directory not found: ${SRC_DIR}`);
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
      throw new Error(`src references solar_textures/${name}, but no such file exists`);
    }
    const st = await stat(srcPath);
    const maxWidth = WIDTH_OVERRIDE[name] ?? TEXTURE_MAX_WIDTH;
    const outName = `${basename(name, extname(name))}.webp`;
    const outPath = join(OUT_DIR, outName);

    // Incremental: skip when source size, mtime and parameters are unchanged and output survives
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
      // Anything with alpha (the Saturn ring strip) is encoded losslessly. Its alpha channel is
      // DATA rather than appearance, and lossy compression bands the edge of the Cassini
      // division. It only costs a few tens of KB either way.
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
    console.log(`\nTexture derivatives -> .textures/   (default cap ${TEXTURE_MAX_WIDTH} px, webp q${QUALITY})`);
    console.log('─'.repeat(68));
    for (const r of rows) {
      const note = r.maxWidth === TEXTURE_MAX_WIDTH ? '' : `  @${r.maxWidth}px`;
      console.log(`  ${r.name.padEnd(26)} ${mb(r.inSize).padStart(7)} → ${mb(r.outSize).padStart(6)} MB`
        + `${note}${r.hit ? '  (cached)' : ''}`);
    }
    console.log('─'.repeat(68));
    console.log(`  ${'total'.padEnd(25)} ${mb(totalIn).padStart(7)} -> ${mb(totalOut).padStart(6)} MB`
      + `   ${(totalIn / totalOut).toFixed(1)}×\n`);
  }

  return { map: Object.fromEntries(rows.map((r) => [r.name, r.outName])), outDir: OUT_DIR };
}

// Run once when invoked directly
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await buildTextures({ force: process.argv.includes('--force') });
}
