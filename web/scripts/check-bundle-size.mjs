#!/usr/bin/env node
// Bundle-size budget (docs/features/00 §6.3): the JS a first visit to a route must download, gzipped.
//
// Run after `vite build`. Reads the TanStack Start manifest that Nitro emits next to the server entry
// (`.output/server/_tanstack-start-manifest_v-*.mjs`): the `__root__` entry and the matched route's entry list
// the chunks the HTML preloads. We add every chunk those statically import (the browser needs them before
// the page can run) and sum the gzip size. Dynamic imports (e.g. the Record-mode chunk) are not "first load".
//
//   node scripts/check-bundle-size.mjs            check against bundle-budget.json
//   node scripts/check-bundle-size.mjs --json     machine-readable output
// Exit codes: 0 within budget, 1 over budget, 2 the build output could not be read.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, '.output')
const publicDir = join(outDir, 'public')
const KB = 1024

/** Static `import … from "./x.js"` / `import "./x.js"` / `export … from "./x.js"`; dynamic `import(` is excluded. */
const STATIC_IMPORT =
  /(?:^|[;}\s])(?:import|export)\s*(?:[^'"();]*?from\s*|\s*)["']\.\/([^"']+\.js)["']/g

export function staticImports(source) {
  return [...source.matchAll(STATIC_IMPORT)].map((m) => m[1])
}

export function loadManifest(serverDir = join(outDir, 'server')) {
  const file = readdirSync(serverDir).find((f) =>
    /^_tanstack-start-manifest.*\.mjs$/.test(f),
  )
  if (!file) throw new Error(`no _tanstack-start-manifest*.mjs in ${serverDir}`)
  const src = readFileSync(join(serverDir, file), 'utf8')
  // The file is `var tsrStartManifest = () => ({ routes: … })` plus an export; evaluate the function only.
  const body = src.replace(/^export\s*\{[^}]*\}\s*;?\s*$/m, '')
  return new Function(`${body}\nreturn tsrStartManifest()`)().routes
}

/** Every JS file (public-relative, no leading slash) needed on first load of `route`. */
export function initialJs(routes, route, readChunk) {
  const entry = routes[route]
  if (!entry) throw new Error(`route "${route}" is not in the manifest`)
  const root = routes.__root__
  const seeds = [
    ...(root.preloads ?? []),
    ...(root.scripts ?? []).map((s) => s.attrs?.src).filter(Boolean),
    ...(entry.preloads ?? []),
    ...(entry.scripts ?? []).map((s) => s.attrs?.src).filter(Boolean),
  ]
    .filter((p) => p.endsWith('.js'))
    .map((p) => p.replace(/^\//, ''))
  const seen = new Set()
  const queue = [...seeds]
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const dir = dirname(file)
    let src
    try {
      src = readChunk(file)
    } catch {
      continue
    }
    for (const dep of staticImports(src)) queue.push(join(dir, dep))
  }
  return [...seen].sort()
}

const gzipBytes = (buf) => gzipSync(buf, { level: 9 }).length
const fmt = (bytes) => `${(bytes / KB).toFixed(1)} KB`

function main() {
  const json = process.argv.includes('--json')
  let budgets, routes
  try {
    budgets = JSON.parse(readFileSync(join(root, 'bundle-budget.json'), 'utf8'))
    routes = loadManifest()
  } catch (err) {
    console.error(
      `check-bundle-size: ${err.message}\nRun \`npm run build\` first.`,
    )
    process.exit(2)
  }
  const readChunk = (file) => readFileSync(join(publicDir, file))
  const rows = []
  for (const [route, b] of Object.entries(budgets.routes)) {
    const files = initialJs(routes, route, (f) => readChunk(f).toString('utf8'))
    const sized = files
      .map((f) => ({ file: f, gzip: gzipBytes(readChunk(f)) }))
      .sort((a, c) => c.gzip - a.gzip)
    const total = sized.reduce((n, f) => n + f.gzip, 0)
    rows.push({
      route,
      label: b.label ?? route,
      budget: b.maxGzipKB * KB,
      target: (budgets.targetGzipKB ?? b.maxGzipKB) * KB,
      total,
      chunks: sized,
    })
  }
  if (json) console.log(JSON.stringify(rows, null, 2))
  else {
    const w = Math.max(...rows.map((r) => r.label.length), 5)
    console.log(
      `${'Route'.padEnd(w)}  ${'First-load JS (gzip)'.padStart(20)}  ${'Ratchet'.padStart(9)}  ${'Target'.padStart(9)}  Status`,
    )
    for (const r of rows)
      console.log(
        `${r.label.padEnd(w)}  ${fmt(r.total).padStart(20)}  ${fmt(r.budget).padStart(9)}  ${fmt(r.target).padStart(9)}  ${r.total <= r.budget ? (r.total <= r.target ? 'ok' : `ok (${fmt(r.total - r.target)} above target)`) : `OVER by ${fmt(r.total - r.budget)}`}`,
      )
    for (const r of rows.filter((x) => x.total > x.budget)) {
      console.log(`\nLargest chunks on ${r.label}:`)
      for (const c of r.chunks.slice(0, 8))
        console.log(`  ${fmt(c.gzip).padStart(10)}  ${c.file}`)
    }
  }
  if (rows.some((r) => r.total > r.budget)) {
    if (!json)
      console.error(
        '\nBundle budget exceeded. Trim the largest chunks above (lazy-load, drop a dependency) rather than raising bundle-budget.json.',
      )
    process.exit(1)
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
