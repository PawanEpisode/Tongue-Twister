import { Download } from 'lucide-react'
import { useState } from 'react'
import { friendlyError } from '#/components/feedback'
import { Button } from '#/components/ui/button'
import { api } from '#/lib/api'
import type { StorageInfo } from '#/lib/api'
import { daysLeft, daysLeftLabel } from '#/lib/record/expiry'

/** Recordings the server will delete within days. Retention is fixed (D1), so the only rescue is a download. */
export default function ExpiringBanner({
  items,
}: {
  items: StorageInfo['expiring_soon']
}) {
  const [error, setError] = useState<unknown>(null)
  if (items.length === 0) return null

  const download = async (id: string) => {
    setError(null)
    try {
      const url = (await api.recording(id)).playback?.url
      if (!url) throw new Error('not ready')
      const a = document.createElement('a')
      a.href = url
      a.download = ''
      a.rel = 'noopener'
      document.body.append(a)
      a.click()
      a.remove()
    } catch (e) {
      setError(e)
    }
  }

  return (
    <section
      aria-label="Expiring soon"
      className="glass space-y-2 rounded-2xl border border-amber-500/40 p-4 text-sm"
    >
      <h2 className="font-semibold">Expiring soon</h2>
      <ul className="space-y-2">
        {items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="font-medium">“{r.title}”</span> is deleted{' '}
              {daysLeftLabel(daysLeft(r.expires_at, Date.now()))}.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void download(r.id)}
            >
              <Download className="mr-1 size-4" aria-hidden />
              Download
            </Button>
          </li>
        ))}
      </ul>
      {error != null && (
        <p role="alert" className="text-pink">
          {friendlyError(error)}
        </p>
      )}
    </section>
  )
}
