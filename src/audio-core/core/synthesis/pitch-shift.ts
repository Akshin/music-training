/**
 * The voice moved to another pitch, moment by moment — TD-PSOLA. The recording is cut into grains
 * one period of the voice apart, each two periods long and centred on the strongest peak of its
 * period; the grains are laid down again closer together to sing higher, further apart to sing
 * lower. A grain keeps the shape of the period it came from, so the voice keeps its timbre (its
 * formants) and only its pitch moves. Unvoiced stretches — consonants, breath, silence — pass
 * through as they are. Time is not changed: the output is as long as the input.
 *
 * The pitch the voice was sung at comes from the analysis frames, so no pitch is found here.
 */

/** What the voice was sung at and how far to move it, per analysis frame. */
export interface PitchShiftSpec {
  readonly sampleRate: number
  readonly frameRate: number
  /** Seconds from the first sample to frame 0 (negative when the frames begin earlier). */
  readonly frameStart: number
  /** The pitch sung, MIDI per frame; NaN where nothing is sung. */
  readonly pitch: ArrayLike<number>
  /** Semitones to move each frame by; NaN leaves it where it is. */
  readonly shift: ArrayLike<number>
}

/** Spacing of the grains through unvoiced stretches, seconds (grains twice as long). */
const UNVOICED_SECONDS = 0.005
/** A peak is looked for this share of a period either side of where the next period should begin. */
const PEAK_REACH = 0.2
/** Moves smaller than this are none, semitones. */
const NO_SHIFT = 0.005

const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/** `values` at fractional index `at`, linear between neighbours; NaN outside or next to NaN. */
function frameValue(values: ArrayLike<number>, at: number): number {
  if (!(at >= 0) || at > values.length - 1) return NaN
  const below = Math.floor(at)
  const a = values[below]
  if (below + 1 >= values.length) return a
  const b = values[below + 1]
  if (!Number.isFinite(a) || !Number.isFinite(b)) return at - below < 0.5 ? a : b
  return a + (b - a) * (at - below)
}

/** The index of the largest sample in `[from, to)`, within the signal. */
function peakIn(samples: Float32Array, from: number, to: number): number {
  const low = Math.max(0, Math.floor(from))
  const high = Math.min(samples.length, Math.ceil(to))
  let best = low
  for (let i = low + 1; i < high; i++) if (samples[i] > samples[best]) best = i
  return best
}

/** The voice in `samples` with every moment moved by the shift the frames give for it. */
export function shiftPitch(samples: Float32Array, spec: PitchShiftSpec): Float32Array {
  const { sampleRate, frameRate, frameStart } = spec
  const n = samples.length
  const frameAt = (sample: number) => (sample / sampleRate - frameStart) * frameRate
  const pitchAt = (sample: number) => frameValue(spec.pitch, frameAt(sample))
  const shiftAt = (sample: number) => {
    const value = frameValue(spec.shift, frameAt(sample))
    return Number.isFinite(value) ? value : 0
  }

  // Analysis marks: a period apart on the voice's peaks where it is voiced, evenly elsewhere.
  const unvoiced = Math.max(1, Math.round(UNVOICED_SECONDS * sampleRate))
  const marks: number[] = []
  const periods: number[] = []
  const voiced: boolean[] = []
  let at = 0
  let previousVoiced = false
  while (at < n) {
    const midi = pitchAt(at)
    if (!Number.isFinite(midi)) {
      marks.push(Math.round(at))
      periods.push(unvoiced)
      voiced.push(false)
      at += unvoiced
      previousVoiced = false
      continue
    }
    const period = sampleRate / midiToHz(midi)
    // Continuing a voiced stretch, the next period begins about a period on; starting one, the
    // first peak is anywhere within the first period.
    const mark = previousVoiced
      ? peakIn(samples, at - period * PEAK_REACH, at + period * PEAK_REACH + 1)
      : peakIn(samples, at, at + period)
    marks.push(mark)
    periods.push(period)
    voiced.push(true)
    at = Math.max(mark + 1, mark + period)
    previousVoiced = true
  }

  // Each grain reaches back to the mark before it and on to the mark after it, so that as they
  // were taken the grains add up to the voice exactly.
  const last = marks.length - 1
  const before = marks.map((mark, k) => (k > 0 ? Math.max(1, mark - marks[k - 1]) : periods[k]))
  const after = marks.map((mark, k) => (k < last ? Math.max(1, marks[k + 1] - mark) : periods[k]))

  // Synthesis: grains laid a moved period apart, each from the analysis mark nearest in time.
  const out = new Float32Array(n)
  if (marks.length === 0) return out
  let nearest = 0
  let place = marks[0]
  while (place < n) {
    while (
      nearest < last &&
      Math.abs(marks[nearest + 1] - place) <= Math.abs(marks[nearest] - place)
    ) {
      nearest++
    }
    const semitones = voiced[nearest] ? shiftAt(place) : 0
    const ratio = Math.abs(semitones) < NO_SHIFT ? 1 : 2 ** (semitones / 12)
    addGrain(
      out,
      samples,
      marks[nearest],
      Math.round(place),
      before[nearest],
      after[nearest],
      1 / ratio,
    )
    place += after[nearest] / ratio
  }
  return out
}

/**
 * The grain around `from` — back `left` samples, on `right` samples, each side a half Hann window
 * — added into `out` around `to`, scaled by `gain` so that grains laid closer together than they
 * were taken do not grow louder.
 */
function addGrain(
  out: Float32Array,
  samples: Float32Array,
  from: number,
  to: number,
  left: number,
  right: number,
  gain: number,
): void {
  const back = Math.max(1, Math.round(left))
  const on = Math.max(1, Math.round(right))
  for (let j = -back; j < on; j++) {
    const source = from + j
    const target = to + j
    if (source < 0 || source >= samples.length || target < 0 || target >= out.length) continue
    const window =
      j < 0
        ? 0.5 - 0.5 * Math.cos((Math.PI * (j + back)) / back)
        : 0.5 + 0.5 * Math.cos((Math.PI * j) / on)
    out[target] += samples[source] * window * gain
  }
}
