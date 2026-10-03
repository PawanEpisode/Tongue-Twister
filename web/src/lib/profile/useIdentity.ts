import { useAuth } from '#/lib/auth'
import { useMe } from '#/lib/useMe'
import { resolveAvatar } from './avatar'
import type { AvatarView } from './avatar'

export type Identity = {
  name: string
  email?: string
  avatar: AvatarView
  /** The sign-in provider's photo, when there is one (so the picker can offer it). */
  photoUrl?: string
}

/** Who the signed-in person is, for the header and profile: the saved profile wins over sign-in metadata. */
export function useIdentity(): Identity | null {
  const { session } = useAuth()
  const me = useMe().data
  if (!session) return null
  const meta = (session.user.user_metadata ?? {}) as {
    full_name?: string
    name?: string
    avatar_url?: string
  }
  const email = session.user.email
  const name =
    me?.display_name ||
    meta.full_name ||
    meta.name ||
    email?.split('@')[0] ||
    'You'
  return {
    name,
    email,
    photoUrl: meta.avatar_url,
    avatar: resolveAvatar({
      source: me?.avatar_source,
      photoUrl: meta.avatar_url,
      emoji: me?.avatar_emoji,
      name,
    }),
  }
}
