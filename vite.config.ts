import { copyFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

const repoBase = '/music-training/'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // Project Pages URL: https://akshin.github.io/music-training/
  base: command === 'build' ? repoBase : '/',
  plugins: [
    vue(),
    vueDevTools(),
    {
      name: 'spa-github-pages-404',
      closeBundle() {
        // GitHub Pages serves 404.html for unknown paths — reuse the SPA shell.
        copyFileSync('dist/index.html', 'dist/404.html')
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@audio-core': fileURLToPath(new URL('./src/audio-core', import.meta.url)),
    },
  },
  worker: {
    // The analysis worker is an ES module (`new Worker(url, { type: 'module' })`).
    format: 'es',
  },
}))
