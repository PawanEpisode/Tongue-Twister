import { ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BenchmarkPanel from '#/components/dev/calibrate/BenchmarkPanel'
import ClipsPanel from '#/components/dev/calibrate/ClipsPanel'
import RecorderStage, {
  SCENARIO_COPY,
} from '#/components/dev/calibrate/RecorderStage'
import type { Phase } from '#/components/dev/calibrate/RecorderStage'
import SpeakerCard from '#/components/dev/calibrate/SpeakerCard'
import TwisterPicker, {
  useTwisterCatalogue,
} from '#/components/dev/calibrate/TwisterPicker'
import AccurateModePrompt from '#/components/practice/AccurateModePrompt'
import { Button } from '#/components/ui/button'
import { api } from '#/lib/api'
import type { AccentLang, Pronunciations } from '#/lib/api'
import { runBenchmark } from '#/lib/calibrate/benchmark'
import type { BenchmarkResult } from '#/lib/calibrate/benchmark'
import {
  buildClip,
  bundleJson,
  clipId,
  deviceClass,
} from '#/lib/calibrate/clip'
import type { GoldClip, Scenario, Speaker } from '#/lib/calibrate/clip'
import { freeTake, nextUnrecorded, takeCounts } from '#/lib/calibrate/coverage'
import { startRecorder } from '#/lib/calibrate/recorder'
import type { Recorder } from '#/lib/calibrate/recorder'
import { hint, planSwap } from '#/lib/calibrate/swapPlan'
import { ACCENTS, useAccent, useAccurateEngine } from '#/lib/speak/accurate'
import type { EngineStatus } from '#/lib/speak/engine/runtime/engine'
import type { Analysis } from '#/lib/speak/engine/runtime/session'

const CLIPS_KEY = 'twister.calibrate.clips.v1'
const SPEAKER_KEY = 'twister.calibrate.speaker.v1'
const SLUG_KEY = 'twister.calibrate.slug.v1'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked: the download button is still the source of truth */
  }
}

const PROMPT: Record<Exclude<Scenario, 'swap'>, string> = {
  clean: 'Read the twister clearly at a natural pace.',
  fast: 'Read it as fast as you comfortably can, still saying every word.',
  slur: 'Read it quickly and sloppily, running the words together.',
}

/** Why the recorder is disabled. The server flag only offers Accurate mode; the engine must also be running here. */
function notReadyReason(status: EngineStatus): string {
  switch (status.state) {
    case 'checking':
      return 'Checking whether Accurate mode is available…'
    case 'idle':
      return 'Turn on Accurate mode above to download the model.'
    case 'downloading':
      return 'Downloading the model…'
    case 'starting':
      return 'Starting the model…'
    case 'error':
      return `Accurate mode failed to start (${status.code}).`
    case 'unavailable':
      switch (status.reason) {
        case 'no_model':
          return 'No acoustic model is published yet (run publish_acoustic_model and activate it).'
        case 'server_off':
          return 'The server has Accurate mode switched off for this account.'
        case 'manifest_failed':
          return 'Could not load the model manifest from the API.'
        default:
          return `This browser cannot run Accurate mode (${status.reason}).`
      }
    default:
      return 'Accurate mode is not ready.'
  }
}

const pronVocab = (p: Pronunciations) => [
  ...new Set(p.words.flatMap((w) => w.variants.flat())),
]

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName))

export default function CalibratePanel() {
  const { engine, status } = useAccurateEngine(true)
  // This page exists to measure devices, slow ones included: never hide the model behind the speed ceiling here.
  useEffect(() => {
    if (!engine) return
    engine.allowSlowDevice(true)
    void engine.refresh()
  }, [engine])
  const [accent, setAccent] = useAccent()
  const [speaker, setSpeaker] = useState<Speaker>(() =>
    load<Speaker>(SPEAKER_KEY, {
      id: 'S01',
      accent: 'en-IN',
      age_band: '25-34',
      native: true,
      device_class: 'unknown',
    }),
  )
  const [consent, setConsent] = useState(false)
  const [slug, setSlug] = useState(() => load<string>(SLUG_KEY, ''))
  const [pickerOpen, setPickerOpen] = useState(
    () => !load<string>(SLUG_KEY, ''),
  )
  const [pron, setPron] = useState<Pronunciations | null>(null)
  const [pronLoading, setPronLoading] = useState(false)
  const [pronError, setPronError] = useState<string | null>(null)
  const [scenario, setScenario] = useState<Scenario>('clean')
  const [clips, setClips] = useState<GoldClip[]>(() =>
    load<GoldClip[]>(CLIPS_KEY, []),
  )
  const [recording, setRecording] = useState<Recorder | null>(null)
  const [starting, setStarting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [benching, setBenching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<{ analysis: Analysis } | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [bench, setBench] = useState<BenchmarkResult | null>(null)
  const recorderRef = useRef<Recorder | null>(null)

  const catalogue = useTwisterCatalogue()
  const twisters = useMemo(() => catalogue.data ?? [], [catalogue.data])

  useEffect(() => {
    setSpeaker((s) =>
      s.device_class === 'unknown'
        ? {
            ...s,
            device_class: deviceClass(
              navigator.userAgent,
              navigator.maxTouchPoints > 0,
            ),
          }
        : s,
    )
  }, [])
  useEffect(() => save(SPEAKER_KEY, speaker), [speaker])
  useEffect(() => save(CLIPS_KEY, clips), [clips])
  useEffect(() => save(SLUG_KEY, slug), [slug])
  useEffect(() => () => recorderRef.current?.cancel(), [])

  // Load the pronunciations whenever the twister or the accent changes: no separate Load button.
  useEffect(() => {
    setPron(null)
    setPronError(null)
    if (!slug) return
    let cancelled = false
    setPronLoading(true)
    api
      .pronunciations(slug, speaker.accent)
      .then((p) => !cancelled && setPron(p))
      .catch(
        () =>
          !cancelled &&
          setPronError(
            'Could not load that twister’s pronunciations (unknown slug, or it has no scoring data).',
          ),
      )
      .finally(() => !cancelled && setPronLoading(false))
    return () => {
      cancelled = true
    }
  }, [slug, speaker.accent])

  const plan = useMemo(
    () =>
      pron && engine ? planSwap(pron.words, pron.focus, pronVocab(pron)) : null,
    [pron, engine],
  )

  const counts = useMemo(
    () => takeCounts(clips, speaker.id, scenario),
    [clips, speaker.id, scenario],
  )
  const slugs = useMemo(() => twisters.map((t) => t.slug), [twisters])
  const next = useMemo(
    () => nextUnrecorded(slugs, clips, speaker.id, scenario, slug || undefined),
    [slugs, clips, speaker.id, scenario, slug],
  )

  function pick(nextSlug: string) {
    setSlug(nextSlug)
    setLast(null)
    setError(null)
    setSavedId(null)
  }

  async function begin() {
    setError(null)
    setLast(null)
    setSavedId(null)
    setStarting(true)
    try {
      const r = await startRecorder()
      recorderRef.current = r
      setRecording(r)
    } catch (e) {
      const err = e as Error
      setError(
        err.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in the browser’s address bar, then try again.'
          : err.name === 'NotFoundError'
            ? 'No microphone was found.'
            : String(err.message ?? e),
      )
    } finally {
      setStarting(false)
    }
  }

  async function finish() {
    const r = recorderRef.current
    if (!r || !engine || !pron) return
    recorderRef.current = null
    setRecording(null)
    const captured = r.stop()
    if (!captured || captured.samples.length < 4000)
      return setError(
        'Nothing was captured. Press Stop only after you have read the twister.',
      )
    setBusy(true)
    try {
      const analysis = await engine.analyse({
        samples: captured.samples,
        captureRate: captured.captureRate,
        words: pron.words,
        focus: pron.focus,
        difficulty: pron.difficulty,
        keepPosteriors: true,
      })
      setLast({ analysis })
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  function keep() {
    if (
      !last ||
      last.analysis.kind !== 'scored' ||
      !last.analysis.posteriors ||
      !pron ||
      !engine
    )
      return
    const a = last.analysis
    const id = clipId(
      speaker.id,
      pron.slug,
      scenario,
      freeTake(clips, speaker.id, pron.slug, scenario),
    )
    setClips((all) => [
      ...all,
      buildClip({
        id,
        speaker,
        scenario,
        swapWord: scenario === 'swap' ? (plan?.wordIndex ?? null) : null,
        slug: pron.slug,
        focus: pron.focus,
        difficulty: pron.difficulty,
        words: pron.words,
        posteriors: a.posteriors!,
        durationMs:
          Number(a.quality.trimmed_ms) || a.posteriors!.logp.length * 20,
        latencyMs: a.inferenceMs,
        model: { name: engine.modelVersion, sha256: engine.modelSha256 },
        quality: a.quality,
      }),
    ])
    setLast(null)
    setSavedId(id)
  }

  function discard() {
    setLast(null)
    setError(null)
  }

  function download() {
    const blob = new Blob([bundleJson(clips)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gold-${new Date().toISOString().slice(0, 10)}-${speaker.id}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function benchmark() {
    if (!engine) return
    setBenching(true)
    setError(null)
    try {
      const mem = (
        performance as unknown as { memory?: { usedJSHeapSize: number } }
      ).memory
      const nav = navigator as Navigator & { deviceMemory?: number }
      setBench(
        await runBenchmark((s) => engine.benchmarkRun(s), {
          loadMs: null,
          threads: status.state === 'ready' ? status.threads : 1,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemoryGB: nav.deviceMemory ?? null,
          jsHeapMB: mem ? Math.round(mem.usedJSHeapSize / 1_048_576) : null,
          userAgent: navigator.userAgent,
          touch: navigator.maxTouchPoints > 0,
        }),
      )
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBenching(false)
    }
  }

  const ready = status.state === 'ready'
  const swapBlocked = scenario === 'swap' && !!pron && !plan

  const blockers: string[] = []
  if (!ready) blockers.push(notReadyReason(status))
  if (!speaker.id) blockers.push('Enter a speaker id.')
  if (!consent) blockers.push('Confirm the speaker’s consent to record.')
  if (!slug) blockers.push('Choose a twister.')
  else if (pronLoading) blockers.push('Loading the twister…')
  else if (pronError) blockers.push(pronError)
  if (swapBlocked)
    blockers.push(
      'No word in this twister can be swapped for a sound the model knows. Pick another twister.',
    )

  const phase: Phase = recording
    ? 'recording'
    : starting
      ? 'starting'
      : busy
        ? 'analysing'
        : last
          ? 'result'
          : 'idle'

  const instruction = !pron
    ? null
    : scenario === 'swap'
      ? plan
        ? `In “${plan.word}”, say the ${hint(plan.from)} sound as ${hint(plan.to)} instead. Everything else as normal.`
        : 'No word in this twister can be swapped for a sound the model knows.'
      : PROMPT[scenario]

  const keepable =
    last?.analysis.kind === 'scored' && !!last.analysis.posteriors

  // Keyboard: R records/stops, K keeps, D discards. Never while typing in a field.
  const actions = useRef({ begin, finish, keep, discard })
  actions.current = { begin, finish, keep, discard }
  const phaseRef = useRef({ phase, blocked: blockers.length > 0, keepable })
  phaseRef.current = { phase, blocked: blockers.length > 0, keepable }
  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
    const { phase: p, blocked, keepable: k } = phaseRef.current
    const key = e.key.toLowerCase()
    if (key === 'r') {
      if (p === 'recording') void actions.current.finish()
      else if (p === 'idle' && !blocked) void actions.current.begin()
    } else if (key === 'k' && p === 'result' && k) actions.current.keep()
    else if (key === 'd' && p === 'result') actions.current.discard()
  }, [])
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  return (
    <div className="mx-auto max-w-5xl space-y-6 text-left">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h1 className="font-display text-3xl font-bold">Calibration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Staff only. Record scripted reads whose right answer is known. Only
            the frame posteriors are saved, so thresholds can be tuned offline.
            Audio never leaves this page.
          </p>
        </div>
        {ready && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card/40 px-3 py-2 text-sm">
            <ShieldCheck className="size-4 text-lime" aria-hidden />
            <span className="font-semibold">Accurate mode on</span>
            <label className="flex items-center gap-1.5 text-muted-foreground">
              <span className="sr-only sm:not-sr-only">Counts as right:</span>
              <select
                value={accent}
                onChange={(e) => setAccent(e.target.value as AccentLang)}
                aria-label="Accent that counts as right"
                className="rounded-lg border border-border bg-background px-2 py-1 text-foreground"
              >
                {ACCENTS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => engine?.disable()}
              disabled={phase === 'recording' || phase === 'analysing'}
            >
              Turn off
            </Button>
          </div>
        )}
      </header>

      {!ready && (
        <div className="[&>section]:mx-0 [&>section]:mt-0 [&>section]:max-w-none">
          <AccurateModePrompt
            engine={engine}
            status={status}
            accent={accent}
            onAccent={setAccent}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4">
          <SpeakerCard
            speaker={speaker}
            onChange={setSpeaker}
            consent={consent}
            onConsent={setConsent}
          />
          <TwisterPicker
            twisters={twisters}
            loading={catalogue.isLoading}
            failed={catalogue.isError}
            selected={slug}
            counts={counts}
            scenarioLabel={SCENARIO_COPY[scenario].label.toLowerCase()}
            onPick={pick}
            onNext={next ? () => pick(next) : null}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
          />
          <RecorderStage
            phase={phase}
            scenario={scenario}
            onScenario={(s) => {
              setScenario(s)
              setSavedId(null)
            }}
            swapDisabled={!!pron && !plan}
            words={pron ? pron.words.map((w) => w.text) : null}
            instruction={instruction}
            blockers={blockers}
            recorder={recording}
            analysis={last?.analysis ?? null}
            error={error}
            savedId={savedId}
            keepable={keepable}
            onRecord={() => void begin()}
            onStop={() => void finish()}
            onKeep={keep}
            onDiscard={discard}
            onNext={next ? () => pick(next) : null}
          />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4">
          <ClipsPanel
            clips={clips}
            onRemove={(id) => setClips((all) => all.filter((c) => c.id !== id))}
            onClear={() => setClips([])}
            onDownload={download}
          />
          <BenchmarkPanel
            result={bench}
            running={benching}
            disabled={!ready || busy || phase === 'recording'}
            onRun={() => void benchmark()}
          />
        </aside>
      </div>
    </div>
  )
}
