const FALLBACK = ['UTC'] as const

/**
 * The zones to offer: every IANA zone the browser knows, always including the saved one and the
 * browser's own (an older browser, or a zone added since, would otherwise make the select lie).
 */
export function timezoneOptions(
  current: string | undefined,
  browser: string | undefined,
  supported: readonly string[] = listSupportedZones(),
): string[] {
  const all = new Set<string>([...FALLBACK, ...supported])
  if (current) all.add(current)
  if (browser) all.add(browser)
  return [...all].sort((a, b) => a.localeCompare(b))
}

function listSupportedZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}
