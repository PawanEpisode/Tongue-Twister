import { useAuth } from '#/lib/auth'
import ChangeEmailForm from './ChangeEmailForm'
import ChangePasswordForm from './ChangePasswordForm'
import type { AccountSectionProps } from './types'

/** Sign-in email and password. Read-only while the account is pending deletion. */
export default function SecuritySection({ locked }: AccountSectionProps) {
  const { session } = useAuth()
  return (
    <fieldset disabled={locked} className="min-w-0 space-y-6 border-0 p-0">
      <ChangeEmailForm current={session?.user.email ?? ''} />
      <ChangePasswordForm />
    </fieldset>
  )
}
