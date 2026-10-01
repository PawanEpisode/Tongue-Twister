import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialJs, staticImports } from './check-bundle-size.mjs'

test('staticImports finds static imports and re-exports, not dynamic imports', () => {
  const src = [
    'import{a as b}from"./react-AAA.js";',
    'import "./side-BBB.js";',
    'export{x}from"./util-CCC.js";',
    'const m=()=>import("./lazy-DDD.js");',
    'import{y}from"https://cdn.example/x.js";',
  ].join('\n')
  assert.deepEqual(staticImports(src).sort(), [
    'react-AAA.js',
    'side-BBB.js',
    'util-CCC.js',
  ])
})

test('initialJs unions root + route preloads and follows static imports', () => {
  const routes = {
    __root__: {
      preloads: ['/assets/entry.js'],
      scripts: [{ attrs: { src: '/assets/entry.js' } }],
    },
    '/a': { preloads: ['/assets/a.js'] },
  }
  const files = {
    'assets/entry.js': 'import{r}from"./react.js";',
    'assets/react.js': '',
    'assets/a.js': 'import{u}from"./util.js";const l=()=>import("./lazy.js");',
    'assets/util.js': '',
    'assets/lazy.js': '',
  }
  const got = initialJs(routes, '/a', (f) => files[f])
  assert.deepEqual(got, [
    'assets/a.js',
    'assets/entry.js',
    'assets/react.js',
    'assets/util.js',
  ])
})

test('initialJs rejects a route that is not in the manifest', () => {
  assert.throws(
    () => initialJs({ __root__: {} }, '/missing', () => ''),
    /not in the manifest/,
  )
})
