const KEY = 'twister.returnTo'
const FALLBACK = '/twisters'

/** Same-origin paths only ("/x", never "//host" or "https://…"), so a crafted link can't redirect off-site. */
export const safePath = (p: unknown): string | undefined =>
  typeof p === 'string' && /^\/(?!\/)/.test(p) ? p : undefined

/** Where to land after sign-in. Survives the OAuth round-trip (a full page redirect) via sessionStorage. */
export const returnTo = {
  remember(path: string | undefined) {
    const safe = safePath(path)
    if (!safe) return
    try {
      window.sessionStorage.setItem(KEY, safe)
    } catch {
      /* storage blocked: we simply land on the default page */
    }
  },
  take(): string {
    try {
      const stored = window.sessionStorage.getItem(KEY)
      window.sessionStorage.removeItem(KEY)
      return safePath(stored) ?? FALLBACK
    } catch {
      return FALLBACK
    }
  },
}
