/**
 * A block of mono PCM samples positioned on the session sample clock.
 *
 * Sources (microphone, line-in, file) deliver chunks of any length. `startSample` is the index of
 * `samples[0]` counted from the start of the session, which lets the analyser detect dropouts and
 * keep every derived value aligned to one clock.
 */
export interface AudioChunk {
  /** Mono samples in [-1, 1]. */
  readonly samples: Float32Array
  /** Position of `samples[0]` on the session sample clock. */
  readonly startSample: number
  readonly sampleRate: number
}

/** Seconds → samples on a clock with the given rate. */
export function secondsToSamples(seconds: number, sampleRate: number): number {
  return Math.round(seconds * sampleRate)
}

/** Samples → seconds on a clock with the given rate. */
export function samplesToSeconds(samples: number, sampleRate: number): number {
  return samples / sampleRate
}

/**
 * Splits a contiguous buffer into `AudioChunk`s the way a capture source would deliver them.
 * `startSample` is the session-clock index of `samples[0]` (0 for a file loaded from the start).
 */
export function chunkSamples(
  samples: Float32Array,
  chunkSize: number,
  sampleRate: number,
  startSample = 0,
): AudioChunk[] {
  if (chunkSize <= 0) throw new Error(`chunkSize must be positive, got ${chunkSize}`)
  const chunks: AudioChunk[] = []
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    chunks.push({
      samples: samples.slice(offset, Math.min(offset + chunkSize, samples.length)),
      startSample: startSample + offset,
      sampleRate,
    })
  }
  return chunks
}

/** How many analysis frames a buffer of `sampleCount` samples yields. */
export function frameCount(sampleCount: number, frameSize: number, hopSize: number): number {
  if (sampleCount < frameSize || hopSize <= 0) return 0
  return Math.floor((sampleCount - frameSize) / hopSize) + 1
}
