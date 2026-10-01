import { useMutation } from '@tanstack/react-query'
import { api } from '#/lib/api'
import { filenameFromContentDisposition, saveBlob } from './download'

/** Today as `YYYYMMDD`, for the fallback name if the server sends none. */
const stamp = (now: Date) => now.toISOString().slice(0, 10).replaceAll('-', '')

/** Fetches `GET /me/export/` with the auth header and saves it under the server's file name. */
export function useDataExport() {
  return useMutation({
    mutationFn: async () => {
      const { blob, contentDisposition } = await api.exportData()
      const name = filenameFromContentDisposition(
        contentDisposition,
        `twister-export-${stamp(new Date())}.json`,
      )
      saveBlob(blob, name)
      return name
    },
  })
}
