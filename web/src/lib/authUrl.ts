/** Supabase reports a failed emailed link or OAuth round-trip as `?error_description=…` (or in the hash). */
export function authUrlError(): string | null {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search)
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return q.get('error_description') ?? h.get('error_description')
}
