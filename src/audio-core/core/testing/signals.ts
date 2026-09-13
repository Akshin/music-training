/**
 * Deterministic test signals with known ground truth.
 *
 * Nothing here is shipped with the analyser; tests import it by path. Every generator that varies
 * in time returns `frequencyAt(t)` so a tracker can be compared against the exact instantaneous
 * value at each frame's centre time.
 */

import { chunkSamples, type AudioChunk } from '../model/audio'
import { resonatorBiquad } from '../dsp/biquad'

export const TEST_SAMPLE_RATE = 48000

export interface GeneratedSignal {
  readonly samples: Float32Array
  readonly sampleRate: number
  /** Exact instantaneous fundamental at time `t` (seconds). */
  frequencyAt(t: number): number
}

export interface SineOptions {
  readonly frequency: number
  readonly seconds: number
  readonly sampleRate?: number
  /** Peak amplitude. Default 0.5. */
  readonly amplitude?: number
  /** Initial phase in radians. Default 0. */
  readonly phase?: number
}

export function sine(options: SineOptions): GeneratedSignal {
  const sampleRate = options.sampleRate ?? TEST_SAMPLE_RATE
  const amplitude = options.amplitude ?? 0.5
  const phase = options.phase ?? 0
  const { frequency } = options
  const samples = new Float32Array(Math.round(options.seconds * sampleRate))
  const step = (2 * Math.PI * frequency) / sampleRate
  for (let i = 0; i < samples.length; i++) samples[i] = amplitude * Math.sin(phase + step * i)
  return { samples, sampleRate, frequencyAt: () => frequency }
}

export interface Vibrato {
  /** Modulation rate, Hz. */
  readonly rate: number
  /** Peak deviation from the centre pitch, cents (the excursion is ±extentCents). */
  readonly extentCents: number
}

export interface HarmonicToneOptions {
  readonly f0: number
  readonly seconds: number
  readonly sampleRate?: number
  /** Peak amplitude after normalisation. Default 0.5. */
  readonly amplitude?: number
  /** Number of partials including the fundamental. Default 8. */
  readonly harmonics?: number
  /** Partial k has relative amplitude 1 / k^rolloff. Default 1. Ignored when `partials` is set. */
  readonly rolloff?: number
  /** Explicit relative amplitudes of partials 1..n; overrides `harmonics`/`rolloff`. */
  readonly partials?: readonly number[]
  readonly vibrato?: Vibrato
}

/** Harmonic complex with optional sinusoidal vibrato, phase-continuous. */
export function harmonicTone(options: HarmonicToneOptions): GeneratedSignal {
  const sampleRate = options.sampleRate ?? TEST_SAMPLE_RATE
  const amplitude = options.amplitude ?? 0.5
  const partials =
    options.partials ??
    Array.from({ length: options.harmonics ?? 8 }, (_, k) => 1 / (k + 1) ** (options.rolloff ?? 1))
  const { f0, vibrato } = options
  const frequencyAt = (t: number): number =>
    vibrato === undefined
      ? f0
      : f0 * 2 ** ((vibrato.extentCents * Math.sin(2 * Math.PI * vibrato.rate * t)) / 1200)

  const samples = new Float32Array(Math.round(options.seconds * sampleRate))
  let phase = 0
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    let value = 0
    for (let k = 0; k < partials.length; k++) {
      value += partials[k] * Math.sin(2 * Math.PI * (k + 1) * phase)
    }
    samples[i] = value
    const magnitude = Math.abs(value)
    if (magnitude > peak) peak = magnitude
    phase += frequencyAt(i / sampleRate) / sampleRate
  }
  if (peak > 0) {
    const scale = amplitude / peak
    for (let i = 0; i < samples.length; i++) samples[i] *= scale
  }
  return { samples, sampleRate, frequencyAt }
}

export interface FormantSpec {
  readonly hz: number
  readonly bw: number
}

export interface FormantToneOptions {
  readonly f0: number
  readonly formants: readonly FormantSpec[]
  readonly seconds: number
  readonly sampleRate?: number
  readonly amplitude?: number
}

/**
 * Impulse train through a cascade of two-pole resonators — a Klatt-style vowel with known F1…Fn.
 */
export function formantTone(options: FormantToneOptions): GeneratedSignal {
  const sampleRate = options.sampleRate ?? TEST_SAMPLE_RATE
  const amplitude = options.amplitude ?? 0.5
  const { f0, formants, seconds } = options
  const filters = formants.map((spec) => resonatorBiquad(spec.hz, spec.bw, sampleRate))
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  let phase = 0
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    phase += f0 / sampleRate
    let value = 0
    if (phase >= 1) {
      value = 1
      phase -= 1
    }
    for (let k = 0; k < filters.length; k++) value = filters[k].processSample(value)
    samples[i] = value
    const magnitude = Math.abs(value)
    if (magnitude > peak) peak = magnitude
  }
  if (peak > 0) {
    const scale = amplitude / peak
    for (let i = 0; i < samples.length; i++) samples[i] *= scale
  }
  return { samples, sampleRate, frequencyAt: () => f0 }
}

export interface SweepOptions {
  readonly startHz: number
  readonly endHz: number
  readonly seconds: number
  readonly sampleRate?: number
  readonly amplitude?: number
}

/** Exponential (constant cents-per-second) sine sweep. */
export function sweep(options: SweepOptions): GeneratedSignal {
  const sampleRate = options.sampleRate ?? TEST_SAMPLE_RATE
  const amplitude = options.amplitude ?? 0.5
  const { startHz, endHz, seconds } = options
  const ratio = endHz / startHz
  const frequencyAt = (t: number): number => startHz * ratio ** (t / seconds)
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  let phase = 0
  for (let i = 0; i < samples.length; i++) {
    samples[i] = amplitude * Math.sin(2 * Math.PI * phase)
    phase += frequencyAt(i / sampleRate) / sampleRate
  }
  return { samples, sampleRate, frequencyAt }
}

export interface NoiseOptions {
  readonly seconds: number
  readonly sampleRate?: number
  /** Peak amplitude of the uniform noise. Default 0.5. */
  readonly amplitude?: number
  readonly seed?: number
}

/** Uniform white noise from a seeded PRNG (mulberry32), reproducible across runs. */
export function whiteNoise(options: NoiseOptions): Float32Array {
  const sampleRate = options.sampleRate ?? TEST_SAMPLE_RATE
  const amplitude = options.amplitude ?? 0.5
  const random = mulberry32(options.seed ?? 1)
  const samples = new Float32Array(Math.round(options.seconds * sampleRate))
  for (let i = 0; i < samples.length; i++) samples[i] = amplitude * (random() * 2 - 1)
  return samples
}

export function silence(seconds: number, sampleRate = TEST_SAMPLE_RATE): Float32Array {
  return new Float32Array(Math.round(seconds * sampleRate))
}

/** Linear fade-in and fade-out over `fadeSamples`, in place. */
export function fade(samples: Float32Array, fadeSamples: number): Float32Array {
  const n = Math.min(fadeSamples, Math.floor(samples.length / 2))
  for (let i = 0; i < n; i++) {
    const gain = i / n
    samples[i] *= gain
    samples[samples.length - 1 - i] *= gain
  }
  return samples
}

export interface NoteEventSpec {
  readonly kind: 'note'
  readonly midi: number
  readonly seconds: number
  readonly vibrato?: Vibrato
}

export interface PauseEventSpec {
  readonly kind: 'pause'
  readonly seconds: number
}

export interface SlideEventSpec {
  readonly kind: 'slide'
  readonly fromMidi: number
  readonly toMidi: number
  readonly seconds: number
}

export type SequenceEventSpec = NoteEventSpec | PauseEventSpec | SlideEventSpec

/** A sequence event with its resolved time span, seconds. */
export type TimedSequenceEvent = SequenceEventSpec & {
  readonly start: number
  readonly end: number
}

export interface NoteSequenceOptions {
  readonly sampleRate?: number
  /** Peak amplitude. Default 0.5. */
  readonly amplitude?: number
  /** Partials with 1/k rolloff. Default 6. */
  readonly harmonics?: number
  /** Amplitude ramp at the edges of a sound between pauses, ms. Default 15. */
  readonly edgeMs?: number
}

export interface NoteSequence extends GeneratedSignal {
  readonly events: readonly TimedSequenceEvent[]
  readonly seconds: number
}

/** Shorthand constructors for `noteSequence` events. */
export const seq = {
  note: (midi: number, seconds: number, vibrato?: Vibrato): NoteEventSpec =>
    vibrato === undefined
      ? { kind: 'note', midi, seconds }
      : { kind: 'note', midi, seconds, vibrato },
  pause: (seconds: number): PauseEventSpec => ({ kind: 'pause', seconds }),
  slide: (fromMidi: number, toMidi: number, seconds: number): SlideEventSpec => ({
    kind: 'slide',
    fromMidi,
    toMidi,
    seconds,
  }),
}

/**
 * A vocal-exercise-like phrase: notes, pauses and slides rendered phase-continuously as one
 * harmonic tone, so legato joins have no click and no level dip. Sounds adjacent to a pause ramp
 * in and out over `edgeMs`. Ground truth: `events` with exact boundaries and `frequencyAt`.
 */
export function noteSequence(
  specs: readonly SequenceEventSpec[],
  options: NoteSequenceOptions = {},
): NoteSequence {
  const sampleRate = options.sampleRate ?? TEST_SAMPLE_RATE
  const amplitude = options.amplitude ?? 0.5
  const harmonics = options.harmonics ?? 6
  const edge = ((options.edgeMs ?? 15) / 1000) * sampleRate

  const events: TimedSequenceEvent[] = []
  let cursor = 0
  for (const spec of specs) {
    events.push({ ...spec, start: cursor, end: cursor + spec.seconds })
    cursor += spec.seconds
  }
  const seconds = cursor

  const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
  const frequencyOf = (event: TimedSequenceEvent, t: number): number => {
    switch (event.kind) {
      case 'pause':
        return NaN
      case 'note': {
        const { vibrato } = event
        if (vibrato === undefined) return midiToHz(event.midi)
        const local = t - event.start
        return midiToHz(
          event.midi + (vibrato.extentCents / 100) * Math.sin(2 * Math.PI * vibrato.rate * local),
        )
      }
      case 'slide': {
        const progress = (t - event.start) / event.seconds
        return midiToHz(event.fromMidi + (event.toMidi - event.fromMidi) * progress)
      }
    }
  }
  const eventAt = (t: number): TimedSequenceEvent | undefined => {
    for (const event of events) if (t >= event.start && t < event.end) return event
    return undefined
  }
  const frequencyAt = (t: number): number => {
    const event = eventAt(t)
    return event === undefined ? NaN : frequencyOf(event, t)
  }

  const partials = Array.from({ length: harmonics }, (_, k) => 1 / (k + 1))
  const partialSum = partials.reduce((sum, p) => sum + p, 0)
  const scale = amplitude / partialSum
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  let phase = 0
  let index = 0
  for (const event of events) {
    const startSample = Math.round(event.start * sampleRate)
    const endSample = Math.round(event.end * sampleRate)
    const previous = events[events.indexOf(event) - 1]
    const next = events[events.indexOf(event) + 1]
    const rampIn = event.kind !== 'pause' && (previous === undefined || previous.kind === 'pause')
    const rampOut = event.kind !== 'pause' && (next === undefined || next.kind === 'pause')
    for (index = startSample; index < endSample && index < samples.length; index++) {
      if (event.kind === 'pause') {
        samples[index] = 0
        continue
      }
      const t = index / sampleRate
      const hz = frequencyOf(event, t)
      phase += hz / sampleRate
      let value = 0
      for (let k = 0; k < partials.length; k++) {
        value += partials[k] * Math.sin(2 * Math.PI * (k + 1) * phase)
      }
      let gain = scale
      if (rampIn && index - startSample < edge) gain *= (index - startSample) / edge
      if (rampOut && endSample - 1 - index < edge) gain *= (endSample - 1 - index) / edge
      samples[index] = value * gain
    }
  }
  return { samples, sampleRate, frequencyAt, events, seconds }
}

export function concat(...parts: readonly Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** `a + gain · b`, truncated to the shorter input. */
export function mix(a: Float32Array, b: Float32Array, gain = 1): Float32Array {
  const length = Math.min(a.length, b.length)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = a[i] + gain * b[i]
  return out
}

/** Splits a signal into contiguous chunks, as a capture source would deliver it. */
export function toChunks(
  samples: Float32Array,
  chunkSize: number,
  sampleRate = TEST_SAMPLE_RATE,
): AudioChunk[] {
  return chunkSamples(samples, chunkSize, sampleRate)
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
