/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 4173)
const API_PORT = Number(process.env.E2E_API_PORT ?? 4010)
const CI = !!process.env.CI

/**
 * End-to-end + accessibility suite (docs/features/15 §4.3). No backend and no Supabase: the app is built
 * against a local mock API (`e2e/support/apiServer.ts`, started by globalSetup for server-side rendering),
 * and every browser call is intercepted per test with `page.route` (`e2e/support/mockApi.ts`).
 *
 * Chromium runs with fake camera/microphone devices so Record mode works without hardware.
 * E2E_CHROMIUM_PATH points at a specific browser binary (for machines where `playwright install` can't run);
 * E2E_CHROMIUM_ARGS adds extra launch flags (space separated).
 */
const executablePath = process.env.E2E_CHROMIUM_PATH || undefined
const extraArgs = (process.env.E2E_CHROMIUM_ARGS ?? '')
  .split(' ')
  .filter(Boolean)

const chromium = {
  ...devices['Desktop Chrome'],
  permissions: ['microphone', 'camera'],
  launchOptions: {
    executablePath,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ...extraArgs,
    ],
  },
}

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  globalSetup: './e2e/support/globalSetup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'e2e', testIgnore: /(a11y|csp)\.spec\.ts/, use: chromium },
    { name: 'a11y', testMatch: /a11y\.spec\.ts/, use: chromium },
    { name: 'csp', testMatch: /csp\.spec\.ts/, use: chromium },
  ],
  webServer: {
    // Build (unless E2E_SKIP_BUILD=1), then serve the Nitro output exactly as production runs it.
    command: 'node scripts/build-e2e.mjs && node .output/server/index.mjs',
    url: `http://127.0.0.1:${PORT}/`,
    timeout: 240_000,
    reuseExistingServer: !CI,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NITRO_PORT: String(PORT),
      NITRO_HOST: '127.0.0.1',
      E2E_API_PORT: String(API_PORT),
    },
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
