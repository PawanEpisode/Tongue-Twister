/** localStorage that never throws: blocked storage, private mode and corrupt JSON all degrade to "empty". */
export function readJson<T>(key: string, fallback: () => T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw) return { ...fallback(), ...(JSON.parse(raw) as Partial<T>) }
  } catch {
    /* corrupt or blocked: start clean */
  }
  return fallback()
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode or quota: the data just won't survive this visit */
  }
}
