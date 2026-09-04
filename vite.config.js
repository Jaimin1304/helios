import { defineConfig } from 'vite';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTextures } from './scripts/build-textures.mjs';

const root = import.meta.dirname;

/**
 * Textures come in two forms. Development serves the 8K originals straight out of
 * solar_textures/, where size is irrelevant because they are read from local disk and edits
 * take effect immediately. A build runs scripts/build-textures.mjs to produce 2K webp
 * derivatives in .textures/ (66 MB down to 2.5 MB) and copies them into dist/solar_textures/.
 *
 * Names change from xxx.jpg to xxx.webp along the way, so the old-to-new map is injected into
 * the front end through define and applied by resolveTextureUrl() in assets.js just before the
 * fetch. Development injects an empty map and everything passes through untouched.
 */
export default defineConfig(async ({ command }) => {
  const tex = command === 'build'
    ? await buildTextures()
    : { map: {}, outDir: null };

  return {
    base: './',
    build: { target: 'es2022', chunkSizeWarningLimit: 2048 },
    define: { __TEX_MAP__: JSON.stringify(tex.map) },
    plugins: command === 'build'
      ? [{
        name: 'helios-emit-textures',
        closeBundle() {
          const dest = resolve(root, 'dist/solar_textures');
          rmSync(dest, { recursive: true, force: true });
          // Only derivatives are copied, so unreferenced source art never reaches dist
          cpSync(tex.outDir, dest, {
            recursive: true,
            filter: (src) => !src.endsWith('manifest.json'),
          });
        },
      }]
      : [],
  };
});
