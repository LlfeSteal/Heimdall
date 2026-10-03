/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Chart.js and its plugins in their own chunk (keeps both chunks under the 500 kB warning).
        codeSplitting: {
          groups: [{ name: 'charts', test: /node_modules[\\/](chart\.js|chartjs-plugin-annotation|react-chartjs-2|@kurkle)/ }],
        },
      },
    },
  },
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    // Playwright specs (npm run e2e) are not vitest tests.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
