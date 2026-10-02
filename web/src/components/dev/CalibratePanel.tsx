import { useEffect, useMemo, useRef, useState } from 'react'
import AccurateModePrompt from '#/components/practice/AccurateModePrompt'
import { Button } from '#/components/ui/button'
import { api } from '#/lib/api'
import type { AccentLang, Pronunciations } from '#/lib/api'
import { runBenchmark } from '#/lib/calibrate/benchmark'
import type { BenchmarkResult } from '#/lib/calibrate/benchmark'
import {
  AGE_BANDS,
  DEVICE_CLASSES,
  SCENARIOS,
  buildClip,
  bundleJson,
  clipId,
  deviceClass,
} from '#/lib/calibrate/clip'
import type { GoldClip, Scenario, Speaker } from '#/lib/calibrate/clip'
import { hint, planSwap } from '#/lib/calibrate/swapPlan'
import { ACCENTS, useAccent, useAccurateEngine } from '#/lib/speak/accurate'
import type { EngineStatus } from '#/lib/speak/engine/runtime/engine'
import type { Captured } from '#/lib/speak/engine/runtime/capture'
import type { Analysis } from '#/lib/speak/engine/runtime/session'

const CLIPS_KEY = 'twister.calibrate.clips.v1'
const SPEAKER_KEY = 'twister.calibrate.speaker.v1'

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

type Recorder = { stop: () => Captured | null; cancel: () => void }

async function startRecorder(): Promise<Recorder> {
  // The same constraints as the Speak screen: the gold set has to match what the engine hears in production.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
  const ctx = new AudioContext()
  await ctx.resume()
  const source = ctx.createMediaStreamSource(stream)
  const { startTap } = await import('#/lib/speak/engine/runtime/tap')
  const tap = await startTap(ctx, source, stream.getAudioTracks()[0])
  const release = () => {
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => undefined)
  }
  if (!tap) {
    release()
    throw new Error('This browser has no AudioWorklet.')
  }
  return {
    stop: () => {
      const captured = tap.stop()
      release()
      return captured
    },
    cancel: () => {
      tap.cancel()
      release()
    },
  }
}

/** Why the recorder is disabled. The server flag only offers Accurate mode; the engine must also be running here. */
function notReadyReason(status: EngineStatus): string {
  switch (status.state) {
    case 'checking':
      return 'Checking whether Accurate mode is available…'
    case 'idle':
      return 'Accurate mode is available but not started: use the Accurate mode panel above to download the model.'
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
  const [slug, setSlug] = useState('')
  const [pron, setPron] = useState<Pronunciations | null>(null)
  const [pronError, setPronError] = useState<string | null>(null)
  const [scenario, setScenario] = useState<Scenario>('clean')
  const [clips, setClips] = useState<GoldClip[]>(() =>
    load<GoldClip[]>(CLIPS_KEY, []),
  )
  const [recording, setRecording] = useState<Recorder | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<{ analysis: Analysis } | null>(null)
  const [bench, setBench] = useState<BenchmarkResult | null>(null)
  const recorderRef = useRef<Recorder | null>(null)

  useEffect(() => {
    setSpeaker((s) => ({
      ...s,
      device_class:
        s.device_class === 'unknown'
          ? deviceClass(navigator.userAgent, navigator.maxTouchPoints > 0)
          : s.device_class,
      accent: s.accent,
    }))
  }, [])
  useEffect(() => save(SPEAKER_KEY, speaker), [speaker])
  useEffect(() => save(CLIPS_KEY, clips), [clips])
  useEffect(() => () => recorderRef.current?.cancel(), [])

  const plan = useMemo(
    () =>
      pron && engine ? planSwap(pron.words, pron.focus, pronVocab(pron)) : null,
    [pron, engine],
  )

  async function fetchTwister() {
    setPronError(null)
    setPron(null)
    try {
      setPron(await api.pronunciations(slug.trim(), speaker.accent))
    } catch {
      setPronError(
        'Could not load that twister’s pronunciations (unknown slug, or it has no scoring data).',
      )
    }
  }

  async function begin() {
    setError(null)
    setLast(null)
    try {
      const r = await startRecorder()
      recorderRef.current = r
      setRecording(r)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }

  async function finish() {
    const r = recorderRef.current
    if (!r || !engine || !pron) return
    recorderRef.current = null
    setRecording(null)
    const captured = r.stop()
    if (!captured || captured.samples.length < 4000)
      return setError('Nothing was captured.')
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
    const take =
      clips.filter(
        (c) =>
          c.speaker.id === speaker.id &&
          c.twister.slug === pron.slug &&
          c.scenario === scenario,
      ).length + 1
    setClips((all) => [
      ...all,
      buildClip({
        id: clipId(speaker.id, pron.slug, scenario, take),
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
    setBusy(true)
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
      setBusy(false)
    }
  }

  const ready = status.state === 'ready'
  const canRecord =
    ready && !!pron && consent && !busy && !(scenario === 'swap' && !plan)
  const select =
    'rounded-lg border border-border bg-background px-2 py-1.5 text-sm'
  const field = 'flex flex-col gap-1 text-sm text-muted-foreground'

  return (
    <div className="mx-auto max-w-3xl space-y-8 text-left">
      <header>
        <h1 className="font-display text-3xl font-bold">Calibration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Staff only. Record the gold set: scripted reads whose correct answer
          is known, kept as frame posteriors so thresholds can be tuned offline
          (tools/calibrate). Audio never leaves this page; only posteriors are
          saved.
        </p>
      </header>

      <AccurateModePrompt
        engine={engine}
        status={status}
        accent={accent}
        onAccent={setAccent}
      />

      <section
        aria-label="Speaker"
        className="grid gap-3 rounded-2xl border border-border/60 p-4 sm:grid-cols-3"
      >
        <label className={field}>
          Speaker id (no names)
          <input
            className={select}
            value={speaker.id}
            onChange={(e) =>
              setSpeaker({ ...speaker, id: e.target.value.trim() })
            }
          />
        </label>
        <label className={field}>
          Accent
          <select
            className={select}
            value={speaker.accent}
            onChange={(e) => {
              setSpeaker({ ...speaker, accent: e.target.value as AccentLang })
              setPron(null)
            }}
          >
            {ACCENTS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          Age band
          <select
            className={select}
            value={speaker.age_band}
            onChange={(e) =>
              setSpeaker({
                ...speaker,
                age_band: e.target.value as Speaker['age_band'],
              })
            }
          >
            {AGE_BANDS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className={field}>
          Device
          <select
            className={select}
            value={speaker.device_class}
            onChange={(e) =>
              setSpeaker({
                ...speaker,
                device_class: e.target.value as Speaker['device_class'],
              })
            }
          >
            {DEVICE_CLASSES.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={speaker.native}
            onChange={(e) =>
              setSpeaker({ ...speaker, native: e.target.checked })
            }
          />
          Native English speaker
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          This speaker agreed to be recorded and to keep the resulting
          posteriors for calibration.
        </label>
      </section>

      <section
        aria-label="Twister"
        className="space-y-3 rounded-2xl border border-border/60 p-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className={field}>
            Twister slug
            <input
              className={select}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="she-sells-sea-shells"
            />
          </label>
          <Button
            size="sm"
            onClick={() => void fetchTwister()}
            disabled={!slug.trim()}
          >
            Load
          </Button>
          <label className={field}>
            Scenario
            <select
              className={select}
              value={scenario}
              onChange={(e) => setScenario(e.target.value as Scenario)}
            >
              {SCENARIOS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        {pronError && (
          <p role="alert" className="text-sm text-pink">
            {pronError}
          </p>
        )}
        {pron && (
          <div>
            <p className="font-display text-2xl font-bold">
              {pron.words.map((w) => w.text).join(' ')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {scenario === 'swap'
                ? plan
                  ? `In “${plan.word}”, say the ${hint(plan.from)} sound as ${hint(plan.to)} instead. Everything else as normal.`
                  : 'No word in this twister can be swapped for a sound the model knows; pick another twister.'
                : PROMPT[scenario]}
            </p>
          </div>
        )}
      </section>

      <section aria-label="Recorder" className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {recording ? (
            <Button onClick={() => void finish()}>Stop</Button>
          ) : (
            <Button onClick={() => void begin()} disabled={!canRecord}>
              Record take
            </Button>
          )}
          {recording && (
            <span role="status" className="text-sm text-pink">
              Recording…
            </span>
          )}
          {busy && (
            <span role="status" className="text-sm text-muted-foreground">
              Working…
            </span>
          )}
          {!ready && (
            <span className="text-sm text-muted-foreground">
              {notReadyReason(status)}
            </span>
          )}
          {ready && !consent && (
            <span className="text-sm text-muted-foreground">
              Tick the consent box to record.
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-pink">
            {error}
          </p>
        )}
        {last && (
          <Outcome
            analysis={last.analysis}
            onKeep={keep}
            onDiscard={() => setLast(null)}
          />
        )}
      </section>

      <section aria-label="Clips" className="space-y-2">
        <h2 className="font-display text-xl font-bold">
          Kept clips ({clips.length})
        </h2>
        <ClipSummary clips={clips} />
        <div className="flex gap-2">
          <Button size="sm" onClick={download} disabled={!clips.length}>
            Download gold set
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setClips([])}
            disabled={!clips.length}
          >
            Clear all
          </Button>
        </div>
        <ul className="max-h-48 divide-y divide-border/50 overflow-y-auto text-sm">
          {clips.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-1">
              <span>{c.id}</span>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setClips(clips.filter((x) => x.id !== c.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Benchmark" className="space-y-2">
        <h2 className="font-display text-xl font-bold">Device benchmark</h2>
        <Button
          size="sm"
          onClick={() => void benchmark()}
          disabled={!ready || busy}
        >
          Run benchmark
        </Button>
        {bench && (
          <pre className="overflow-x-auto rounded-xl bg-card p-3 text-xs">
            {JSON.stringify(bench, null, 2)}
          </pre>
        )}
      </section>
    </div>
  )
}

const pronVocab = (p: Pronunciations) => [
  ...new Set(p.words.flatMap((w) => w.variants.flat())),
]

function ClipSummary({ clips }: { clips: GoldClip[] }) {
  const by = (f: (c: GoldClip) => string) =>
    Object.entries(
      clips.reduce<Record<string, number>>(
        (acc, c) => ({ ...acc, [f(c)]: (acc[f(c)] ?? 0) + 1 }),
        {},
      ),
    )
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ')
  if (!clips.length)
    return (
      <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
    )
  return (
    <p className="text-sm text-muted-foreground">
      {by((c) => c.scenario)} — speakers{' '}
      {new Set(clips.map((c) => c.speaker.id)).size}, twisters{' '}
      {new Set(clips.map((c) => c.twister.slug)).size}
    </p>
  )
}

function Outcome({
  analysis,
  onKeep,
  onDiscard,
}: {
  analysis: Analysis
  onKeep: () => void
  onDiscard: () => void
}) {
  if (analysis.kind !== 'scored')
    return (
      <div
        role="status"
        className="rounded-xl border border-border/60 p-3 text-sm"
      >
        {analysis.kind === 'gate'
          ? `Not usable: ${analysis.message}`
          : `Not scorable (${analysis.reason}).`}{' '}
        Discard it and record again.
        <div className="mt-2">
          <Button size="sm" variant="ghost" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </div>
    )
  const a = analysis.assessment
  return (
    <div className="rounded-xl border border-border/60 p-3 text-sm">
      <p className="font-semibold">
        Score {a.score} · {analysis.inferenceMs} ms
      </p>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 sm:grid-cols-4">
        {a.words
          .filter((w) => w.status !== 'extra')
          .map((w) => (
            <li key={w.index}>
              {w.text}: <strong>{w.status}</strong>
              {w.reason ? ` (${w.reason})` : ''}
            </li>
          ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onKeep}>
          Keep clip
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  )
}
