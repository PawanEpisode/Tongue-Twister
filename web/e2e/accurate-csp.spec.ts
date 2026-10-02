/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { openApp } from './support/setup'

/**
 * The real, built inference worker (onnxruntime-web + WASM) run in a real browser under the *enforced*
 * production CSP, against the tiny stand-in model (tools/export_model/make_tiny_model.py). Proves three things the
 * unit tests cannot: the worker bundle boots and finds its WASM, `'wasm-unsafe-eval'` is enough for the CSP, and the
 * in-browser logits match onnxruntime's (so the TS runner and the Python/worker path agree on the model contract).
 */
const vercel = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
) as {
  headers: { source: string; headers: { key: string; value: string }[] }[]
}
const policy =
  vercel.headers
    .find((h) => h.source === '/(.*)')
    ?.headers.find((h) => h.key === 'Content-Security-Policy-Report-Only')
    ?.value ?? ''

const assets = new URL('../.output/public/assets/', import.meta.url)
const workerAsset = readdirSync(assets).find((n) =>
  /^ort\.worker-.*\.js$/.test(n),
)
const model = readFileSync(
  new URL('./fixtures/tiny-ctc.onnx', import.meta.url),
).toString('base64')
const reference = JSON.parse(
  readFileSync(
    new URL('./fixtures/tiny-ctc.ref.json', import.meta.url),
    'utf8',
  ),
) as number[][]

test('the production policy allows WebAssembly without opening up scripts', () => {
  expect(policy).toContain("'wasm-unsafe-eval'")
  expect(policy).not.toMatch(/'unsafe-eval'/)
  expect(policy).not.toMatch(/script-src[^;]*https?:/) // no third-party script hosts
})

test('the inference worker runs under the enforced CSP and matches onnxruntime', async ({
  page,
}) => {
  expect(workerAsset, 'run `npm run build:e2e` first').toBeTruthy()
  await openApp(page)
  const violations: string[] = []
  page.on('console', (m) => {
    // The app's own calls to the mock API (an origin production's `connect-src` names, the test's does not) are
    // not what this test is about: only script/worker/WebAssembly refusals count.
    if (
      /Content Security Policy|Refused to/i.test(m.text()) &&
      !/connect-src|Fetch API cannot load/i.test(m.text())
    )
      violations.push(m.text())
  })
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback()
    const res = await route.fetch()
    await route.fulfill({
      response: res,
      headers: { ...res.headers(), 'content-security-policy': policy },
    })
  })
  await page.goto('/')

  const out = await page.evaluate(
    async ({ url, modelB64 }) => {
      const bytes = Uint8Array.from(atob(modelB64), (c) =>
        c.charCodeAt(0),
      ).buffer
      const worker = new Worker(url, { type: 'module' })
      const reply = (id: number) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          worker.onmessage = (e: MessageEvent<{ id: number }>) => {
            if (e.data.id === id) resolve(e.data)
          }
          worker.onerror = (e) =>
            reject(new Error(`worker error: ${e.message}`))
        })
      worker.postMessage({ type: 'init', id: 1, bytes, threads: 1 }, [bytes])
      const ready = await reply(1)
      const tone = new Float32Array(16_000)
      for (let i = 0; i < tone.length; i++)
        tone[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / 16_000)
      worker.postMessage({ type: 'run', id: 2, samples: tone }, [tone.buffer])
      const run = await reply(2)
      // 35 s of audio spans two 30 s windows: the stitched frame count must equal a single pass's.
      const long = new Float32Array(16_000 * 35).map(
        (_, i) => 0.2 * Math.sin(i / 20),
      )
      worker.postMessage({ type: 'run', id: 3, samples: long }, [long.buffer])
      const stitched = await reply(3)
      worker.terminate()
      return {
        ready: ready.type,
        type: run.type,
        message: run.message,
        frames: run.frames as number,
        vocab: run.vocab as number,
        logits: Array.from(run.logits as Float32Array),
        longFrames: stitched.frames as number,
      }
    },
    { url: `/assets/${workerAsset}`, modelB64: model },
  )

  expect(violations).toEqual([])
  expect(out.ready).toBe('ready')
  expect(out.type).toBe('result')
  expect(out.frames).toBe(reference.length)
  expect(out.vocab).toBe(reference[0].length)
  const flat = reference.flat()
  const worst = Math.max(...out.logits.map((v, i) => Math.abs(v - flat[i])))
  expect(worst).toBeLessThan(1e-3)
  expect(out.longFrames).toBe(Math.floor((16_000 * 35 - 400) / 320) + 1)
})
