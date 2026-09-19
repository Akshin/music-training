import { copyFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
// import vueDevTools from 'vite-plugin-vue-devtools'

// Path the build is served under. The site root by default; GitHub Pages serves the project at
// https://akshin.github.io/music-training/, so its workflow sets BASE_PATH=/music-training/.
const buildBase = process.env.BASE_PATH || '/'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? buildBase : '/',
  plugins: [
    vue(),
    // vueDevTools(),
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
