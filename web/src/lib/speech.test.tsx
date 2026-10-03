// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isVoiceLevel,
  MAX_KICKS,
  noWordsMessage,
  rmsOf,
  STUCK_SILENCE_MS,
  useSpeech,
  VOICE_HANGOVER_MS,
  VOICE_MIN_RMS,
} from './speech'

class FakeRec {
  static all: FakeRec[] = []
  continuous = false
  maxAlternatives = 1
  aborted = false
  stopped = false
  onaudiostart: (() => void) | null = null
  onsoundstart: (() => void) | null = null
  onspeechstart: (() => void) | null = null
  onresult: ((e: any) => void) | null = null
  onerror: ((e: any) => void) | null = null
  onend: (() => void) | null = null
  constructor() {
    FakeRec.all.push(this)
  }
  start() {
    queueMicrotask(() => this.onaudiostart?.())
  }
  stop() {
    this.stopped = true
    queueMicrotask(() => this.onend?.())
  }
  abort() {
    this.aborted = true
    queueMicrotask(() => this.onend?.())
  }
  say(text: string, isFinal = false) {
    this.onresult?.({
      results: [
        Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal }),
      ],
    })
  }
  get last() {
    return FakeRec.all[FakeRec.all.length - 1]
  }
}

let micLevel = 0
const stream = {
  getTracks: () => [{ stop: vi.fn() }],
  getAudioTracks: () => [{}],
}
class FakeAudioContext {
  resume = async () => undefined
  close = async () => undefined
  createAnalyser() {
    return {
      fftSize: 512,
      frequencyBinCount: 256,
      smoothingTimeConstant: 0,
      getFloatTimeDomainData: (b: Float32Array) => b.fill(micLevel),
    }
  }
  createMediaStreamSource() {
    return { connect: () => undefined }
  }
}

const flush = () => act(async () => void (await Promise.resolve()))
const tick = (ms: number) =>
  act(async () => void (await vi.advanceTimersByTimeAsync(ms)))
const cur = () => FakeRec.all[FakeRec.all.length - 1]

beforeEach(() => {
  vi.useFakeTimers()
  FakeRec.all = []
  micLevel = 0
  ;(window as any).SpeechRecognition = FakeRec
  ;(window as any).AudioContext = FakeAudioContext
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  })
})
afterEach(() => {
  vi.useRealTimers()
})

async function startLive(opts: Parameters<typeof useSpeech>[0] = {}) {
  const hook = renderHook(() => useSpeech(opts))
  await flush()
  await act(async () => {
    await hook.result.current.start()
  })
  await tick(10)
  return hook
}

describe('voice helpers', () => {
  it('measures RMS', () => {
    expect(rmsOf([])).toBe(0)
    expect(rmsOf([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5)
  })
  it('needs a level clearly above the noise floor', () => {
    expect(isVoiceLevel(VOICE_MIN_RMS / 2, 0)).toBe(false)
    expect(isVoiceLevel(0.05, 0.001)).toBe(true)
    expect(isVoiceLevel(0.05, 0.03)).toBe(false) // noisy room: 0.05 < 0.03 × 2.5
  })
  it('explains an empty take', () => {
    expect(noWordsMessage(true)).toMatch(/heard you/)
    expect(noWordsMessage(false)).toMatch(/didn’t hear anything/)
  })
})

describe('useSpeech', () => {
  it('goes live and shows words as soon as the recogniser reports them', async () => {
    const { result } = await startLive()
    expect(result.current.status).toBe('live')
    expect(result.current.phase).toBe('listening')
    act(() => cur().say('sees'))
    expect(result.current.transcript).toBe('sees')
    expect(result.current.interim).toBe(true)
    expect(result.current.phase).toBe('heard')
    act(() => cur().say('sees', true))
    expect(result.current.interim).toBe(false)
  })

  it('says "hearing you" from the mic level even before any words arrive', async () => {
    const { result } = await startLive()
    micLevel = 0.002
    await tick(200) // quiet room: establishes the noise floor
    expect(result.current.phase).toBe('listening')
    micLevel = 0.2
    await tick(200)
    expect(result.current.phase).toBe('hearing')
    expect(result.current.voice).toBe(true)
    micLevel = 0.002
    await tick(VOICE_HANGOVER_MS + 200)
    expect(result.current.phase).toBe('processing')
  })

  // Quiet room, then a burst of voice, then quiet: the recogniser should have answered by now.
  const speakOnce = async () => {
    micLevel = 0.002
    await tick(120)
    micLevel = 0.2
    await tick(300)
    micLevel = 0.002
    await tick(STUCK_SILENCE_MS + 300)
  }

  it('restarts a recogniser that heard a voice, then silence, but produced no words', async () => {
    const { result } = await startLive()
    const first = cur()
    await speakOnce()
    expect(first.stopped).toBe(true) // asked politely first, so audio it did capture is not lost
    expect(FakeRec.all.length).toBe(2)
    expect(result.current.status).toBe('live')
  })

  it('aborts a recogniser that will not even stop', async () => {
    const { result } = await startLive()
    const first = cur()
    first.stop = () => {
      first.stopped = true // swallowed: no onend
    }
    await speakOnce()
    await tick(1200)
    expect(first.aborted).toBe(true)
    expect(FakeRec.all.length).toBe(2)
    expect(result.current.status).toBe('live')
  })

  it('ends the take with an explanation once restarts have not helped', async () => {
    const { result } = await startLive()
    for (let i = 0; i <= MAX_KICKS; i++) {
      micLevel = 0.2
      await tick(300)
      micLevel = 0.002
      await tick(STUCK_SILENCE_MS + 300)
    }
    await tick(2000)
    expect(FakeRec.all.length).toBe(1 + MAX_KICKS)
    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBe(noWordsMessage(true))
  })

  it('opens the meter stream without voice processing, which can deafen the recogniser', async () => {
    await startLive()
    const call = (navigator.mediaDevices.getUserMedia as any).mock.calls[0][0]
    expect(call.audio).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    })
  })

  it('keeps voice processing for the Accurate-mode tap', async () => {
    await startLive({ onAudio: () => undefined })
    const call = (navigator.mediaDevices.getUserMedia as any).mock.calls[0][0]
    expect(call.audio.echoCancellation).toBe(true)
  })

  it('offers every alternative the recogniser considered', async () => {
    const onFinish = vi.fn()
    const { result } = await startLive({
      continuous: false,
      alternatives: 5,
      onFinish,
    })
    expect(cur().maxAlternatives).toBe(5)
    act(() =>
      cur().onresult?.({
        results: [
          Object.assign(
            [
              { transcript: 'seats', confidence: 0.7 },
              { transcript: 'sees', confidence: 0.2 },
              { transcript: 'seeds', confidence: 0.1 },
            ],
            { isFinal: true },
          ),
        ],
      }),
    )
    expect(result.current.alternatives.map((a) => a.text)).toEqual([
      'seats',
      'sees',
      'seeds',
    ])
    await act(async () => cur().onend?.())
    expect(
      onFinish.mock.calls[0][0].alternatives.map((a: any) => a.text),
    ).toEqual(['seats', 'sees', 'seeds'])
  })

  it('tells the speaker when a take ends with no words', async () => {
    const { result } = await startLive()
    await act(async () => result.current.stop())
    await tick(10)
    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBe(noWordsMessage(false))
  })

  it('distinguishes "heard sound but no words" from silence', async () => {
    const { result } = await startLive()
    micLevel = 0.002
    await tick(120)
    micLevel = 0.2
    await tick(300)
    micLevel = 0.002
    await act(async () => result.current.stop())
    await tick(10)
    expect(result.current.error).toBe(noWordsMessage(true))
  })

  it('ignores the placeholder confidence of interim results', async () => {
    const onFinish = vi.fn()
    await startLive({ continuous: false, alternatives: 3, onFinish })
    const result = (conf: number, isFinal: boolean) => ({
      results: [
        Object.assign([{ transcript: 'sleep', confidence: conf }], { isFinal }),
      ],
    })
    // The word turns green on an interim result (Chrome reports ~0.01), and the take stops before a final one.
    act(() => cur().onresult?.(result(0.01, false)))
    await act(async () => cur().onend?.())
    expect(onFinish.mock.calls[0][0].confidence).toBeNull()
    expect(onFinish.mock.calls[0][0].alternatives[0].confidence).toBeNull()
  })

  it('keeps the real confidence of a final result', async () => {
    const onFinish = vi.fn()
    await startLive({ continuous: false, onFinish })
    act(() => cur().say('sleep', true))
    await act(async () => cur().onend?.())
    expect(onFinish.mock.calls[0][0].confidence).toBeCloseTo(0.9)
  })

  it('single-word mode finishes by itself when the browser ends the take', async () => {
    const onFinish = vi.fn()
    const { result } = await startLive({ continuous: false, onFinish })
    expect(cur().continuous).toBe(false)
    act(() => cur().say('sees', true))
    await act(async () => cur().onend?.())
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onFinish.mock.calls[0][0].transcript).toBe('sees')
    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBeNull()
  })

  it('single-word mode listens again if the browser ended with nothing', async () => {
    const onFinish = vi.fn()
    const { result } = await startLive({ continuous: false, onFinish })
    await tick(600) // lived long enough to be a real session
    await act(async () => cur().onend?.())
    expect(FakeRec.all.length).toBe(2)
    expect(onFinish).not.toHaveBeenCalled()
    expect(result.current.status).toBe('live')
  })

  it('gives up with a message when the recogniser dies instantly, repeatedly', async () => {
    const { result } = await startLive()
    for (let i = 0; i < 8 && result.current.status !== 'idle'; i++) {
      await act(async () => cur().onend?.())
      await tick(400)
    }
    expect(result.current.status).toBe('idle')
    expect(result.current.error).toMatch(/keeps stopping/)
  })

  it('stops on an unknown recogniser error instead of looping, and says which', async () => {
    const { result } = await startLive()
    await act(async () => {
      cur().onerror?.({ error: 'phrases-not-supported' })
      cur().onend?.()
    })
    await tick(10)
    expect(result.current.status).toBe('idle')
    expect(result.current.error).toMatch(/phrases-not-supported/)
    expect(FakeRec.all.length).toBe(1)
  })

  it('stops retrying and explains when the speech service is unreachable', async () => {
    const { result } = await startLive()
    await act(async () => {
      cur().onerror?.({ error: 'network' })
      cur().onend?.()
    })
    await tick(10)
    expect(result.current.status).toBe('idle')
    expect(result.current.error).toMatch(/unreachable/)
    expect(FakeRec.all.length).toBe(1)
  })
})
