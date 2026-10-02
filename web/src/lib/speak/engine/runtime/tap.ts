/** Binds the PCM tap to the bundled worklet file (Vite emits it as its own asset; no inline script, CSP-safe). */
import { startPcmTap } from './capture'
import type { PcmTap } from './capture'
import workletUrl from './pcm.worklet.ts?worker&url'

export const startTap = (
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  track?: MediaStreamTrack,
): Promise<PcmTap | null> => startPcmTap(ctx, source, workletUrl, track)
