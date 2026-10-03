import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import type { Profile } from '#/lib/api'
import ProfileEditForm from './ProfileEditForm'

export default function ProfileEditDialog({
  me,
  disabled,
}: {
  me: Profile
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Pencil className="size-3.5" aria-hidden />
          Edit profile
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Your name and avatar. Changes show up everywhere right away.
          </DialogDescription>
        </DialogHeader>
        {/* Remounted on each open so the form always starts from the saved values. */}
        {open && (
          <ProfileEditForm
            me={me}
            onSaved={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
