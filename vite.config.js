import { defineConfig } from 'vite';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = import.meta.dirname;

// solar_textures/ 保持在工程根目录（原始素材目录，不搬进 public/）。
// 开发时 vite 直接从根目录静态托管；构建时手动拷进 dist/。
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2048 },
  plugins: [
    {
      name: 'helios-copy-textures',
      closeBundle() {
        const src = resolve(root, 'solar_textures');
        if (existsSync(src)) {
          cpSync(src, resolve(root, 'dist/solar_textures'), { recursive: true });
        }
      },
    },
  ],
});
