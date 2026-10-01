import { Link } from '@tanstack/react-router'
import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '#/components/ui/button'
import { classifyGenerateError } from '#/lib/generate/errors'
import { useGenerate } from '#/lib/generate/hooks'
import { checkTopic } from '#/lib/generate/topic'
import { GenerateBrief } from './GenerateBrief'
import { GenerateCta } from './GenerateCta'
import { GenerateFields } from './GenerateFields'
import { GeneratedTwisterCard } from './GeneratedTwisterCard'
import { WORDS_DEFAULT, WORDS_MAX, WORDS_MIN } from './options'
import type { GenerateBrief as Brief } from './options'
import type { GeneratePhase } from './GenerateCta'

export default function GenerateForm() {
  const id = useId()
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState(0)
  const [words, setWords] = useState(String(WORDS_DEFAULT))
  const [formError, setFormError] = useState<string | null>(null)
  const [brief, setBrief] = useState<Brief | null>(null)
  const [composing, setComposing] = useState(true)
  const gen = useGenerate()
  const failure = gen.isError ? classifyGenerateError(gen.error) : null
  const result = gen.data
  const limited = failure?.kind === 'limit'
  const phase: GeneratePhase = gen.isPending
    ? 'writing'
    : result
      ? 'again'
      : 'make'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (gen.isPending) return
    const check = checkTopic(topic)
    if (!check.ok) {
      setFormError(check.error)
      return
    }
    const count = Number(words)
    if (!Number.isInteger(count) || count < WORDS_MIN || count > WORDS_MAX) {
      setFormError(`Use between ${WORDS_MIN} and ${WORDS_MAX} words.`)
      return
    }
    setFormError(null)
    const next = { topic: check.topic, difficulty, words: count }
    gen.mutate(
      {
        topic: next.topic,
        language: 'en',
        words: next.words,
        ...(next.difficulty ? { difficulty: next.difficulty } : {}),
      },
      {
        onSuccess: () => {
          setBrief(next)
          setComposing(false)
        },
      },
    )
  }

  return (
    <div className="space-y-6 text-left">
      {composing || !brief ? (
        <form
          onSubmit={submit}
          className="glass space-y-4 rounded-2xl p-4 sm:p-6"
          noValidate
        >
          <GenerateFields
            id={id}
            topic={topic}
            difficulty={difficulty}
            words={words}
            formError={formError}
            disabled={gen.isPending}
            onTopic={setTopic}
            onDifficulty={setDifficulty}
            onWords={setWords}
          />
          <GenerateCta phase={phase} disabled={limited} />
        </form>
      ) : (
        <GenerateBrief brief={brief} onEdit={() => setComposing(true)} />
      )}

      <div role="status" aria-live="polite" className="min-h-6 text-sm">
        {gen.isPending && (
          <span className="text-muted-foreground">
            Writing your twister, this can take a few seconds.
          </span>
        )}
        {result && !gen.isPending && (
          <span className="sr-only">Your twister is ready.</span>
        )}
      </div>

      {failure && (
        <div
          role="alert"
          className="glass rounded-2xl border-pink/40 p-5 text-sm"
        >
          <p>{failure.message}</p>
          {failure.kind === 'limit' && (
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link to="/my-twisters">See my twisters</Link>
            </Button>
          )}
        </div>
      )}

      {result && !gen.isPending && <GeneratedTwisterCard twister={result} />}
    </div>
  )
}
