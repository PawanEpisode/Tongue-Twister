import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Standalone test config: the app's vite.config.ts loads TanStack Start, nitro and devtools, which
// alter module resolution (e.g. React's server conditions) and keep the process alive.
// Tests only need the `#/` alias (mirrors tsconfig paths) and a single React copy.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^#\//,
        replacement: fileURLToPath(new URL('./src/', import.meta.url)),
      },
    ],
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
