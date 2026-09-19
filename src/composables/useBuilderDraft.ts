import { computed, ref, type Ref } from 'vue'
import {
  addRepeat,
  barCapacity,
  barFill,
  barsSeconds,
  expandBars,
  fits,
  lastPitch,
  pitchOf,
  pitchSpan,
  previewBpm,
  toBreaths,
  toTargets,
  withoutBar,
  REPEAT_TIMES_MAX,
  REPEAT_TIMES_MIN,
  type BarElement,
  type BpmRange,
  type BuilderBar,
  type LoudnessZone,
  type Onset,
  type Repeat,
  type TrainingDraft,
} from '@/training/builder'

/** Pitch range the bars are drawn in, MIDI. */
export interface PitchSpan {
  readonly low: number
  readonly high: number
}

/** The shortest range the bars are drawn in, semitones each side of its middle. */
const SPAN_HALF = 6

/**
 * A training being built: its settings, its full bars with their reprises, and the bar being
 * filled. Editing goes through the functions here, so the rules — elements fit their bar, a full
 * bar moves on, reprises follow the bars they cover — hold wherever the builder is used from.
 */
export function useBuilderDraft(initial: TrainingDraft) {
  const title = ref(initial.title)
  const description = ref(initial.description)
  const bpmRange = ref<BpmRange | null>(initial.bpmRange)
  const loudness = ref<LoudnessZone | null>(initial.loudness)
  const beats = ref(initial.beats)
  const onset = ref<Onset>(initial.onset)
  const bars = ref<BuilderBar[]>([...initial.bars])
  const repeats = ref<Repeat[]>([...initial.repeats])
  const current = ref<BarElement[]>([...initial.current])

  let nextBarId = bars.value.reduce((max, bar) => Math.max(max, bar.id), 0) + 1

  const draft = computed<TrainingDraft>(() => ({
    title: title.value,
    description: description.value,
    bpmRange: bpmRange.value,
    loudness: loudness.value,
    beats: beats.value,
    onset: onset.value,
    bars: bars.value,
    repeats: repeats.value,
    current: current.value,
  }))

  const hasElements = computed(() => bars.value.length > 0 || current.value.length > 0)
  /** The meter holds while there are elements: bars of different lengths would not line up. */
  const meterLocked = hasElements

  // ---- The bar being filled ----

  const filled = computed(() => barFill(current.value))
  const isFull = computed(() => filled.value === barCapacity(beats.value))

  function canAdd(sixteenths: number): boolean {
    return fits(current.value, sixteenths, beats.value)
  }

  /** Adds an element to the bar being filled; false when it does not fit. */
  function add(element: BarElement): boolean {
    if (!canAdd(element.sixteenths)) return false
    current.value = [...current.value, element]
    return true
  }

  function undo(): void {
    current.value = current.value.slice(0, -1)
  }

  /** Moves the full bar being filled to the end of the bars and starts a new one. */
  function seal(): BuilderBar {
    const bar: BuilderBar = { id: nextBarId++, elements: current.value }
    bars.value = [...bars.value, bar]
    current.value = []
    return bar
  }

  function removeBar(id: number): void {
    const index = bars.value.findIndex((bar) => bar.id === id)
    if (index < 0) return
    bars.value = bars.value.filter((bar) => bar.id !== id)
    repeats.value = withoutBar(repeats.value, index)
  }

  function clear(): void {
    bars.value = []
    repeats.value = []
    current.value = []
  }

  // ---- Reprises ----

  /** Whether bars `from`…`to` can become a reprise: they overlap none. */
  function repeatFits(from: number, to: number): boolean {
    return addRepeat(repeats.value, from, to).length > repeats.value.length
  }

  function makeRepeat(from: number, to: number): void {
    repeats.value = addRepeat(repeats.value, from, to)
  }

  function setRepeatTimes(repeat: Repeat, times: number): void {
    const clamped = Math.min(REPEAT_TIMES_MAX, Math.max(REPEAT_TIMES_MIN, times))
    repeats.value = repeats.value.map((item) =>
      item === repeat ? { ...item, times: clamped } : item,
    )
  }

  function removeRepeat(repeat: Repeat): void {
    repeats.value = repeats.value.filter((item) => item !== repeat)
  }

  // ---- What the bars add up to ----

  /** The tempo the builder previews at: the middle of the range, or the app default. */
  const bpm = computed(() => previewBpm(draft.value))
  /** The full bars in the order they are sung, reprises unrolled. */
  const playedBars = computed(() =>
    expandBars(
      bars.value.map((bar) => bar.elements),
      repeats.value,
    ),
  )
  const playedSeconds = computed(() => barsSeconds(playedBars.value.length, beats.value, bpm.value))
  /** Everything sung so far, the bar being filled included, as the pitch chart shows it. */
  const preview = computed(() => {
    const sung = [...playedBars.value, current.value]
    return {
      targets: toTargets(sung, beats.value, bpm.value),
      breaths: toBreaths(sung, beats.value, bpm.value),
      /** At least a second, so an empty chart still has a scale. */
      seconds: Math.max(
        1,
        barsSeconds(sung.length - (current.value.length > 0 ? 0 : 1), beats.value, bpm.value),
      ),
    }
  })

  /** One range for every bar, so bars compare at a glance: at least an octave around `middle`. */
  function spanAround(middle: Readonly<Ref<number>>) {
    return computed<PitchSpan>(() => {
      const found = pitchSpan([...bars.value.flatMap((bar) => bar.elements), ...current.value])
      const centre = found ? Math.round((found.low + found.high) / 2) : middle.value
      return {
        low: Math.min(found?.low ?? centre, centre - SPAN_HALF) - 1,
        high: Math.max(found?.high ?? centre, centre + SPAN_HALF) + 1,
      }
    })
  }

  /** The first pitch after bar `index` (a slide at its end glides into it). */
  function pitchAfter(index: number): number | null {
    const later = [...bars.value.slice(index + 1).flatMap((bar) => bar.elements), ...current.value]
    return pitchOf(later[0])
  }

  /** The last pitch before bar `index`; `bars.length` stands for the bar being filled. */
  function pitchBefore(index: number): number | null {
    return lastPitch(bars.value.slice(0, index).flatMap((bar) => bar.elements))
  }

  return {
    title,
    description,
    bpmRange,
    loudness,
    beats,
    onset,
    bars,
    repeats,
    current,
    draft,
    hasElements,
    meterLocked,
    filled,
    isFull,
    canAdd,
    add,
    undo,
    seal,
    removeBar,
    clear,
    repeatFits,
    makeRepeat,
    setRepeatTimes,
    removeRepeat,
    bpm,
    playedBars,
    playedSeconds,
    preview,
    spanAround,
    pitchAfter,
    pitchBefore,
  }
}

export type BuilderDraft = ReturnType<typeof useBuilderDraft>
