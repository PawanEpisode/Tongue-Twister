import { Check, Copy, Link2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { SelectField } from '#/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import type { ShareCreated, ShareExpiry } from '#/lib/api'
import { friendlyError } from '#/components/feedback'
import { useShareMutations, useShares } from '#/lib/record/useRecordings'
import { track } from '#/lib/record/telemetry'
import { useMe } from '#/lib/useMe'
import PublicNameField from './PublicNameField'

const EXPIRY: { value: ShareExpiry; label: string; days: number }[] = [
  { value: '24h', label: '24 hours', days: 1 },
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
]

/**
 * Create, copy and revoke share links for one saved recording. The full link is only known when it is created,
 * so it is shown once with a copy button; the list afterwards has expiry, views and Revoke.
 */
export default function ShareDialog({
  recordingId,
  open,
  maxDays,
  onClose,
}: {
  recordingId: string
  open: boolean
  maxDays: number
  onClose: () => void
}) {
  const options = EXPIRY.filter((o) => o.days <= maxDays)
  const [expires, setExpires] = useState<ShareExpiry>(
    options.at(-1)?.value ?? '24h',
  )
  const [created, setCreated] = useState<ShareCreated | null>(null)
  const [copied, setCopied] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const shares = useShares(open ? recordingId : null)
  const { create, revoke } = useShareMutations(recordingId)
  const anonymous = !(useMe().data?.public_name ?? '').trim()

  useEffect(() => {
    if (!open) {
      setCreated(null)
      setCopied(false)
    }
  }, [open])
  useEffect(() => {
    if (created) input.current?.select()
  }, [created])

  const copy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.url)
      setCopied(true)
    } catch {
      input.current?.select() // the browser blocked the clipboard: the link is selected for a manual copy
    }
  }

  const active = (shares.data ?? []).filter((s) => !s.revoked_at)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this recording</DialogTitle>
          <DialogDescription>
            Anyone with the link can watch it until it expires or you revoke it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-left text-sm">
          {anonymous && (
            <p
              role="note"
              className="rounded-xl bg-card px-3 py-2 text-muted-foreground"
            >
              You haven’t set a name, so viewers will see this as shared by
              “Anonymous”. Add one below if you’d like credit.
            </p>
          )}
          <PublicNameField />
          {created ? (
            <div className="space-y-2">
              <Label htmlFor="share-url" className="block font-semibold">
                Your link
              </Label>
              <div className="flex gap-2">
                <Input
                  id="share-url"
                  ref={input}
                  readOnly
                  value={created.url}
                  className="min-w-0 flex-1"
                />
                <Button onClick={() => void copy()}>
                  {copied ? (
                    <Check className="mr-1 size-4" aria-hidden />
                  ) : (
                    <Copy className="mr-1 size-4" aria-hidden />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p role="status" className="text-xs text-muted-foreground">
                Copy it now — for your security we can’t show this link again.
                You can always make another.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <SelectField
                label="Link expires after"
                labelClassName="font-semibold"
                value={expires}
                onValueChange={(value) => setExpires(value as ShareExpiry)}
                triggerClassName="w-auto"
                options={options.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
              />
              <Button
                disabled={create.isPending}
                onClick={() =>
                  create.mutate(expires, {
                    onSuccess: (r) => {
                      setCreated(r)
                      track('record_share_create', { expires_in: expires })
                    },
                  })
                }
              >
                <Link2 className="mr-1 size-4" aria-hidden />
                {create.isPending ? 'Creating…' : 'Create link'}
              </Button>
            </div>
          )}
          {create.isError && (
            <p role="alert" className="text-pink">
              {friendlyError(create.error)}
            </p>
          )}
          {created && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreated(null)}
            >
              Make another link
            </Button>
          )}

          <section aria-label="Active links">
            <h3 className="mb-1 font-semibold">Active links</h3>
            {active.length === 0 ? (
              <p className="text-muted-foreground">None yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {active.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 py-2"
                  >
                    <span className="text-muted-foreground">
                      Expires {new Date(s.expires_at).toLocaleDateString()} ·{' '}
                      {s.view_count} {s.view_count === 1 ? 'view' : 'views'}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(s.id)}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {revoke.isError && (
              <p role="alert" className="mt-1 text-pink">
                {friendlyError(revoke.error)}
              </p>
            )}
          </section>
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
