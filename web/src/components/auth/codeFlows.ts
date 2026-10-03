import { authActions } from '#/lib/authActions'
import type { AuthResult, CodeType } from '#/lib/authActions'

/** Why a code was emailed on the login page. */
export type CodePurpose = 'signup' | 'signin'

/** What checking a code means, and how to get another, for each purpose: the one table `CodeForm` is driven by. */
export const CODE_FLOWS: Record<
  CodePurpose,
  { verifyType: CodeType; resend: (email: string) => Promise<AuthResult> }
> = {
  signup: { verifyType: 'signup', resend: authActions.resendSignupCode },
  signin: { verifyType: 'email', resend: authActions.requestSignInCode },
}
