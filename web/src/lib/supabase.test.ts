// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClient = vi.fn()
const getSession = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...a: unknown[]) => {
    createClient(...a)
    return { auth: { getSession, signOut: vi.fn() } }
  },
}))

async function load(configured = true) {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', configured ? 'https://abc.supabase.co' : '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', configured ? 'anon' : '')
  return import('./supabase')
}

beforeEach(() => {
  createClient.mockClear()
  getSession.mockReset()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})
afterEach(() => vi.unstubAllEnvs())

describe('mayHaveSession', () => {
  it('is false for a guest', async () => {
    expect((await load()).mayHaveSession()).toBe(false)
  })

  it('is true when supabase-js has stored a session or a PKCE verifier', async () => {
    const { mayHaveSession } = await load()
    window.localStorage.setItem('sb-abc-auth-token', '{}')
    expect(mayHaveSession()).toBe(true)
    window.localStorage.clear()
    window.localStorage.setItem('sb-abc-auth-token-code-verifier', 'v')
    expect(mayHaveSession()).toBe(true)
  })

  it('ignores unrelated storage', async () => {
    const { mayHaveSession } = await load()
    window.localStorage.setItem('twister.flags.v1', '{}')
    expect(mayHaveSession()).toBe(false)
  })

  it('is true when a sign-in redirect has just landed', async () => {
    const { mayHaveSession } = await load()
    window.history.replaceState(null, '', '/auth/callback?code=abc')
    expect(mayHaveSession()).toBe(true)
  })
})

describe('getAccessToken', () => {
  it('never loads supabase-js for a guest', async () => {
    const { getAccessToken } = await load()
    await expect(getAccessToken()).resolves.toBeNull()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('restores the session token when one is stored', async () => {
    window.localStorage.setItem('sb-abc-auth-token', '{}')
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    const { getAccessToken } = await load()
    await expect(getAccessToken()).resolves.toBe('tok')
    expect(createClient).toHaveBeenCalledTimes(1)
  })

  it('is null, not an error, when the library cannot be loaded', async () => {
    window.localStorage.setItem('sb-abc-auth-token', '{}')
    const { getAccessToken } = await load(false)
    await expect(getAccessToken()).resolves.toBeNull()
  })
})

describe('getSupabase', () => {
  it('is null without configuration', async () => {
    await expect((await load(false)).getSupabase()).resolves.toBeNull()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('creates one PKCE client and tells waiting listeners', async () => {
    const { getSupabase, onSupabaseReady } = await load()
    const ready = vi.fn()
    onSupabaseReady(ready)
    const [a, b] = await Promise.all([getSupabase(), getSupabase()])
    expect(a).toBe(b)
    expect(createClient).toHaveBeenCalledExactlyOnceWith(
      'https://abc.supabase.co',
      'anon',
      { auth: { flowType: 'pkce', detectSessionInUrl: true } },
    )
    expect(ready).toHaveBeenCalledExactlyOnceWith(a)
    // A listener added later hears about the existing client at once.
    const late = vi.fn()
    onSupabaseReady(late)
    expect(late).toHaveBeenCalledWith(a)
  })
})
