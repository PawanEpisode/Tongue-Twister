import { useMutation } from '@tanstack/react-query'
import { api } from '#/lib/api'
import { filenameFromContentDisposition, saveBlob } from './download'

/** Today as `YYYYMMDD`, for the fallback name if the server sends none. */
const stamp = (now: Date) => now.toISOString().slice(0, 10).replaceAll('-', '')

const EXPORTS = {
  json: { fetch: () => api.exportData(), fallback: 'twister-export-DATE.json' },
  csv: {
    fetch: () => api.exportAttemptsCsv(),
    fallback: 'twister-attempts-DATE.csv',
  },
} as const

/** Fetches an export with the auth header and saves it under the server's file name. */
export function useDataExport(kind: keyof typeof EXPORTS = 'json') {
  return useMutation({
    mutationFn: async () => {
      const { blob, contentDisposition } = await EXPORTS[kind].fetch()
      const name = filenameFromContentDisposition(
        contentDisposition,
        EXPORTS[kind].fallback.replace('DATE', stamp(new Date())),
      )
      saveBlob(blob, name)
      return name
    },
  })
}
