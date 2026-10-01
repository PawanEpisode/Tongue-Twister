import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { CONSENT_VERSION } from '#/lib/api'
import type { Preferences, Twister, UnlockedAchievement } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { useTwisterNavigation } from '#/lib/browseContext'
import { useFlags } from '#/lib/flags'
import { clampWpm, buildTimeline, defaultWpm } from '#/lib/readAlong/timeline'
import { useReadAlong } from '#/lib/readAlong/useReadAlong'
import { analyseTake, deliveryHints } from '#/lib/record/analysis'
import { detectCapabilities } from '#/lib/record/capabilities'
import { isRecoverable, openChunkStore } from '#/lib/record/chunkStore'
import type { StoredAnalysis, StoredMeta } from '#/lib/record/chunkStore'
import { buildCreateBody } from '#/lib/record/cloud'
import { canShare, saveAccess } from '#/lib/record/cloudGate'
import {
  HitTimes,
  buildTextLayer,
  usesPacing,
  usesSpeech,
} from '#/lib/record/highlight'
import type { BubbleState } from '#/lib/record/layouts/types'
import {
  loadSettings,
  saveSettings,
  layoutStateOf,
} from '#/lib/record/settings'
import type { RecordSettings } from '#/lib/record/settings'
import { defaultTitle, takeFromStored } from '#/lib/record/take'
import type { Take } from '#/lib/record/take'
import { track } from '#/lib/record/telemetry'
import { thumbnailFromBlob } from '#/lib/record/thumbnail'
import {
  useConsentMutation,
  useConsents,
  usePlanLimits,
  useStorage,
} from '#/lib/record/useRecordings'
import { useRecorder } from '#/lib/record/useRecorder'
import { useUploads } from '#/lib/record/useUploads'
import { liveHits } from '#/lib/scoring'
import { displayWords } from '#/lib/speak/display'
import { useSpeech } from '#/lib/speech'
import type { SpeechResult } from '#/lib/speech'
import { usePracticeLock } from '#/lib/tabLock'
import { LeaveConfirm, useLeaveGuard } from '#/lib/useLeaveGuard'
import { useMe } from '#/lib/useMe'
import { usePracticeSubmit } from '#/lib/usePracticeSubmit'
import ConsentDialog from './ConsentDialog'
import RecordPreview from './RecordPreview'
import RecordReview from './RecordReview'
import RecordSetup from './RecordSetup'
import RecordingStage from './RecordingStage'
import RecoveryPrompt from './RecoveryPrompt'
import RegionStage, { LiveText } from './RegionStage'
import ShareDialog from './ShareDialog'

const SPEECH_SETTLE_MS = 2000
const AUTO_STOP_DELAY_MS = 800
const LIVE = ['countdown', 'recording', 'paused', 'finalizing']

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Record mode: owns the settings, the text engines (Read-along pacing and the Speak & score matcher), the
 * recorder, the finished take and the cloud flow, and lays out one screen per phase.
 */
export default function RecordMode({
  twister,
  prefs,
  onSwitchMode,
}: {
  twister: Twister
  prefs: Preferences
  onSwitchMode: () => void
}) {
  const flags = useFlags()
  const { session } = useAuth()
  const owner = session?.user.id ?? null
  const me = useMe().data
  const lock = usePracticeLock()
  const submit = usePracticeSubmit()
  const nav = useTwisterNavigation(twister)
  const { recordingMsMax, shareMaxDays } = usePlanLimits()
  const caps = useMemo(() => detectCapabilities(), [])

  const [settings, setSettings] = useState<RecordSettings>(loadSettings)
  const update = useCallback((patch: Partial<RecordSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  // ── Text engines ────────────────────────────────────────────────────────────
  const words = useMemo(
    () => displayWords(twister.text).map((w) => w.text),
    [twister.text],
  )
  const wpm = clampWpm(
    settings.wpm ?? prefs.wpm ?? defaultWpm(twister.difficulty),
  )
  const timeline = useMemo(
    () =>
      buildTimeline(twister.text, wpm, {
        punctuationPauses: prefs.punctuation_pauses,
      }),
    [twister.text, wpm, prefs.punctuation_pauses],
  )
  const speechResult = useRef<SpeechResult | null>(null)
  const speech = useSpeech({ onFinish: (r) => (speechResult.current = r) })
  const speechActive = useRef(false)
  speechActive.current = speech.listening
  const pace = useReadAlong({
    timeline,
    loops: 1,
    countdownS: 0,
    onComplete: () => {
      if (settings.autoStopOnFinish && !usesSpeech(settings.highlight))
        autoStop()
    },
  })
  const hits = useMemo(
    () =>
      usesSpeech(settings.highlight)
        ? liveHits(twister.text, speech.transcript, twister.focus_sounds)
        : [],
    [settings.highlight, twister.text, twister.focus_sounds, speech.transcript],
  )
  const text = buildTextLayer(words, settings.highlight, {
    paceIndex: pace.index,
    paceActive: pace.status === 'running',
    hits,
    speechIndex: hits.findIndex((h) => !h),
  })
  const textRef = useRef(text)
  textRef.current = text
  const layoutRef = useRef(layoutStateOf(settings))
  layoutRef.current = layoutStateOf(settings)
  const hitTimes = useRef(new HitTimes(words.length))
  const regionRef = useRef<HTMLDivElement>(null)

  // ── The take ─────────────────────────────────────────────────────────────────
  const [take, setTake] = useState<Take | null>(null)
  const [pending, setPending] = useState(false)
  const [xp, setXp] = useState<number | undefined>()
  const [unlocked, setUnlocked] = useState<UnlockedAchievement[]>([])

  const recorder = useRecorder({
    twister: { slug: twister.slug, text: twister.text },
    settings,
    caps,
    owner,
    limitMs: recordingMsMax,
    getRegionElement: () => regionRef.current,
    getText: () => textRef.current,
    getLayoutState: () => layoutRef.current,
    getPreviewMirror: () => settings.mirrorPreview,
    onTake: (t) => {
      setTake(t)
      setXp(undefined)
      setUnlocked([])
      setPending(true)
      void finishTake(t)
    },
    onGo: () => {
      hitTimes.current.reset()
      speechResult.current = null
      if (usesPacing(settings.highlight)) {
        pace.restart()
        pace.start({ skipCountdown: true })
      }
      if (usesSpeech(settings.highlight)) void speech.start()
    },
    onPause: () => pace.pause(),
    onResume: () => {
      if (usesPacing(settings.highlight)) pace.start({ skipCountdown: true })
    },
    onFinalizing: () => {
      pace.pause()
      if (speechActive.current) speech.stop()
    },
    onDiscard: () => {
      pace.restart()
      if (speechActive.current) speech.stop()
      speechResult.current = null
      hitTimes.current.reset()
    },
  })
  const { state } = recorder
  const phase = state.phase
  const live = LIVE.includes(phase)

  const autoStop = () =>
    setTimeout(() => recorder.stop('user'), AUTO_STOP_DELAY_MS)

  /** After the take exists: wait for the recogniser to settle, attach the analysis, and log the attempt. */
  async function finishTake(t: Take) {
    const paceStarts = usesPacing(settings.highlight)
      ? [...timeline.starts]
      : null
    const times = [...hitTimes.current.times]
    for (
      let waited = 0;
      speechActive.current && waited < SPEECH_SETTLE_MS;
      waited += 100
    )
      await sleep(100)
    const heard = speechResult.current
    const stored: StoredAnalysis = {
      transcript: heard?.transcript ?? '',
      longPauseMs: heard?.longPauseMs ?? 0,
      hitTimes: times,
      paceStarts,
    }
    setTake((cur) => (cur?.id === t.id ? { ...cur, analysis: stored } : cur))
    setPending(false)
    const store = await openChunkStore().catch(() => null)
    void store?.update(t.id, { analysis: stored })
    if (!stored.transcript.trim()) return
    const result = await submit({
      twister: t.twister,
      kind: 'record',
      transcript: stored.transcript,
      durationMs: heard?.durationMs || t.durationMs,
      longPauseMs: stored.longPauseMs,
      confidence: heard?.confidence,
    })
    if (!result) return
    setXp(result.xp_awarded)
    setUnlocked(result.achievements_unlocked)
    if (result.id != null) {
      const attemptId = result.id
      setTake((cur) => (cur?.id === t.id ? { ...cur, attemptId } : cur))
      void store?.update(t.id, { attemptId })
    }
  }

  // Speech hits, stamped with the take clock, become the caption and marker timings.
  useEffect(() => {
    if (phase === 'recording' && hits.length) {
      const now = recorder.session?.elapsed()
      if (now != null) hitTimes.current.observe(hits, now)
    }
  }, [hits, phase, recorder.session])

  // Finished by speech (every word matched) or by the pace guide.
  useEffect(() => {
    if (
      !settings.autoStopOnFinish ||
      phase !== 'recording' ||
      !usesSpeech(settings.highlight)
    )
      return
    if (hits.length && hits.every(Boolean)) {
      const id = autoStop()
      return () => clearTimeout(id)
    }
  }, [hits, phase, settings.autoStopOnFinish, settings.highlight])

  // A failed step (for example not enough space) returns to setup: let go of the camera.
  useEffect(() => {
    if (phase === 'setup' && recorder.session) recorder.dispose()
  }, [phase, recorder])

  // One practice tab at a time.
  useEffect(() => {
    if (live) lock.claim()
    else lock.release()
    return () => lock.release()
  }, [live, lock])

  const leave = useLeaveGuard(() => LIVE.includes(recorder.state.phase))

  // ── Recovery of a take left on disk ──────────────────────────────────────────
  const [orphan, setOrphan] = useState<StoredMeta | null>(null)
  const [recovering, setRecovering] = useState(false)
  useEffect(() => {
    let alive = true
    void (async () => {
      const store = await openChunkStore()
      const now = Date.now()
      await store.purgeExpired(now)
      const found = (await store.list())
        .filter((m) => isRecoverable(m, owner, now))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (alive) setOrphan(found ?? null)
    })().catch(() => undefined)
    return () => {
      alive = false
    }
  }, [owner])

  const recover = async () => {
    if (!orphan) return
    setRecovering(true)
    try {
      const store = await openChunkStore()
      const assembled = await store.assemble(orphan.id)
      if (!assembled) {
        await store.remove(orphan.id)
        return setOrphan(null)
      }
      const t = await takeFromStored(
        orphan,
        assembled,
        orphan.status === 'recording',
      )
      track('record_recover', {})
      setTake(t)
      setPending(false)
      setOrphan(null)
      recorder.showReview()
    } finally {
      setRecovering(false)
    }
  }
  const dropOrphan = async () => {
    if (!orphan) return
    const store = await openChunkStore()
    await store.remove(orphan.id)
    setOrphan(null)
  }

  // ── Cloud: consent, upload, storage, share ──────────────────────────────────
  const access = saveAccess({
    flags,
    signedIn: !!session,
    ageBand: me?.age_band,
  })
  const consents = useConsents()
  const consentMut = useConsentMutation()
  const [wantUpload, setWantUpload] = useState(false)
  const uploads = useUploads({ load: wantUpload })
  const storage = useStorage(access === 'ok' && phase === 'review')
  const [consentOpen, setConsentOpen] = useState(false)
  const [saveReq, setSaveReq] = useState<string | null>(null)
  const [shareId, setShareId] = useState<string | null>(null)
  const job = take ? uploads.jobs.find((j) => j.id === take.id) : undefined

  useEffect(() => {
    const manager = uploads.manager
    if (saveReq == null || !take || !manager || !owner) return
    const title = saveReq
    setSaveReq(null)
    if (manager.has(take.id) && job?.status !== 'failed') return
    void (async () => {
      const thumbnail = await thumbnailFromBlob(
        take.blob,
        take.durationMs,
      ).catch(() => null)
      manager.enqueue({
        body: buildCreateBody(take, { title, attemptId: take.attemptId }),
        owner,
        thumbnail,
        blob: take.blob,
      })
      track('record_save_cloud', { size: take.blob.size, ms: take.durationMs })
    })()
  }, [saveReq, take, uploads.manager, owner, job?.status])

  const startSave = (title: string) => {
    setWantUpload(true)
    setSaveReq(title)
  }
  const [titleDraft, setTitleDraft] = useState('')
  const onSave = (title: string) => {
    if (access === 'ok' && consents.hasUploadConsent) return startSave(title)
    setTitleDraft(title)
    setConsentOpen(true)
  }
  const onConsent = async (age: 'under13' | '13plus' | null) => {
    try {
      await consentMut.mutateAsync({ age, version: CONSENT_VERSION })
    } catch {
      return
    }
    setConsentOpen(false)
    if (age !== 'under13') startSave(titleDraft)
  }

  // ── Review data ──────────────────────────────────────────────────────────────
  const sameTwister = take?.twister === twister.slug
  const analysis = useMemo(() => {
    if (!take || (pending && !take.analysis)) return null
    return analyseTake({
      text: take.twisterText,
      difficulty: sameTwister ? twister.difficulty : 2,
      focusSounds: sameTwister ? twister.focus_sounds : [],
      durationMs: take.durationMs,
      stored: take.analysis,
    })
  }, [take, pending, sameTwister, twister.difficulty, twister.focus_sounds])
  const hints = useMemo(
    () =>
      analysis?.scored && take?.analysis
        ? deliveryHints({
            wpm: analysis.wpm,
            targetWpm: wpm,
            longPauseMs: take.analysis.longPauseMs,
            transcript: take.analysis.transcript,
          })
        : null,
    [analysis, take?.analysis, wpm],
  )

  const discardTake = async () => {
    if (take) {
      const store = await openChunkStore().catch(() => null)
      void store?.remove(take.id)
    }
    setTake(null)
    recorder.backToSetup()
  }
  const recordAgain = () => {
    setTake(null)
    recorder.backToSetup()
    void recorder.open()
  }
  const onBubble = (bubble: BubbleState) => update({ bubble })

  // ── Render ───────────────────────────────────────────────────────────────────
  if (!caps.canRecord)
    return (
      <div role="alert" className="glass mx-auto max-w-md rounded-2xl p-6">
        <h2 className="font-display text-xl font-bold">
          Recording isn’t available here
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This browser can’t record video. Try a recent Chrome, Edge, Firefox or
          Safari, or use Read along.
        </p>
        <Button className="mt-4" onClick={onSwitchMode}>
          Back to practice
        </Button>
      </div>
    )

  const showStage = settings.layout === 'region' && phase !== 'review'
  const session_ = recorder.session

  return (
    <div>
      {orphan && phase === 'setup' && !take && (
        <RecoveryPrompt
          meta={orphan}
          busy={recovering}
          onRecover={() => void recover()}
          onDiscard={() => void dropOrphan()}
        />
      )}

      {showStage && (
        <RegionStage ref={regionRef} text={text} scale={settings.textScale} />
      )}

      {state.error && !recorder.openError && phase !== 'review' && (
        <div
          role="alert"
          className="mx-auto mb-4 max-w-xl rounded-2xl border border-pink/50 p-4 text-left text-sm"
        >
          <p className="font-semibold">{state.error.title}</p>
          <p className="mt-1 text-muted-foreground">{state.error.message}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={recorder.dismissError}
          >
            Dismiss
          </Button>
        </div>
      )}

      {(phase === 'setup' || phase === 'requesting') && (
        <RecordSetup
          twister={twister}
          settings={settings}
          update={update}
          caps={caps}
          limitMs={recordingMsMax}
          speechSupported={speech.supported}
          busy={phase === 'requesting'}
          locked={lock.blocked}
          openError={recorder.openError}
          onStart={(choices) => void recorder.open(choices)}
          onRetry={() => void recorder.open()}
          onSwitchMode={onSwitchMode}
          dismissError={recorder.dismissError}
        />
      )}

      {phase === 'preview' && session_ && (
        <>
          <RecordPreview
            session={session_}
            settings={settings}
            onBubble={onBubble}
            onRecord={() => void recorder.begin()}
            onBack={recorder.backToSetup}
            locked={lock.blocked}
            countdownActive={false}
          />
          {settings.layout !== 'region' && <LiveText text={text} />}
        </>
      )}

      {(phase === 'countdown' ||
        phase === 'recording' ||
        phase === 'paused' ||
        phase === 'finalizing') &&
        (session_ ? (
          <>
            <RecordingStage
              state={state}
              session={session_}
              settings={settings}
              lost={recorder.lost}
              screenStopped={recorder.screenStopped}
              busy={recorder.busy}
              announcement={recorder.announcement}
              onBubble={onBubble}
              onPause={() => recorder.pause()}
              onResume={() => void recorder.resume()}
              onStop={() => recorder.stop('user')}
              onRestart={() => void recorder.restart()}
              onDiscard={() => void recorder.discard()}
              onCancelCountdown={recorder.cancelCountdown}
              onContinueWithoutScreen={recorder.continueWithoutScreen}
            />
            {settings.layout !== 'region' && <LiveText text={text} />}
          </>
        ) : (
          <p role="status" className="py-16 text-center text-muted-foreground">
            Preparing your take…
          </p>
        ))}

      {phase === 'review' && take && (
        <RecordReview
          take={take}
          analysis={analysis}
          hints={hints}
          pending={pending}
          xp={xp}
          unlocked={unlocked}
          access={access}
          canShare={canShare({
            flags,
            signedIn: !!session,
            ageBand: me?.age_band,
          })}
          defaultTitle={defaultTitle(take.twister, take.startedAt)}
          job={job}
          quota={storage.data}
          onDownload={() => undefined}
          onSave={onSave}
          onRetryUpload={(id) => uploads.manager?.retry(id)}
          onShare={setShareId}
          onReRecord={recordAgain}
          onDiscard={() => void discardTake()}
          onScore={onSwitchMode}
          onNext={() => void nav.next()}
        />
      )}
      {phase === 'review' && !take && (
        <p className="py-16 text-center text-muted-foreground">
          That take is no longer available.
        </p>
      )}

      <ConsentDialog
        open={consentOpen}
        askAge={access === 'need_age'}
        busy={consentMut.isPending}
        failed={consentMut.isError}
        onConfirm={(age) => void onConsent(age)}
        onClose={() => setConsentOpen(false)}
      />
      {shareId && (
        <ShareDialog
          recordingId={shareId}
          open
          maxDays={shareMaxDays}
          onClose={() => setShareId(null)}
        />
      )}
      <LeaveConfirm
        open={leave.status === 'blocked'}
        onStay={() => leave.reset?.()}
        onLeave={() => leave.proceed?.()}
        title="Stop recording and leave?"
        body="What you have recorded so far stays on this device, and you can recover it next time you open Record."
        stayLabel="Keep recording"
      />
      {lock.blocked && !live && (
        <p role="status" className="mt-3 text-center text-sm text-pink">
          Practice is active in another tab — finish or pause it there first.
        </p>
      )}
    </div>
  )
}
