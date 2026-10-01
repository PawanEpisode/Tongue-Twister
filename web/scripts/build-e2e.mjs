#!/usr/bin/env node
// Builds the app for the Playwright suite: same code as production, but pointed at the local mock API and
// with an inert Supabase client (there is never a session, so the suite exercises guests only).
// Set E2E_SKIP_BUILD=1 to reuse an existing .output.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apiPort = process.env.E2E_API_PORT ?? '4010'

if (
  process.env.E2E_SKIP_BUILD &&
  existsSync(join(root, '.output/server/index.mjs'))
)
  process.exit(0)

const result = spawnSync('npx', ['vite', 'build', '--logLevel', 'error'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    VITE_API_URL: `http://127.0.0.1:${apiPort}`,
    // Inert Supabase values (nothing listens there): the sign-in form renders, but a developer's real
    // project in .env.local is never contacted. Process env beats .env.local in Vite.
    VITE_SUPABASE_URL: `http://127.0.0.1:${apiPort}/supabase`,
    VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
    VITE_SITE_URL: 'http://127.0.0.1:4173',
  },
})
process.exit(result.status ?? 1)
