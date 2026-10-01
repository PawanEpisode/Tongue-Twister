import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { SelectField } from '#/components/ui/select'
import { TOPIC_MAX } from '#/lib/generate/topic'
import { LEVELS, WORDS_MAX, WORDS_MIN } from './options'

/** The editable request. Shown before a twister exists, and again when making another. */
export function GenerateFields({
  id,
  topic,
  difficulty,
  words,
  formError,
  disabled,
  onTopic,
  onDifficulty,
  onWords,
}: {
  id: string
  topic: string
  difficulty: number
  words: string
  formError: string | null
  disabled: boolean
  onTopic: (value: string) => void
  onDifficulty: (value: number) => void
  onWords: (value: string) => void
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${id}-topic`}>What should it be about?</Label>
        <Input
          id={`${id}-topic`}
          value={topic}
          maxLength={TOPIC_MAX}
          disabled={disabled}
          onChange={(e) => onTopic(e.target.value)}
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
      <SelectField
        id={`${id}-level`}
        label="Difficulty"
        value={String(difficulty)}
        disabled={disabled}
        onValueChange={(value) => onDifficulty(Number(value))}
        options={LEVELS.map((level) => ({
          value: String(level.value),
          label: level.label,
        }))}
      />
      <div className="space-y-2">
        <Label htmlFor={`${id}-words`}>Number of words</Label>
        <Input
          id={`${id}-words`}
          type="number"
          inputMode="numeric"
          min={WORDS_MIN}
          max={WORDS_MAX}
          disabled={disabled}
          value={words}
          onChange={(e) => onWords(e.target.value)}
          aria-describedby={`${id}-words-hint`}
        />
        <p id={`${id}-words-hint`} className="text-xs text-muted-foreground">
          Between {WORDS_MIN} and {WORDS_MAX}.
        </p>
      </div>
    </>
  )
}
