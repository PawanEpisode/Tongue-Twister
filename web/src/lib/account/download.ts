/** Saving a server-named file in the browser. */

/**
 * The file name from a `Content-Disposition` header (`filename*=UTF-8''…` wins over `filename="…"`).
 * Anything that isn't a plain file name (a path, empty) falls back, so a header can never choose a folder.
 */
export function filenameFromContentDisposition(
  header: string | null | undefined,
  fallback: string,
): string {
  const raw = parseFilename(header ?? '')
  const name = raw?.trim()
  if (!name || /[\\/]/.test(name) || name === '.' || name === '..')
    return fallback
  return name
}

function parseFilename(header: string): string | null {
  const star = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      /* malformed escape: try the plain form */
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header)
  return plain ? (plain[1] ?? plain[2]) : null
}

/** Hands a Blob to the browser's download flow. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the click has been handled; revoking synchronously cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
