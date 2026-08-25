import { defineConfig } from 'vite';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTextures } from './scripts/build-textures.mjs';

const root = import.meta.dirname;

/**
 * 纹理有两套：
 *   开发时  → 直接用 solar_textures/ 里的 8K 原图（本地读盘，无所谓大小，
 *             而且改素材立刻生效）；
 *   构建时  → scripts/build-textures.mjs 生成 .textures/ 里的 2K webp
 *             （66 MB → 2.2 MB），拷进 dist/solar_textures/。
 *
 * 文件名会从 xxx.jpg 变成 xxx.webp，所以把「原名 → 新名」的映射通过 define
 * 注入前端，由 assets.js 的 resolveTextureUrl() 在 fetch 前换掉。
 * 开发时注入空表，一切原样通过。
 */
export default defineConfig(async ({ command }) => {
  const tex = command === 'build'
    ? await buildTextures()
    : { map: {}, outDir: null };

  return {
    base: './',
    build: { target: 'es2022', chunkSizeWarningLimit: 2048 },
    define: { __TEX_MAP__: JSON.stringify(tex.map) },
    plugins: [
      {
        name: 'helios-emit-textures',
        closeBundle() {
          const dest = resolve(root, 'dist/solar_textures');
          rmSync(dest, { recursive: true, force: true });
          // 只拷派生图；没被引用到的素材（如 8k_venus_surface.jpg）根本不进 dist
          cpSync(tex.outDir, dest, {
            recursive: true,
            filter: (src) => !src.endsWith('manifest.json'),
          });
        },
      },
    ],
  };
});
