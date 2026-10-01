/// <reference types="node" />
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { route } from './router'

export const API_PORT = Number(process.env.E2E_API_PORT ?? 4010)
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`

/**
 * Local stand-in for the Django API, used only for server-side rendering. The app is built with
 * `VITE_API_URL` pointing here (see scripts/build-e2e.mjs); browser calls are intercepted per test.
 */
export function startApiServer(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', API_ORIGIN)
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const reply = route(req.method ?? 'GET', path, url.searchParams)
    res.writeHead(reply.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify(reply.body))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(API_PORT, '127.0.0.1', () => resolve(server))
  })
}
