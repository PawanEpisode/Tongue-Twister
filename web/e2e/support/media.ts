import type { Page } from '@playwright/test'

/**
 * Browser-side probes, installed before the app loads.
 *
 * `window.__media` remembers every MediaStream the app obtained (camera, microphone, screen, and the
 * canvas / audio-graph streams Record mode builds) so a test can ask how many tracks are still live.
 * `window.__fakeSpeech` replaces the Web Speech API, which has no recogniser in headless Chromium.
 */
export async function installProbes(
  page: Page,
  opts: { speech?: string } = {},
) {
  await page.addInitScript((spoken: string) => {
    type W = Window & {
      __media: { streams: MediaStream[] }
      __fakeSpeech: { text: string; starts: number }
    }
    const w = window as unknown as W
    w.__media = { streams: [] }
    w.__fakeSpeech = { text: spoken, starts: 0 }
    const remember = (s: MediaStream) => {
      w.__media.streams.push(s)
      return s
    }

    const md = navigator.mediaDevices
    for (const name of ['getUserMedia', 'getDisplayMedia'] as const) {
      const original = md[name]?.bind(md)
      if (original)
        md[name] = async (c?: MediaStreamConstraints) =>
          remember(await original(c))
    }
    const capture = HTMLCanvasElement.prototype.captureStream
    HTMLCanvasElement.prototype.captureStream = function (...a) {
      return remember(capture.apply(this, a))
    }
    const dest = AudioContext.prototype.createMediaStreamDestination
    AudioContext.prototype.createMediaStreamDestination = function () {
      const node = dest.call(this)
      remember(node.stream)
      return node
    }

    // A recogniser that "hears" the configured sentence shortly after start() and ends on stop().
    class FakeRecognition {
      continuous = false
      interimResults = false
      lang = ''
      maxAlternatives = 1
      onaudiostart: (() => void) | null = null
      onspeechstart: (() => void) | null = null
      onresult: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      onend: (() => void) | null = null
      private timers: number[] = []
      start() {
        w.__fakeSpeech.starts++
        this.timers.push(
          window.setTimeout(() => this.onaudiostart?.(), 30),
          window.setTimeout(() => this.onspeechstart?.(), 60),
          window.setTimeout(() => {
            const text = w.__fakeSpeech.text
            if (text)
              this.onresult?.({
                results: [[{ transcript: text, confidence: 0.92 }]],
              })
          }, 200),
        )
      }
      stop() {
        this.timers.forEach(clearTimeout)
        window.setTimeout(() => this.onend?.(), 20)
      }
      abort() {
        this.stop()
      }
    }
    Object.assign(window, {
      SpeechRecognition: FakeRecognition,
      webkitSpeechRecognition: FakeRecognition,
    })
  }, opts.speech ?? '')
}

/** Tracks whose `readyState` is still `live`, across everything the app asked for. */
export const liveTrackCount = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __media: { streams: MediaStream[] } }
      ).__media.streams
        .flatMap((s) => s.getTracks())
        .filter((t) => t.readyState === 'live').length,
  )

/** How many streams the app has opened so far (proves a test really exercised the devices). */
export const streamCount = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __media: { streams: unknown[] } }).__media.streams
        .length,
  )
