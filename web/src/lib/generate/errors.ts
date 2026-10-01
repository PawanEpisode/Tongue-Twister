export type GenerateErrorKind =
  | 'limit'
  | 'rejected'
  | 'unavailable'
  | 'signin'
  | 'disabled'
  | 'network'
  | 'unknown'

export type GenerateFailure = { kind: GenerateErrorKind; message: string }

const MESSAGES: Record<GenerateErrorKind, string> = {
  limit:
    'You’ve used today’s generations. Come back tomorrow, or practise the ones you already made.',
  rejected:
    'We couldn’t make a good twister from that. Try a simpler or different topic.',
  unavailable:
    'The twister maker is resting right now. Please try again in a little while.',
  signin: 'Please sign in to make your own twisters.',
  disabled: 'Making your own twisters isn’t available yet.',
  network: 'We can’t reach the server. Check your connection and try again.',
  unknown: 'Something unexpected happened. Please try again.',
}

/** Map a thrown value (an `ApiError`, or anything) to copy and a kind the UI can branch on. */
export function classifyGenerateError(err: unknown): GenerateFailure {
  const status = (err as { status?: unknown } | null)?.status
  const code = (err as { code?: unknown } | null)?.code
  let kind: GenerateErrorKind = 'unknown'
  if (typeof status === 'number') {
    if (status === 429 || code === 'generation_limit') kind = 'limit'
    else if (status === 422 || code === 'generation_rejected') kind = 'rejected'
    else if (status === 503 || code === 'generator_unavailable')
      kind = 'unavailable'
    else if (status === 401) kind = 'signin'
    else if (status === 403 || status === 404) kind = 'disabled'
    else if (status >= 500) kind = 'unavailable'
  } else if (
    err instanceof Error &&
    /failed to fetch|network|load failed/i.test(err.message)
  )
    kind = 'network'
  return { kind, message: MESSAGES[kind] }
}
