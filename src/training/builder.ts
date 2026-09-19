/**
 * The training builder: a training is a run of bars filled with notes, plus the conditions to sing
 * them in — a tempo range, a loudness zone and the onset. Lengths are counted in sixteenths so every
 * meter, 6/8 included, fills with whole numbers.
 */
import type { BreathKind, BreathTarget } from '@/components/pitch/breath'
import type { PitchSegment, PitchTarget } from '@/components/pitch/trace'
import { BPM_DEFAULT, BPM_MAX, BPM_MIN, meterFor, secondsPerBeat } from '@/training/tempo'

/** How a note is sung: held plainly, hit with an attack, or glided into the next note. */
export type NoteKind = 'hold' | 'attack' | 'slide'

export interface NoteKindOption {
  readonly kind: NoteKind
  readonly label: string
  readonly hint: string
}

export const NOTE_KINDS: readonly NoteKindOption[] = [
  { kind: 'hold', label: 'Обычная', hint: 'Ровно держать высоту' },
  { kind: 'attack', label: 'Атака', hint: 'Точное быстрое вступление, дальше держать' },
  { kind: 'slide', label: 'Слайд', hint: 'Во второй половине скользнуть в следующую ноту' },
]

export interface NoteLengthOption {
  readonly sixteenths: number
  readonly label: string
}

export const NOTE_LENGTHS: readonly NoteLengthOption[] = [
  { sixteenths: 16, label: '1' },
  { sixteenths: 8, label: '1/2' },
  { sixteenths: 4, label: '1/4' },
  { sixteenths: 2, label: '1/8' },
  { sixteenths: 1, label: '1/16' },
]

export const NOTE_LENGTH_DEFAULT = 4

/** Octaves the note pad reaches, scientific: 4 is C4–B4. */
export const OCTAVE_MIN = 2
export const OCTAVE_MAX = 6
export const OCTAVE_DEFAULT = 4

/** Keyboard keys for C…B, laid out like a piano on the home row. */
export const PAD_KEYS = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j'] as const

/** The kind of vocal onset the training is sung with. */
export type Onset = 'breathy' | 'neutral' | 'hard' | 'thin'

export interface OnsetOption {
  readonly onset: Onset
  readonly label: string
  readonly hint: string
}

export const ONSETS: readonly OnsetOption[] = [
  { onset: 'breathy', label: 'С воздухом', hint: 'Придыхательная атака: воздух идёт раньше звука' },
  { onset: 'neutral', label: 'Нейтральный', hint: 'Мягкая атака: воздух и смыкание вместе' },
  { onset: 'hard', label: 'Жёсткий', hint: 'Твёрдая атака: связки сомкнуты до начала звука' },
  { onset: 'thin', label: 'Тонкий', hint: 'Тонкий смык: смыкаются только края связок' },
]

export const ONSET_DEFAULT: Onset = 'neutral'

export type LoudnessZone = 'soft' | 'good' | 'loud'

export interface LoudnessZoneOption {
  readonly zone: LoudnessZone
  readonly label: string
  /** Level range on the meter scale of `loudness.ts`: 0…1 over −60…0 dBFS. */
  readonly low: number
  readonly high: number
}

/** Zones follow the loudness colour stops, so each one is one colour on the meters. */
export const LOUDNESS_ZONES: readonly LoudnessZoneOption[] = [
  { zone: 'soft', label: 'Тихо', low: 0.35, high: 0.55 },
  { zone: 'good', label: 'Средне', low: 0.55, high: 0.78 },
  { zone: 'loud', label: 'Громко', low: 0.78, high: 0.92 },
]

export interface BpmRange {
  readonly min: number
  readonly max: number
}

export const BPM_RANGE_DEFAULT: BpmRange = { min: 60, max: 100 }

/** A sung note: its pitch and how it is sung. */
export interface NoteElement {
  readonly type: 'note'
  /** MIDI. */
  readonly midi: number
  readonly kind: NoteKind
  readonly sixteenths: number
}

/** Silence in the bar. */
export interface RestElement {
  readonly type: 'rest'
  readonly sixteenths: number
}

/** A breath in or out, with no pitch of its own. */
export interface BreathElement {
  readonly type: BreathKind
  readonly sixteenths: number
}

/** One element of a bar, each with a length: a note, a rest, an inhale or an exhale. */
export type BarElement = NoteElement | RestElement | BreathElement

export type ElementType = BarElement['type']

export function isNote(element: BarElement | undefined): element is NoteElement {
  return element?.type === 'note'
}

export function isBreath(element: BarElement | undefined): element is BreathElement {
  return element?.type === 'inhale' || element?.type === 'exhale'
}

/** The element's pitch; null for rests and breaths. */
export function pitchOf(element: BarElement | undefined): number | null {
  return isNote(element) ? element.midi : null
}

/** Names of the elements that have no pitch. */
export const ELEMENT_LABELS: Record<Exclude<ElementType, 'note'>, string> = {
  rest: 'Пауза',
  inhale: 'Вдох',
  exhale: 'Выдох',
}

/** What an element is called in lists: its note name, «Пауза», «Вдох» or «Выдох». */
export function elementLabel(element: BarElement, name: (midi: number) => string): string {
  return isNote(element) ? name(element.midi) : ELEMENT_LABELS[element.type]
}

export interface BuilderBar {
  readonly id: number
  readonly elements: readonly BarElement[]
}

/** Longest title and description a training keeps, characters. */
export const TITLE_MAX = 80
export const DESCRIPTION_MAX = 1000

export interface TrainingDraft {
  readonly title: string
  /** What to do and why, shown to whoever opens the training's link. */
  readonly description: string
  /** Tempos the singer may pick from; null leaves the tempo free. */
  readonly bpmRange: BpmRange | null
  /** Loudness to sing at; null leaves it free. */
  readonly loudness: LoudnessZone | null
  readonly beats: number
  readonly onset: Onset
  readonly bars: readonly BuilderBar[]
  /** Blocks of bars played more than once, by bar index; they never overlap. */
  readonly repeats: readonly Repeat[]
  /** The bar being filled. */
  readonly current: readonly BarElement[]
}

/** A reprise: bars `from`…`to` (indexes, inclusive) played `times` times in a row. */
export interface Repeat {
  readonly from: number
  readonly to: number
  readonly times: number
}

export const REPEAT_TIMES_MIN = 2
export const REPEAT_TIMES_MAX = 8

/** The reprise that bar `index` is in, if any. */
export function repeatAt(repeats: readonly Repeat[], index: number): Repeat | undefined {
  return repeats.find((repeat) => repeat.from <= index && index <= repeat.to)
}

/** Adds a reprise over bars `from`…`to` in either order; unchanged when it would overlap another. */
export function addRepeat(
  repeats: readonly Repeat[],
  from: number,
  to: number,
  times = REPEAT_TIMES_MIN,
): Repeat[] {
  const first = Math.min(from, to)
  const last = Math.max(from, to)
  if (repeats.some((repeat) => repeat.from <= last && first <= repeat.to)) return [...repeats]
  return [...repeats, { from: first, to: last, times }].sort((a, b) => a.from - b.from)
}

/** The reprises once bar `index` is removed: later ones shift back, one losing its only bar goes. */
export function withoutBar(repeats: readonly Repeat[], index: number): Repeat[] {
  return repeats
    .map((repeat) => {
      if (index < repeat.from) return { ...repeat, from: repeat.from - 1, to: repeat.to - 1 }
      if (index <= repeat.to) return { ...repeat, to: repeat.to - 1 }
      return repeat
    })
    .filter((repeat) => repeat.to >= repeat.from)
}

/** The bars in the order they are played, reprises unrolled. */
export function expandBars<T>(bars: readonly T[], repeats: readonly Repeat[]): T[] {
  const played: T[] = []
  for (let index = 0; index < bars.length; index++) {
    const repeat = repeats.find((candidate) => candidate.from === index)
    if (repeat === undefined) {
      played.push(bars[index]!)
      continue
    }
    const block = bars.slice(repeat.from, repeat.to + 1)
    for (let time = 0; time < repeat.times; time++) played.push(...block)
    index = repeat.to
  }
  return played
}

/** Reprises that fit `barCount` bars, with sane counts and no overlaps; the rest are dropped. */
function checkRepeats(value: unknown, barCount: number): Repeat[] {
  if (!Array.isArray(value)) return []
  let repeats: Repeat[] = []
  for (const item of value) {
    const raw = item as Partial<Record<keyof Repeat, unknown>> | null
    const { from, to, times } = raw ?? {}
    if (!Number.isInteger(from) || !Number.isInteger(to) || !Number.isInteger(times)) continue
    const [first, last, count] = [from as number, to as number, times as number]
    if (first < 0 || last < first || last >= barCount) continue
    const clamped = Math.min(REPEAT_TIMES_MAX, Math.max(REPEAT_TIMES_MIN, count))
    repeats = addRepeat(repeats, first, last, clamped)
  }
  return repeats
}

/** Sixteenths in a bar of the meter: 16 in 4/4, 12 in 6/8. */
export function barCapacity(beats: number): number {
  return beats * sixteenthsPerBeat(beats)
}

/** Sixteenths in one beat: 4 for a quarter beat, 2 for an eighth. */
export function sixteenthsPerBeat(beats: number): number {
  return 16 / meterFor(beats).beatUnit
}

export function barFill(elements: readonly BarElement[]): number {
  return elements.reduce((sum, element) => sum + element.sixteenths, 0)
}

/** Whether an element this long still fits in the bar. */
export function fits(elements: readonly BarElement[], sixteenths: number, beats: number): boolean {
  return barFill(elements) + sixteenths <= barCapacity(beats)
}

/** The longest listed length that fits in what is left of the bar; null when the bar is full. */
export function longestFitting(elements: readonly BarElement[], beats: number): number | null {
  const left = barCapacity(beats) - barFill(elements)
  return NOTE_LENGTHS.find((option) => option.sixteenths <= left)?.sixteenths ?? null
}

export function clampBpmRange(range: BpmRange): BpmRange {
  const clamp = (value: number) => Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(value)))
  const min = clamp(range.min)
  return { min, max: Math.max(min, clamp(range.max)) }
}

/** The tempo to preview a draft at: the middle of its range, or the app default. */
export function previewBpm(draft: Pick<TrainingDraft, 'bpmRange'>): number {
  const range = draft.bpmRange
  return range === null ? BPM_DEFAULT : Math.round((range.min + range.max) / 2)
}

/** Attack length of an `attack` note, seconds; the rest of the note is held. */
const ATTACK_SECONDS = 0.15

/** The note's shape on the pitch chart; `next` is the pitch it may slide into. */
export function noteSegments(
  note: NoteElement,
  seconds: number,
  next: number | null,
): PitchSegment[] {
  if (note.kind === 'attack') {
    const attack = Math.min(ATTACK_SECONDS, seconds)
    return seconds > attack
      ? [
          { kind: 'staccato', duration: attack },
          { kind: 'hold', duration: seconds - attack },
        ]
      : [{ kind: 'staccato', duration: attack }]
  }
  if (note.kind === 'slide' && next !== null && next !== note.midi) {
    return [
      { kind: 'hold', duration: seconds / 2 },
      { kind: 'slide', to: next, duration: seconds / 2 },
    ]
  }
  return [{ kind: 'hold', duration: seconds }]
}

/**
 * The bars as pitch-chart targets from time `start`, seconds, at `bpm`. A slide glides into the
 * next note only when that note follows straight after it; before a rest or at the end it is held.
 */
export function toTargets(
  bars: readonly (readonly BarElement[])[],
  beats: number,
  bpm: number,
  start = 0,
): PitchTarget[] {
  const perSixteenth = secondsPerBeat(bpm) / sixteenthsPerBeat(beats)
  const elements = bars.flat()
  const targets: PitchTarget[] = []
  let time = start
  elements.forEach((element, index) => {
    const seconds = element.sixteenths * perSixteenth
    if (isNote(element)) {
      const next = pitchOf(elements[index + 1])
      targets.push({
        midi: element.midi,
        start: time,
        segments: noteSegments(element, seconds, next),
      })
    }
    time += seconds
  })
  return targets
}

/** The last pitch among the elements; null when there is none. */
export function lastPitch(elements: readonly BarElement[]): number | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const midi = pitchOf(elements[i])
    if (midi !== null) return midi
  }
  return null
}

/**
 * The pitch a breath hangs from: an inhale gathers towards the note it leads into, an exhale
 * leaves from the note it follows; failing that, the note on the other side.
 */
export function breathAnchor(elements: readonly BarElement[], index: number): number | null {
  const after = pitchOf(elements.slice(index + 1).find(isNote))
  const before = lastPitch(elements.slice(0, index))
  return elements[index]?.type === 'inhale' ? (after ?? before) : (before ?? after)
}

/** The breaths of the bars on the chart's clock, from time `start`, seconds, at `bpm`. */
export function toBreaths(
  bars: readonly (readonly BarElement[])[],
  beats: number,
  bpm: number,
  start = 0,
): BreathTarget[] {
  const perSixteenth = secondsPerBeat(bpm) / sixteenthsPerBeat(beats)
  const elements = bars.flat()
  const breaths: BreathTarget[] = []
  let time = start
  elements.forEach((element, index) => {
    const duration = element.sixteenths * perSixteenth
    if (isBreath(element)) {
      breaths.push({
        kind: element.type,
        start: time,
        duration,
        midi: breathAnchor(elements, index),
      })
    }
    time += duration
  })
  return breaths
}

/** Length of the bars at `bpm`, seconds. */
export function barsSeconds(barCount: number, beats: number, bpm: number): number {
  return barCount * beats * secondsPerBeat(bpm)
}

/** Lowest and highest pitch sung, or null when there are no notes. */
export function pitchSpan(elements: readonly BarElement[]): { low: number; high: number } | null {
  const pitches = elements.filter(isNote).map((note) => note.midi)
  if (pitches.length === 0) return null
  return { low: Math.min(...pitches), high: Math.max(...pitches) }
}

export const EMPTY_DRAFT: TrainingDraft = {
  title: '',
  description: '',
  bpmRange: null,
  loudness: null,
  beats: 4,
  onset: ONSET_DEFAULT,
  bars: [],
  repeats: [],
  current: [],
}

/**
 * An element read back from storage or a link, or null when it is not one. Takes the current shape
 * (`type`) and the one before it: `midi` (null for a rest) with an optional `breath`.
 */
function parseElement(value: unknown): BarElement | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const sixteenths = NOTE_LENGTHS.find((option) => option.sixteenths === raw.sixteenths)?.sixteenths
  if (sixteenths === undefined) return null
  const type =
    typeof raw.type === 'string'
      ? raw.type
      : raw.breath === 'inhale' || raw.breath === 'exhale'
        ? raw.breath
        : typeof raw.midi === 'number'
          ? 'note'
          : 'rest'
  if (type === 'rest' || type === 'inhale' || type === 'exhale') return { type, sixteenths }
  if (type !== 'note' || typeof raw.midi !== 'number') return null
  const kind = NOTE_KINDS.find((option) => option.kind === raw.kind)?.kind ?? 'hold'
  return { type: 'note', midi: Math.round(raw.midi), kind, sixteenths }
}

/**
 * A draft read back from storage, or null when it is not one. Values out of range are pulled back
 * in; elements that no longer fit their bar are dropped, and so are bars left short.
 */
export function parseDraft(value: unknown): TrainingDraft | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const beats = typeof raw.beats === 'number' ? meterFor(raw.beats).beatsPerBar : 4
  const capacity = barCapacity(beats)
  const elementsOf = (list: unknown): BarElement[] => {
    if (!Array.isArray(list)) return []
    const elements: BarElement[] = []
    for (const item of list) {
      const element = parseElement(item)
      if (element === null || barFill(elements) + element.sixteenths > capacity) continue
      elements.push(element)
    }
    return elements
  }
  const bars = Array.isArray(raw.bars)
    ? raw.bars
        .map((bar, index) => {
          const stored = bar as Record<string, unknown> | null
          // Bars kept their elements under `notes` before rests and breaths joined them.
          return { id: index + 1, elements: elementsOf(stored?.elements ?? stored?.notes) }
        })
        .filter((bar) => barFill(bar.elements) === capacity)
    : []
  const range = raw.bpmRange as Record<string, unknown> | null | undefined
  return {
    title: typeof raw.title === 'string' ? raw.title.slice(0, TITLE_MAX) : '',
    description:
      typeof raw.description === 'string' ? raw.description.slice(0, DESCRIPTION_MAX) : '',
    bpmRange:
      range && typeof range.min === 'number' && typeof range.max === 'number'
        ? clampBpmRange({ min: range.min, max: range.max })
        : null,
    loudness: LOUDNESS_ZONES.find((option) => option.zone === raw.loudness)?.zone ?? null,
    beats,
    onset: ONSETS.find((option) => option.onset === raw.onset)?.onset ?? ONSET_DEFAULT,
    bars,
    repeats: checkRepeats(raw.repeats, bars.length),
    current: elementsOf(raw.current).filter(
      (_, index, elements) => barFill(elements.slice(0, index + 1)) < capacity,
    ),
  }
}
