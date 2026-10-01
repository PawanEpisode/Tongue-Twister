export const TOPIC_MAX = 120

/** Strip control characters and collapse whitespace; the server treats the topic as data too. */
export function cleanTopic(raw: string): string {
  const spaced = Array.from(raw, (ch) => {
    const c = ch.charCodeAt(0)
    return c < 32 || (c >= 127 && c <= 159) ? ' ' : ch
  }).join('')
  return spaced.replace(/\s+/g, ' ').trim()
}

export type TopicCheck =
  { ok: true; topic: string } | { ok: false; error: string }

export function checkTopic(raw: string): TopicCheck {
  const topic = cleanTopic(raw)
  if (topic.length < 2)
    return { ok: false, error: 'Tell us a topic first, like “sleepy otters”.' }
  if (topic.length > TOPIC_MAX)
    return {
      ok: false,
      error: `Keep the topic under ${TOPIC_MAX + 1} characters.`,
    }
  return { ok: true, topic }
}
