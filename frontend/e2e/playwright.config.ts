// End-to-end suite: the real SPA in a real browser against the Go backend in mock mode (fixture estate of
// backend/internal/mock/fixture.go, ROOT_GROUP=org/delivery, dates relative to today UTC).
//
//   cd frontend && npm run e2e
//
// Screenshots go to $E2E_SHOT_DIR (default: test-results/screenshots).
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const here = fileURLToPath(new URL('.', import.meta.url))
const backendDir = fileURLToPath(new URL('../../backend', import.meta.url))
const frontendDir = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  testDir: here,
  testMatch: /.*\.spec\.ts$/,
  outputDir: fileURLToPath(new URL('../test-results/e2e', import.meta.url)),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: fileURLToPath(new URL('../playwright-report', import.meta.url)) }]],
  use: {
    baseURL: 'http://localhost:5173',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: [
    {
      command: 'go run ./cmd/heimdall',
      cwd: backendDir,
      env: { GITLAB_MOCK: '1', ROOT_GROUP: 'org/delivery', PORT: '8080', GOFLAGS: '-buildvcs=false' },
      url: 'http://localhost:8080/api/health',
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      cwd: frontendDir,
      url: 'http://localhost:5173/',
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
