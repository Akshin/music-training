import { defineConfig } from 'vitest/config'

// Run from the repo root: `npm run test:core` (vitest --root src/audio-core).
export default defineConfig({
  // Keep Vite's cache in the repo's node_modules instead of creating one inside audio-core/.
  cacheDir: '../../node_modules/.vite/audio-core',
  test: {
    include: ['core/**/*.test.ts'],
    environment: 'node',
  },
})
