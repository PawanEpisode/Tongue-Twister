/**
 * `tw_m=1` says "this browser has had a session". It is only a rendering hint (never trusted for access):
 * the server uses it to paint an app-shell skeleton for returning members instead of the landing page, so
 * nobody sees a flash of marketing on their way into the app. The API still decides what anyone may see.
 */
export const HINT_COOKIE = 'tw_m'
const ONE_YEAR = 60 * 60 * 24 * 365

export const hasMemberHint = (cookieHeader: string | null | undefined) =>
  !!cookieHeader &&
  new RegExp(`(?:^|;\\s*)${HINT_COOKIE}=1(?:;|$)`).test(cookieHeader)

/**
 * The cookie header: from the request on the server, `document.cookie` in the browser. The server branch
 * is guarded by `import.meta.env.SSR` so the browser bundle never contains it.
 */
export async function readCookieHeader(): Promise<string> {
  if (import.meta.env.SSR) {
    const { getRequestHeader } = await import('@tanstack/react-start/server')
    return getRequestHeader('cookie') ?? ''
  }
  return document.cookie
}

export function writeMemberHint(on: boolean) {
  try {
    document.cookie = on
      ? `${HINT_COOKIE}=1; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`
      : `${HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
  } catch {
    /* cookies blocked: the page just renders the guest view first */
  }
}
