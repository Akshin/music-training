import { Timeline } from '@audio-core/core/index'

/**
 * A take as saved: its analysis frames and its voice — enough to look through it and listen to it
 * again after the page was closed. Times stay on the clock the take was recorded on.
 */
export interface SavedTake {
  readonly sampleRate: number
  readonly hopSize: number
  /** Sample position frame 0 refers to. */
  readonly originSample: number
  readonly columns: Readonly<Record<string, Float32Array>>
  /** The voice from sample `pcmStart` on, 16-bit. */
  readonly pcm: Int16Array
  readonly pcmStart: number
}

/** What a take is read from: the analysis worker that heard it, or a take saved earlier. */
export interface TakeStore {
  readonly timeline: Timeline
  readPcm(startSample: number, count: number): Promise<Float32Array>
  dispose(): void
}

/** Seconds of `store` from `from` to `to`, frames and voice, as a take to keep. */
export async function saveTake(store: TakeStore, from: number, to: number): Promise<SavedTake> {
  const { timeline } = store
  const { sampleRate, hopSize } = timeline
  const { start, end } = timeline.range(from, to)
  const columns: Record<string, Float32Array> = {}
  for (const name of timeline.columns) columns[name] = timeline.slice(name, start, end)
  const pcmStart = Math.max(0, Math.round(from * sampleRate))
  const voice = await store.readPcm(pcmStart, Math.max(0, Math.round(to * sampleRate) - pcmStart))
  const pcm = new Int16Array(voice.length)
  for (let i = 0; i < voice.length; i++) {
    pcm[i] = Math.round(Math.max(-1, Math.min(1, voice[i]!)) * 32767)
  }
  return {
    sampleRate,
    hopSize,
    originSample: timeline.originSample + start * hopSize,
    columns,
    pcm,
    pcmStart,
  }
}

/** A saved take read back as the analysis worker would serve it. */
export function openSavedTake(saved: SavedTake): TakeStore {
  const names = Object.keys(saved.columns)
  const timeline = new Timeline({
    sampleRate: saved.sampleRate,
    hopSize: saved.hopSize,
    originSample: saved.originSample,
    columns: names,
  })
  if (names.length > 0) {
    const count = Math.min(...names.map((name) => saved.columns[name]!.length))
    timeline.appendBatch(count, saved.columns)
  }
  return {
    timeline,
    async readPcm(startSample: number, count: number): Promise<Float32Array> {
      const out = new Float32Array(Math.max(0, count))
      const { pcm, pcmStart } = saved
      for (let i = Math.max(0, pcmStart - startSample); i < out.length; i++) {
        const at = startSample + i - pcmStart
        if (at >= pcm.length) break
        out[i] = pcm[at]! / 32767
      }
      return out
    },
    dispose() {},
  }
}
