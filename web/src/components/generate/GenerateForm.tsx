import { Link } from '@tanstack/react-router'
import { Loader2, Sparkles } from 'lucide-react'
import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { classifyGenerateError } from '#/lib/generate/errors'
import { useGenerate } from '#/lib/generate/hooks'
import { TOPIC_MAX, checkTopic } from '#/lib/generate/topic'

const LEVELS = [
  { value: 0, label: 'Any level' },
  { value: 1, label: 'Easy' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Hard' },
  { value: 4, label: 'Expert' },
]

export default function GenerateForm() {
  const id = useId()
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState(0)
  const [formError, setFormError] = useState<string | null>(null)
  const gen = useGenerate()
  const failure = gen.isError ? classifyGenerateError(gen.error) : null
  const result = gen.data
  const limited = failure?.kind === 'limit'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (gen.isPending) return
    const check = checkTopic(topic)
    if (!check.ok) {
      setFormError(check.error)
      return
    }
    setFormError(null)
    gen.mutate({
      topic: check.topic,
      language: 'en',
      ...(difficulty ? { difficulty } : {}),
    })
  }

  return (
    <div className="space-y-6 text-left">
      <form
        onSubmit={submit}
        className="glass space-y-4 rounded-2xl p-6"
        noValidate
      >
        <div className="space-y-2">
          <label htmlFor={`${id}-topic`} className="text-sm font-medium">
            What should it be about?
          </label>
          <Input
            id={`${id}-topic`}
            value={topic}
            maxLength={TOPIC_MAX}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. sleepy otters"
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? `${id}-err` : `${id}-hint`}
            autoComplete="off"
          />
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {topic.length}/{TOPIC_MAX}. Your topic is only used to write the
            twister.
          </p>
          {formError && (
            <p id={`${id}-err`} role="alert" className="text-sm text-pink">
              {formError}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <label htmlFor={`${id}-level`} className="text-sm font-medium">
            Difficulty
          </label>
          <select
            id={`${id}-level`}
            value={difficulty}
            onChange={(e) => setDifficulty(Number(e.target.value))}
            className="w-full rounded-xl border border-input bg-card px-4 py-3 text-foreground focus:border-primary"
          >
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="submit"
          disabled={gen.isPending || limited}
          aria-disabled={gen.isPending || limited}
        >
          {gen.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-4" aria-hidden />
          )}
          {gen.isPending ? 'Making your twister…' : 'Make my twister'}
        </Button>
      </form>

      <div role="status" aria-live="polite" className="min-h-6 text-sm">
        {gen.isPending && (
          <span className="text-muted-foreground">
            Writing your twister, this can take a few seconds.
          </span>
        )}
        {result && <span className="sr-only">Your twister is ready.</span>}
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

      {result && (
        <section
          aria-labelledby={`${id}-result`}
          className="glass space-y-3 rounded-2xl p-6"
        >
          <h2 id={`${id}-result`} className="font-display text-lg font-bold">
            Your new twister
          </h2>
          <p className="text-xl">{result.text}</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/twisters/$slug" params={{ slug: result.slug }}>
                Practise it
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/my-twisters">My twisters</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Only you can see this twister.
          </p>
        </section>
      )}
    </div>
  )
}
