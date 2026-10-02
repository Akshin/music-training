<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PhArrowRight } from '@phosphor-icons/vue'
import { loudnessColorTable } from '@/components/loudness'
import type { CurveEditor, LineTool } from '@/composables/useCurveEditor'
import { LINE_TOOLS, type NoteEditor } from '@/composables/useNoteEditor'
import { snapSeconds, type Onset, type Release } from '@/training/architect'
import type { LoosePiece } from '@/training/curve'
import { VIBRATO_MAX, shapeOf, snapBeat, type EditNote } from '@/training/noteEdit'
import { noteName } from '@/training/keys'

/** A recorded take the chart reads from; every call reads what is there now. */
export interface TakeSource {
  /** Frames so far. */
  length(): number
  frameRate(): number
  /** Trace-clock seconds of frame `index`. */
  timeOf(index: number): number
  /** Pitch (NaN where nothing is sung) and loudness (0…1) of frames `[begin, end)`. */
  read(begin: number, end: number, midi: Float32Array, level: Float32Array): void
  /**
   * Where frame 0 is in the recording underneath, for a source that shows a moving part of it;
   * when it moves, what was summed up of the frames is summed up again.
   */
  origin?(): number
}

/** The metronome's beats on the trace clock. */
export interface TakeGrid {
  /** Trace-clock seconds of beat 0. */
  readonly origin: number
  readonly beatSeconds: number
  readonly beatsPerBar: number
}

/** A note drawn as an empty box to sing into, trace-clock seconds. */
export interface TakeNote {
  readonly midi: number
  readonly start: number
  readonly end: number
  readonly onset?: Onset
  readonly release?: Release
  readonly vibrato?: boolean
}

const props = withDefaults(
  defineProps<{
    source: TakeSource
    /** Frames are still coming in; while live, the chart follows them. */
    recording: boolean
    /** The take is being played; the chart turns its pages after the cursor. */
    playing: boolean
    grid?: TakeGrid | null
    notes?: readonly TakeNote[]
    /** The piece being turned into notes, shaded. */
    region?: { readonly from: number; readonly to: number } | null
    /** The note editor; its notes are drawn instead of `notes` while `editing`. */
    editor?: NoteEditor | null
    /** Mouse on a note moves it, on its edge stretches it; a double click draws a new one. */
    editing?: boolean
    /** The pitch line being edited: drawn over the voice, and what the line tools draw on. */
    curve?: CurveEditor | null
    /** When the microphone opens, go once to the first note sung: an octave around it. */
    autoZoom?: boolean
    /** While live, a note held outside the view brings the view to it (with `autoZoom`). */
    followPitch?: boolean
    /** The take within everything heard: marked, the rest dimmed; `to` is null while recording. */
    takeRange?: { readonly from: number; readonly to: number | null } | null
    /** The loop repeats while playing; off, its brace is drawn faint. */
    looping?: boolean
    /** Share of the window right of now while live: notes to come have room there. */
    ahead?: number
    label?: string
  }>(),
  {
    grid: null,
    notes: () => [],
    region: null,
    editor: null,
    editing: false,
    curve: null,
    autoZoom: false,
    followPitch: false,
    takeRange: null,
    looping: false,
    ahead: 0.3,
    label: 'Запись: высота голоса во времени',
  },
)

/** The cursor, trace-clock seconds; a tap on the chart puts it there. */
const playhead = defineModel<number | null>('playhead', { default: null })
/** The loop, trace-clock seconds: a brace on the ruler, moved and stretched there. */
const loopRange = defineModel<{ from: number; to: number } | null>('loopRange', { default: null })
/** A stretch of time chosen by dragging along the ruler. */
const selection = defineModel<{ from: number; to: number } | null>('selection', { default: null })

/** Width of the note names on the left, px, and room for the head of the band on the right. */
const GUTTER = 40
const HEAD_ROOM = 10
/**
 * The ruler along the top, px: the loop's brace in its upper strip, `BRACE` high, and the bars
 * below it, where a drag chooses a stretch of time.
 */
const RULER = 24
const BRACE = 9
/** Notes the chart may show: C2…C6. */
const P_MIN = 36
const P_MAX = 84
const SPAN_MIN = 1.5
const RANGE_MIN = 5
const RANGE_MAX = P_MAX - P_MIN + 1
/** Frames per overview bucket. */
const BUCKET = 10
/** Consecutive frames further apart than this are a jump, not a slide. */
const MAX_JOIN_SEMITONES = 2
const BLACK_KEYS = new Set([1, 3, 6, 8, 10])
/** Two taps closer than this are a double tap, ms. */
const DOUBLE_TAP_MS = 320
/** A note sung this close to its semitone is in tune, this close near it, semitones. */
const DEVIATION_GOOD = 0.15
const DEVIATION_FAIR = 0.35
/** Pixels of dragging a note's handle that take its shape from 0 to 100%. */
const HANDLE_PIXELS = 80

const pitchClass = (note: number) => ((note % 12) + 12) % 12
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

interface Surface {
  el: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  w: number
  h: number
}

const rollEl = ref<HTMLCanvasElement | null>(null)
const miniEl = ref<HTMLCanvasElement | null>(null)
const keysEl = ref<HTMLCanvasElement | null>(null)
const root = ref<HTMLDivElement | null>(null)

/** Following the newest frames, as opposed to looking through the take. */
const follow = ref(true)
/** The window: right edge and length in seconds, and the notes at its edges (lane edges). */
const view = { t1: 0, span: 10, lo: 47.5, hi: 72.5 }
let dpr = 1
let frames = 0
let rate = 100
/** Trace-clock seconds of frame 0 and of the newest frame. */
let t0 = 0
let end = 0

const palette = {
  ink: '#eceae4',
  muted: '#9aa0a8',
  accent: '#d4b84a',
  bg: '#15181d',
  good: '#4f9a62',
  fair: '#d9a441',
  bad: '#c8553d',
  font: 'sans-serif',
}
let loudness: string[] = []

function readPalette(): void {
  const element = root.value
  if (element === null) return
  const style = getComputedStyle(element)
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  palette.ink = pick('--ink', palette.ink)
  palette.muted = pick('--muted', palette.muted)
  palette.accent = pick('--accent', palette.accent)
  palette.bg = pick('--bg', palette.bg)
  palette.good = pick('--loudness-good', palette.good)
  palette.fair = pick('--loudness-loud', palette.fair)
  palette.bad = pick('--danger', palette.bad)
  palette.font = pick('--font', palette.font)
  loudness = loudnessColorTable((token) => style.getPropertyValue(token))
}

const loudnessColor = (level: number) =>
  loudness[Math.round(clamp(Number.isFinite(level) ? level : 0, 0, 1) * (loudness.length - 1))] ??
  palette.muted

/** How far a note was sung off its semitone, in semitones, as a colour: in tune, near, off. */
const deviationColor = (off: number) =>
  off <= DEVIATION_GOOD ? palette.good : off <= DEVIATION_FAIR ? palette.fair : palette.bad

// ---- Reading the take: the visible frames on demand, the whole take as an overview ----

let drawMidi = new Float32Array(4096)
let drawLevel = new Float32Array(4096)
const chunkMidi = new Float32Array(4096)
const chunkLevel = new Float32Array(4096)
let bucketMin = new Float32Array(1024).fill(Infinity)
let bucketMax = new Float32Array(1024).fill(-Infinity)
let bucketLevel = new Float32Array(1024)
const noteTime = new Float32Array(128)
let summarized = 0
/** The source's frame 0 when it was last summed up. */
let summaryOrigin = 0
let takeLow = Infinity
let takeHigh = -Infinity

const indexOf = (seconds: number) => (seconds - t0) * rate
const timeOfIndex = (index: number) => t0 + index / rate

function resetSummary(): void {
  summarized = 0
  bucketMin.fill(Infinity)
  bucketMax.fill(-Infinity)
  bucketLevel.fill(0)
  noteTime.fill(0)
  takeLow = Infinity
  takeHigh = -Infinity
}

function growBuckets(count: number): void {
  if (bucketMin.length >= count) return
  const size = Math.max(count, bucketMin.length * 2)
  const grow = (old: Float32Array, fill: number) => {
    const next = new Float32Array(size).fill(fill)
    next.set(old)
    return next
  }
  bucketMin = grow(bucketMin, Infinity)
  bucketMax = grow(bucketMax, -Infinity)
  bucketLevel = grow(bucketLevel, 0)
}

/** Folds the frames that arrived since the last call into the overview and the note histogram. */
function summarize(): void {
  const origin = props.source.origin?.() ?? 0
  if (frames < summarized || origin !== summaryOrigin) resetSummary()
  summaryOrigin = origin
  for (let from = summarized; from < frames; from += chunkMidi.length) {
    const to = Math.min(frames, from + chunkMidi.length)
    props.source.read(from, to, chunkMidi, chunkLevel)
    growBuckets(Math.ceil(to / BUCKET))
    for (let i = from; i < to; i++) {
      const midi = chunkMidi[i - from] ?? NaN
      const level = chunkLevel[i - from] ?? 0
      const bucket = Math.floor(i / BUCKET)
      if (Number.isFinite(midi)) {
        if (midi < bucketMin[bucket]!) bucketMin[bucket] = midi
        if (midi > bucketMax[bucket]!) bucketMax[bucket] = midi
        const note = Math.round(midi)
        if (note >= 0 && note < 128) noteTime[note]! += 1
        takeLow = Math.min(takeLow, midi)
        takeHigh = Math.max(takeHigh, midi)
      }
      if (level > bucketLevel[bucket]!) bucketLevel[bucket] = level
    }
  }
  summarized = frames
}

/** Frames `[begin, end)` into the drawing buffers. */
function readVisible(begin: number, stop: number): void {
  const count = Math.max(0, stop - begin)
  if (drawMidi.length < count) {
    drawMidi = new Float32Array(count * 2)
    drawLevel = new Float32Array(count * 2)
  }
  drawMidi.fill(NaN, 0, count)
  props.source.read(begin, stop, drawMidi, drawLevel)
}

// ---- The window ----

const liveRight = () => end + props.ahead * view.span
/** The latest moment worth looking at: the newest frame with room ahead, or the last note given. */
const rightmost = () => Math.max(liveRight(), ...props.notes.map((note) => note.end + 0.5))
const spanMax = () => Math.max(20, (end - t0) * 1.1 + 10)
const plotWidth = () => roll.w - GUTTER - HEAD_ROOM

function clampView(): void {
  // A window broken by a chart with no size yet starts over rather than staying broken.
  if (!Number.isFinite(view.lo) || !Number.isFinite(view.hi)) {
    view.lo = 47.5
    view.hi = 72.5
  }
  if (!Number.isFinite(view.span) || !Number.isFinite(view.t1)) {
    view.span = 10
    view.t1 = 0
  }
  view.span = clamp(view.span, SPAN_MIN, spanMax())
  const right = liveRight()
  const last = rightmost()
  view.t1 = follow.value ? right : clamp(view.t1, Math.min(t0 + view.span, last), last)
  const range = clamp(view.hi - view.lo, RANGE_MIN, RANGE_MAX)
  const low = P_MIN - 0.5
  const high = P_MAX + 0.5
  const middle = clamp((view.hi + view.lo) / 2, low + range / 2, high - range / 2)
  view.lo = middle - range / 2
  view.hi = middle + range / 2
}

/** Back to live once the window reaches the newest frames. */
function refollow(): void {
  if (view.t1 >= liveRight() - 1e-3) follow.value = true
}

const timeAt = (x: number) => view.t1 - ((GUTTER + plotWidth() - x) / plotWidth()) * view.span
const noteAt = (y: number) => view.hi - (y / roll.h) * (view.hi - view.lo)

function zoomTime(factor: number, x: number): void {
  const anchor = timeAt(x)
  view.span = clamp(view.span * factor, SPAN_MIN, spanMax())
  if (!follow.value) view.t1 = anchor + ((GUTTER + plotWidth() - x) / plotWidth()) * view.span
  clampView()
}

/**
 * When the microphone opens, the view goes once to the first note sung — an octave around it —
 * and then stays where it is put by hand. Zooming or moving the notes by hand before that note
 * comes cancels it.
 */
let autoPitch = true
/** The note the view is gliding to, or null before the first note is heard. */
let pitchGoal: number | null = null
/** Semitones in view around the first note. */
const AUTO_RANGE = 13
/** The first note counts once it has held this long, seconds, within a semitone. */
const FIRST_NOTE_SECONDS = 0.12

/** The note held in the newest frames, within a semitone; null while nothing is held. */
function heldNote(): number | null {
  const held = Math.max(1, Math.round(FIRST_NOTE_SECONDS * rate))
  if (frames < held) return null
  readVisible(frames - held, frames)
  let low = Infinity
  let high = -Infinity
  for (let i = 0; i < held; i++) {
    const value = drawMidi[i] ?? NaN
    if (!Number.isFinite(value)) return null
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  return high - low > 1 ? null : Math.round((low + high) / 2)
}

/** With `followPitch`: a note held outside the view brings the view to it, as to the first. */
function followVoice(): void {
  const note = heldNote()
  if (note === null || (note > view.lo + 1 && note < view.hi - 1)) return
  pitchGoal = note
  autoPitch = true
}

/** One animation frame of going to the first note sung: it waits for a held note, then glides. */
function goToFirstNote(): void {
  if (pitchGoal === null) {
    pitchGoal = heldNote()
    if (pitchGoal === null) return
  }
  const range = view.hi - view.lo
  const middle = (view.hi + view.lo) / 2
  const nextRange = range + (AUTO_RANGE - range) * 0.15
  const nextMiddle = middle + (pitchGoal - middle) * 0.15
  view.lo = nextMiddle - nextRange / 2
  view.hi = nextMiddle + nextRange / 2
  if (Math.abs(pitchGoal - nextMiddle) < 0.05 && Math.abs(AUTO_RANGE - nextRange) < 0.05) {
    // There: from now on the view is in the singer's hands.
    autoPitch = false
    pitchGoal = null
  }
}

function zoomNotes(factor: number, y: number): void {
  autoPitch = false
  const anchor = noteAt(y)
  const range = clamp((view.hi - view.lo) * factor, RANGE_MIN, RANGE_MAX)
  view.hi = anchor + (y / roll.h) * range
  view.lo = view.hi - range
  clampView()
}

function panTime(seconds: number): void {
  if (follow.value) {
    if (seconds >= 0) return
    follow.value = false
  }
  view.t1 += seconds
  clampView()
  refollow()
}

function panNotes(semitones: number): void {
  autoPitch = false
  view.lo += semitones
  view.hi += semitones
  clampView()
}

/** The notes sung in the window, with a lane of room; at least eight lanes. */
function fitVoice(): void {
  const begin = Math.max(0, Math.floor(indexOf(view.t1 - view.span)))
  const stop = Math.min(frames, Math.ceil(indexOf(view.t1)))
  readVisible(begin, stop)
  let low = Infinity
  let high = -Infinity
  for (let i = 0; i < stop - begin; i++) {
    const midi = drawMidi[i] ?? NaN
    if (!Number.isFinite(midi)) continue
    low = Math.min(low, midi)
    high = Math.max(high, midi)
  }
  for (const note of props.notes) {
    if (note.end > view.t1 - view.span && note.start < view.t1) {
      low = Math.min(low, note.midi)
      high = Math.max(high, note.midi)
    }
  }
  if (!(low <= high)) {
    low = takeLow
    high = takeHigh
  }
  if (!(low <= high)) return
  let bottom = Math.floor(low) - 1.5
  let top = Math.ceil(high) + 1.5
  const missing = 8 - (top - bottom)
  if (missing > 0) {
    bottom -= missing / 2
    top += missing / 2
  }
  view.lo = bottom
  view.hi = top
  clampView()
}

function wholeTake(): void {
  follow.value = false
  view.span = Math.max(SPAN_MIN, (end - t0) * 1.03 + 0.3)
  view.t1 = t0 + view.span
  clampView()
}

function allNotes(): void {
  autoPitch = false
  if (!Number.isFinite(takeLow)) return
  view.lo = Math.floor(takeLow) - 1.5
  view.hi = Math.ceil(takeHigh) + 1.5
  clampView()
}

function goLive(): void {
  follow.value = true
  clampView()
}

/** A stretch of the take shown whole, to look through: the time around it and the notes sung in it. */
function showRange(from: number, to: number): void {
  follow.value = false
  const length = Math.max(0, to - from)
  view.span = Math.max(SPAN_MIN, length * 1.06 + 0.3)
  view.t1 = to + (view.span - length) / 2
  clampView()
  fitVoice()
}

/** Notes `low` to `high` in view, a note to spare either way; the view no longer seeks the voice. */
function showPitch(low: number, high: number): void {
  const range = Math.max(RANGE_MIN, high - low + 2)
  const middle = (low + high) / 2
  view.lo = middle - range / 2
  view.hi = middle + range / 2
  autoPitch = false
  pitchGoal = null
  clampView()
}

// ---- Drawing ----

const roll: Surface = { el: null!, ctx: null!, w: 0, h: 0 }
const mini: Surface = { el: null!, ctx: null!, w: 0, h: 0 }
const keys: Surface = { el: null!, ctx: null!, w: 0, h: 0 }

// ---- Notes on the chart: where each box is, for drawing and for the mouse ----

const xOfTime = (seconds: number) =>
  GUTTER + plotWidth() - ((view.t1 - seconds) / view.span) * plotWidth()
const yOfNote = (midi: number) => (view.hi - midi) * (roll.h / (view.hi - view.lo))
const beatOfTime = (seconds: number) =>
  props.grid === null ? 0 : (seconds - props.grid.origin) / props.grid.beatSeconds
const timeOfBeat = (beat: number) =>
  props.grid === null ? 0 : props.grid.origin + beat * props.grid.beatSeconds

/** Beats one step of the ruler is: a beat while beats are wide enough to aim at, else a bar. */
function rulerStep(): number {
  const grid = props.grid
  if (grid === null) return 1
  return (grid.beatSeconds / view.span) * plotWidth() >= 14 ? 1 : grid.beatsPerBar
}

/** `seconds` on the nearest step of the ruler; as it is without a grid or with Alt held. */
function snapTime(seconds: number, free: boolean): number {
  return props.grid === null || free ? seconds : snapSeconds(seconds, props.grid, rulerStep())
}

interface NoteBox {
  x0: number
  x1: number
  y0: number
  y1: number
  chosen: boolean
  note: EditNote | null
  midi: number
  onset: Onset
  release: Release
  vibrato: boolean
}

/** Boxes of the notes drawn: the editor's while editing, else the notes given. */
function noteBoxes(): NoteBox[] {
  const lane = roll.h / (view.hi - view.lo)
  const height = Math.min(lane * 0.76, clamp(lane * 0.55, 3, 12) + 10)
  const box = (shape: TakeNote, chosen: boolean, note: EditNote | null): NoteBox => {
    const middle = yOfNote(shape.midi)
    return {
      x0: xOfTime(shape.start),
      x1: xOfTime(shape.end),
      y0: middle - height / 2,
      y1: middle + height / 2,
      chosen,
      note,
      midi: shape.midi,
      onset: shape.onset ?? 'plain',
      release: shape.release ?? 'plain',
      vibrato: shape.vibrato === true,
    }
  }
  const editor = props.editor
  if (props.editing && editor !== null && props.grid !== null) {
    const chosen = editor.selected.value
    return editor.notes.value.map((note) =>
      box(
        {
          midi: note.midi,
          start: timeOfBeat(note.start),
          end: timeOfBeat(note.start + note.length),
          onset: note.onset,
          release: note.release,
          vibrato: note.vibrato,
        },
        chosen.has(note.id),
        note,
      ),
    )
  }
  return props.notes.map((note) => box(note, false, null))
}

/**
 * How a note is sung, drawn around its box: a scoop climbs into it from below, an attack is a
 * wedge at its start, a fall drops off its end, a glide runs into the next note, vibrato waves
 * along its top.
 */
function drawOrnaments(c: CanvasRenderingContext2D, boxes: readonly NoteBox[], lane: number): void {
  c.strokeStyle = palette.accent
  c.lineCap = 'round'
  c.lineJoin = 'round'
  boxes.forEach((box, index) => {
    const middle = (box.y0 + box.y1) / 2
    const reach = Math.max(8, Math.min(18, lane * 1.4))
    c.globalAlpha = 0.9
    c.lineWidth = 1.5
    if (box.onset === 'scoop') {
      c.beginPath()
      c.moveTo(box.x0 - reach, middle + reach)
      c.quadraticCurveTo(box.x0 - reach * 0.3, middle + reach * 0.9, box.x0, middle)
      c.stroke()
    } else if (box.onset === 'attack' && box.x1 - box.x0 > 10) {
      c.beginPath()
      c.moveTo(box.x0 + 3, box.y0 + 2)
      c.lineTo(box.x0 + 9, middle)
      c.lineTo(box.x0 + 3, box.y1 - 2)
      c.stroke()
    }
    if (box.release === 'fall') {
      c.beginPath()
      c.moveTo(box.x1, middle)
      c.quadraticCurveTo(box.x1 + reach * 0.3, middle + reach * 0.1, box.x1 + reach, middle + reach)
      c.stroke()
    } else if (box.release === 'glide') {
      const next = boxes[index + 1]
      const to =
        next === undefined
          ? { x: box.x1 + reach, y: middle }
          : { x: next.x0, y: (next.y0 + next.y1) / 2 }
      const bend = (box.x1 + to.x) / 2
      c.setLineDash([4, 3])
      c.beginPath()
      c.moveTo(box.x1, middle)
      c.bezierCurveTo(bend, middle, bend, to.y, to.x, to.y)
      c.stroke()
      c.setLineDash([])
    }
    if (box.vibrato && box.x1 - box.x0 > 14) {
      c.lineWidth = 1.2
      c.beginPath()
      for (let x = box.x0 + 5; x <= box.x1 - 5; x += 1) {
        const y = box.y0 + 3 + 1.6 * Math.sin((x - box.x0) / 2.2)
        if (x === box.x0 + 5) c.moveTo(x, y)
        else c.lineTo(x, y)
      }
      c.stroke()
    }
  })
  c.lineWidth = 1
}

/** Boxes of the loose pieces of the voice — sung, but no note — while the notes are chosen. */
function looseBoxes(): { piece: LoosePiece; x0: number; x1: number; y0: number; y1: number }[] {
  const curve = props.curve
  if (!props.editing || curve === null || props.editor?.tool.value !== 'select') return []
  const lane = roll.h / (view.hi - view.lo)
  const height = Math.min(lane * 0.76, clamp(lane * 0.55, 3, 12) + 10)
  const first = curve.firstTime.value
  const rate = curve.frameRate.value
  return curve.loose.value.map((piece) => {
    const middle = yOfNote(piece.midi)
    return {
      piece,
      x0: xOfTime(first + piece.start / rate),
      x1: xOfTime(first + piece.end / rate),
      y0: middle - height / 2,
      y1: middle + height / 2,
    }
  })
}

function drawLoose(c: CanvasRenderingContext2D): void {
  const boxes = looseBoxes()
  if (boxes.length === 0) return
  c.strokeStyle = c.fillStyle = palette.ink
  c.lineWidth = 1
  c.setLineDash([3, 3])
  for (const box of boxes) {
    const hovered = hoverLoose === box.piece
    c.globalAlpha = hovered ? 0.12 : 0.04
    c.fillRect(box.x0, box.y0, Math.max(2, box.x1 - box.x0), box.y1 - box.y0)
    c.globalAlpha = hovered ? 0.8 : 0.4
    c.strokeRect(box.x0 + 0.5, box.y0 + 0.5, Math.max(2, box.x1 - box.x0), box.y1 - box.y0)
  }
  c.setLineDash([])
}

/** The loose piece under the mouse, to be made a note with a click. */
function looseUnder(point: Point): LoosePiece | null {
  for (const box of looseBoxes()) {
    if (
      point.x >= box.x0 - 3 &&
      point.x <= box.x1 + 3 &&
      point.y >= box.y0 - 3 &&
      point.y <= box.y1 + 3
    )
      return box.piece
  }
  return null
}

/**
 * A loose piece made a note: found in the voice with the others while the notes follow the
 * shaping, added by hand once they were edited.
 */
function promote(piece: LoosePiece): void {
  const curve = props.curve
  const editor = props.editor
  if (curve === null || editor === null) return
  if (!editor.edited.value) {
    curve.force(piece)
    return
  }
  const start = curve.firstTime.value + piece.start / curve.frameRate.value
  const end = curve.firstTime.value + piece.end / curve.frameRate.value
  const from = beatOfTime(start)
  editor.add(Math.round(piece.midi), from, {
    length: beatOfTime(end) - from,
    source: { start, end, midi: piece.midi, index: -1 },
  })
}

type HandleKind = 'vibrato' | 'flatness'
interface Handle {
  note: EditNote
  kind: HandleKind
  x: number
  y: number
}

/**
 * Handles on the note under the mouse and on the one chosen: above its middle how much vibrato it
 * keeps, below its start how level it is.
 */
function handles(): Handle[] {
  const editor = props.editor
  if (!props.editing || editor === null || editor.tool.value !== 'select') return []
  const chosen = editor.selected.value
  const out: Handle[] = []
  for (const box of noteBoxes()) {
    const note = box.note
    if (note === null || box.x1 - box.x0 < 22) continue
    const shown =
      (hover !== null && hover.id === note.id) ||
      (chosen.size === 1 && chosen.has(note.id)) ||
      shaping?.id === note.id
    if (!shown) continue
    out.push({ note, kind: 'vibrato', x: (box.x0 + box.x1) / 2, y: box.y0 - 8 })
    out.push({ note, kind: 'flatness', x: box.x0 + 8, y: box.y1 + 8 })
  }
  return out
}

function handleUnder(point: Point): Handle | null {
  return handles().find((handle) => Math.hypot(point.x - handle.x, point.y - handle.y) <= 8) ?? null
}

function drawHandles(c: CanvasRenderingContext2D): void {
  for (const handle of handles()) {
    const shape = shapeOf(handle.note)
    const amount = handle.kind === 'vibrato' ? shape.vibratoScale : shape.flatness
    c.globalAlpha = 1
    c.fillStyle = palette.bg
    c.strokeStyle = palette.accent
    c.lineWidth = 1.5
    c.beginPath()
    c.arc(handle.x, handle.y, 6, 0, Math.PI * 2)
    c.fill()
    c.stroke()
    c.strokeStyle = palette.ink
    c.lineWidth = 1.2
    c.beginPath()
    if (handle.kind === 'vibrato') {
      for (let dx = -3.5; dx <= 3.5; dx += 0.5) {
        const dy = -1.8 * Math.sin((dx / 3.5) * Math.PI * 1.5) * Math.min(1, amount)
        if (dx === -3.5) c.moveTo(handle.x + dx, handle.y + dy)
        else c.lineTo(handle.x + dx, handle.y + dy)
      }
    } else {
      const spread = 2.2 * (1 - amount)
      c.moveTo(handle.x - 3.5, handle.y - 1.5 - spread)
      c.lineTo(handle.x + 3.5, handle.y - 1.5 + spread)
      c.moveTo(handle.x - 3.5, handle.y + 1.5 + spread)
      c.lineTo(handle.x + 3.5, handle.y + 1.5 - spread)
    }
    c.stroke()
    if (shaping !== null && shaping.id === handle.note.id && shaping.kind === handle.kind) {
      // While it is dragged, what it is set to.
      const text = `${handle.kind === 'vibrato' ? 'Вибрато' : 'Ровность'} ${Math.round(amount * 100)}%`
      c.font = `600 11px ${palette.font}`
      c.textBaseline = 'middle'
      c.textAlign = 'left'
      const width = c.measureText(text).width
      c.globalAlpha = 0.92
      c.fillStyle = palette.bg
      c.beginPath()
      c.roundRect(handle.x + 10, handle.y - 9, width + 12, 18, 9)
      c.fill()
      c.fillStyle = palette.ink
      c.fillText(text, handle.x + 16, handle.y)
    }
  }
  c.lineWidth = 1
}

/** The editor's note under the mouse, and which part of it: an edge to stretch or the body. */
function noteUnder(point: Point): { note: EditNote; part: 'start' | 'end' | 'body' } | null {
  if (!props.editing || props.editor === null || props.grid === null || point.x < GUTTER)
    return null
  // The hand only looks around and the line tools draw on the line: no note is under them.
  const tool = props.editor.tool.value
  if (tool === 'hand' || LINE_TOOLS.includes(tool)) return null
  const boxes = noteBoxes()
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i]!
    if (box.note === null) continue
    if (point.y < box.y0 - 2 || point.y > box.y1 + 2) continue
    if (point.x < box.x0 - 4 || point.x > box.x1 + 4) continue
    const width = box.x1 - box.x0
    const grip = width > 24 ? 7 : width > 12 ? 4 : 0
    if (point.x >= box.x1 - grip) return { note: box.note, part: 'end' }
    if (grip > 0 && point.x <= box.x0 + grip) return { note: box.note, part: 'start' }
    return { note: box.note, part: 'body' }
  }
  return null
}

/** Where the scissors cut at the mouse: on the editing grid, or anywhere with Alt held. */
function cutBeat(point: Point, free: boolean): number {
  const beat = beatOfTime(timeAt(point.x))
  return free || props.editor === null ? beat : snapBeat(beat, props.editor.snap.value)
}

/** The frame of the edited line under `x`, within the line. */
function lineFrame(x: number): number {
  const curve = props.curve
  if (curve === null) return 0
  const frame = Math.round((timeAt(x) - curve.firstTime.value) * curve.frameRate.value)
  return clamp(frame, 0, Math.max(0, curve.target.value.length - 1))
}

/** Whether a line tool is in hand while the line can be edited. */
function lineTool(): LineTool | null {
  const tool = props.editor?.tool.value
  if (!props.editing || props.curve === null || tool === undefined) return null
  return LINE_TOOLS.includes(tool) ? (tool as LineTool) : null
}

/** The note sung at the cursor while looking through, or just now while live. */
function litNote(): { note: number; level: number } | null {
  let index = frames - 1
  if (!follow.value && playhead.value !== null) index = Math.floor(indexOf(playhead.value))
  const from = follow.value || playhead.value === null ? Math.max(0, frames - 15) : index
  for (let i = Math.min(index, frames - 1); i >= Math.max(0, from); i--) {
    readVisible(i, i + 1)
    const midi = drawMidi[0] ?? NaN
    if (Number.isFinite(midi)) return { note: Math.round(midi), level: drawLevel[0] ?? 0 }
  }
  return null
}

function drawRoll(lit: { note: number; level: number } | null): void {
  const { ctx: c, w, h } = roll
  if (!w || !h) return
  const width = plotWidth()
  const lane = h / (view.hi - view.lo)
  const thickness = clamp(lane * 0.55, 3, 12)
  const left = view.t1 - view.span
  const x = (seconds: number) => GUTTER + width - ((view.t1 - seconds) / view.span) * width
  const y = (midi: number) => (view.hi - midi) * lane
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.globalCompositeOperation = 'source-over'
  c.globalAlpha = 1
  c.shadowBlur = 0
  c.clearRect(0, 0, w, h)

  c.save()
  c.beginPath()
  c.rect(GUTTER, 0, w - GUTTER, h)
  c.clip()

  if (props.region !== null) {
    c.globalAlpha = 0.07
    c.fillStyle = palette.accent
    c.fillRect(x(props.region.from), 0, x(props.region.to) - x(props.region.from), h)
  }
  const chosenSpan = selection.value
  if (chosenSpan !== null) {
    c.globalAlpha = 0.1
    c.fillStyle = palette.accent
    c.fillRect(x(chosenSpan.from), 0, x(chosenSpan.to) - x(chosenSpan.from), h)
  }

  // Notes to sing into: empty boxes in the accent; while editing, the chosen ones filled.
  c.strokeStyle = c.fillStyle = palette.accent
  for (const box of noteBoxes()) {
    if (box.x1 < GUTTER || box.x0 > w) continue
    c.beginPath()
    c.roundRect(
      box.x0,
      box.y0,
      Math.max(1, box.x1 - box.x0),
      box.y1 - box.y0,
      Math.min((box.y1 - box.y0) * 0.4, (box.x1 - box.x0) / 2),
    )
    const hovered = hover !== null && box.note !== null && box.note.id === hover.id
    c.globalAlpha = box.chosen ? 0.4 : hovered ? 0.26 : 0.12
    c.fill()
    c.globalAlpha = 0.9
    c.lineWidth = box.chosen || hovered ? 2 : 1
    c.stroke()
    // The note's name on the chosen and the hovered one, so its pitch can be checked.
    if ((box.chosen || hovered) && box.x1 - box.x0 > 30 && box.y1 - box.y0 >= 10) {
      c.globalAlpha = 0.95
      c.fillStyle = palette.ink
      c.font = `600 ${Math.min(11, box.y1 - box.y0 - 2)}px ${palette.font}`
      c.textBaseline = 'middle'
      c.textAlign = 'left'
      c.fillText(noteName(box.midi), box.x0 + 7, (box.y0 + box.y1) / 2)
      c.fillStyle = palette.accent
    }
    // With the scissors, a dashed line shows where a click cuts.
    if (hovered && hover !== null && props.editor?.tool.value === 'cut') {
      c.globalAlpha = 1
      c.strokeStyle = palette.ink
      c.setLineDash([3, 3])
      c.beginPath()
      c.moveTo(hover.cut, box.y0 - 5)
      c.lineTo(hover.cut, box.y1 + 5)
      c.stroke()
      c.setLineDash([])
      c.strokeStyle = palette.accent
    }
    if (box.note?.source !== undefined && box.x1 - box.x0 > 6) {
      // How well the note was sung: a strip along its foot, green in tune, amber near, red off.
      const centre = box.note.source.midi
      c.globalAlpha = 0.85
      c.fillStyle = deviationColor(Math.abs(centre - Math.round(centre)))
      c.fillRect(box.x0 + 2, box.y1 - 3, box.x1 - box.x0 - 4, 2)
      c.fillStyle = palette.accent
    }
    if (box.chosen && box.x1 - box.x0 > 18) {
      // Grips on the edges say the note can be stretched.
      const middle = (box.y0 + box.y1) / 2
      c.globalAlpha = 0.9
      c.fillRect(box.x0 + 2, middle - 4, 2, 8)
      c.fillRect(box.x1 - 4, middle - 4, 2, 8)
    }
  }
  c.lineWidth = 1
  drawOrnaments(c, noteBoxes(), lane)
  drawLoose(c)
  drawHandles(c)

  // The sung band, thinned to about 1.5 frames per pixel and batched by colour.
  const begin = Math.max(0, Math.floor(indexOf(left)) - 1)
  const stop = Math.min(frames, Math.ceil(indexOf(view.t1)) + 1)
  readVisible(begin, stop)
  const step = Math.max(1, Math.floor((stop - begin) / (width * 1.5)))
  const rail = (midi: number) => (midi > view.hi ? 2 : midi < view.lo ? h - 2 : null)
  c.lineCap = 'round'
  c.lineJoin = 'round'
  let key = -1
  let open = false
  const flush = () => {
    if (open) c.stroke()
    open = false
  }
  for (let i = Math.max(begin + step, Math.ceil(begin / step) * step); i < stop; i += step) {
    const a = drawMidi[i - step - begin] ?? NaN
    const b = drawMidi[i - begin] ?? NaN
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) > MAX_JOIN_SEMITONES) {
      flush()
      continue
    }
    const railA = rail(a)
    const railB = rail(b)
    const onRail = railA !== null && railA === railB
    const shade = Math.round(clamp(drawLevel[i - begin] ?? 0, 0, 1) * 24)
    const nextKey = shade + (onRail ? 100 : 0)
    if (nextKey !== key || !open) {
      flush()
      c.beginPath()
      c.moveTo(x(timeOfIndex(i - step)), onRail ? railA : y(a))
      c.strokeStyle = loudnessColor(shade / 24)
      c.lineWidth = onRail ? 2 : thickness
      c.globalAlpha = onRail ? 0.55 : 1
      key = nextKey
      open = true
    }
    c.lineTo(x(timeOfIndex(i)), onRail ? railB! : y(b))
  }
  flush()
  drawLine(c, x, y, h)
  c.restore()

  // While live the history fades out towards the note names.
  const nowX = x(end)
  if (follow.value && props.recording) {
    c.globalCompositeOperation = 'destination-in'
    const fade = c.createLinearGradient(GUTTER, 0, nowX, 0)
    fade.addColorStop(0, 'rgba(0, 0, 0, 0)')
    fade.addColorStop(0.3, 'rgba(0, 0, 0, 0.5)')
    fade.addColorStop(1, 'rgba(0, 0, 0, 1)')
    c.fillStyle = fade
    c.globalAlpha = 1
    c.fillRect(0, 0, w, h)
  }

  // Lanes behind everything: black keys a shade darker, a hairline under each C, the lit note.
  c.globalCompositeOperation = 'destination-over'
  const litColor = lit === null ? palette.muted : loudnessColor(lit.level)
  for (let note = Math.floor(view.lo + 0.5); note <= Math.ceil(view.hi - 0.5); note++) {
    const top = y(note + 0.5)
    if (lit !== null && note === lit.note) {
      c.globalAlpha = 0.14
      c.fillStyle = litColor
      c.fillRect(GUTTER, top, w - GUTTER, lane)
    } else if (BLACK_KEYS.has(pitchClass(note))) {
      c.globalAlpha = 0.035
      c.fillStyle = palette.ink
      c.fillRect(GUTTER, top, w - GUTTER, lane)
    }
    if (pitchClass(note) === 0) {
      c.globalAlpha = 0.1
      c.fillStyle = palette.ink
      c.fillRect(GUTTER, top + lane - 0.5, w - GUTTER, 1)
    }
  }

  c.globalCompositeOperation = 'source-over'
  c.fillStyle = palette.ink
  // The metronome's beats: bar lines, and beat lines while they are not too dense.
  if (props.grid !== null) {
    const { origin, beatSeconds, beatsPerBar } = props.grid
    const beatWidth = (beatSeconds / view.span) * width
    for (let beat = Math.ceil((left - origin) / beatSeconds); ; beat++) {
      const at = origin + beat * beatSeconds
      if (at > view.t1) break
      const downbeat = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar === 0
      if (!downbeat && beatWidth < 8) continue
      if (x(at) < GUTTER) continue
      c.globalAlpha = downbeat ? 0.2 : 0.08
      c.fillRect(x(at) - 0.5, RULER, 1, h - RULER)
    }
  }

  c.font = `500 10px ${palette.font}`
  c.textAlign = 'center'
  c.textBaseline = 'alphabetic'
  c.fillStyle = palette.muted
  if (props.grid !== null) {
    // Bound to the metronome: the count-in shaded; the bars are numbered on the ruler.
    const { origin } = props.grid
    if (origin > left) {
      c.globalAlpha = 0.035
      c.fillStyle = palette.ink
      c.fillRect(
        Math.max(GUTTER, x(left)),
        0,
        Math.max(0, x(origin) - Math.max(GUTTER, x(left))),
        h,
      )
      c.fillStyle = palette.muted
    }
  } else {
    // Time from the start of the take.
    const tick = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(
      (seconds) => (seconds / view.span) * width >= 64,
    )
    const every = tick ?? 600
    for (
      let t = Math.max(0, Math.ceil((left - t0) / every) * every);
      t0 + t <= view.t1;
      t += every
    ) {
      const at = x(t0 + t)
      if (at < GUTTER + 14 || at > w - HEAD_ROOM - 10) continue
      c.globalAlpha = 0.55
      c.fillText(clockText(t, every < 1), at, h - 4)
    }
  }
  c.textAlign = 'left'

  c.globalAlpha = 0.035
  c.fillStyle = palette.ink
  c.fillRect(0, 0, GUTTER, h)
  c.globalAlpha = 0.08
  c.fillRect(GUTTER - 0.5, 0, 1, h)

  // Note names thin out as lanes get tight: the lit note, then the Cs, then the rest where they fit.
  const naming = lane >= 11 ? 'all' : lane >= 7 ? 'naturals' : 'octaves'
  const size = Math.min(11, Math.max(8, lane * 0.8))
  const names: number[] = []
  for (let note = Math.ceil(view.lo); note <= Math.floor(view.hi); note++) {
    const cls = pitchClass(note)
    if (naming === 'all' || cls === 0 || (naming === 'naturals' && !BLACK_KEYS.has(cls))) {
      names.push(note)
    }
  }
  if (lit !== null && lit.note >= view.lo && lit.note <= view.hi && !names.includes(lit.note)) {
    names.push(lit.note)
  }
  const rank = (note: number) => (note === lit?.note ? 0 : pitchClass(note) === 0 ? 1 : 2)
  names.sort((a, b) => rank(a) - rank(b) || a - b)
  const placed: number[] = []
  c.textBaseline = 'middle'
  for (const note of names) {
    const at = y(note)
    const isLit = note === lit?.note
    if (!isLit && placed.some((other) => Math.abs(other - at) < size + 2)) continue
    placed.push(at)
    c.font = `${isLit ? 700 : 500} ${size}px ${palette.font}`
    c.globalAlpha = isLit ? 1 : BLACK_KEYS.has(pitchClass(note)) ? 0.38 : 0.7
    c.fillStyle = isLit ? litColor : palette.muted
    c.fillText(noteName(note), 4, at)
  }

  if (end >= left && end <= view.t1) {
    c.globalAlpha = 0.22
    c.fillStyle = palette.ink
    c.fillRect(nowX - 0.5, 0, 1, h)
  }
  drawRuler(c, x, w, h)
  const cursor = playhead.value
  if (cursor !== null && x(cursor) >= GUTTER && cursor <= view.t1) {
    const at = x(cursor)
    c.globalAlpha = 1
    c.fillStyle = palette.accent
    c.fillRect(at - 1, 0, 2, h)
    c.beginPath()
    c.moveTo(at - 6, 0)
    c.lineTo(at + 6, 0)
    c.lineTo(at, 8)
    c.fill()
  }
  // The take within everything heard: the rest dimmed, its ends marked.
  const take = props.takeRange
  if (take !== null) {
    const from = x(take.from)
    const to = x(take.to ?? end)
    c.globalAlpha = 0.28
    c.fillStyle = palette.bg
    if (from > GUTTER) c.fillRect(GUTTER, 0, from - GUTTER, h)
    if (to < w) c.fillRect(Math.max(GUTTER, to), 0, w - Math.max(GUTTER, to), h)
    c.globalAlpha = 0.7
    c.fillStyle = palette.accent
    if (from >= GUTTER) c.fillRect(from - 0.75, 0, 1.5, h)
    if (take.to !== null && to >= GUTTER && to <= w) c.fillRect(to - 0.75, 0, 1.5, h)
  }
  if (props.recording && frames > 0) {
    // While live, the note being sung in large, with how far off it is.
    const recent = Math.max(0, frames - Math.round(0.15 * rate))
    readVisible(recent, frames)
    for (let i = frames - recent - 1; i >= 0; i--) {
      const sung = drawMidi[i] ?? NaN
      if (!Number.isFinite(sung)) continue
      const note = Math.round(sung)
      const cents = Math.round((sung - note) * 100)
      c.globalAlpha = 0.9
      c.fillStyle = loudnessColor(drawLevel[i] ?? 0)
      c.font = `700 22px ${palette.font}`
      c.textAlign = 'left'
      c.textBaseline = 'top'
      c.fillText(noteName(note), GUTTER + 10, RULER + 6)
      const width = c.measureText(noteName(note)).width
      c.font = `600 13px ${palette.font}`
      c.fillStyle = palette.muted
      c.fillText(
        `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${Math.abs(cents)}¢`,
        GUTTER + 16 + width,
        RULER + 12,
      )
      break
    }
  }
  if (props.recording && frames > 0) {
    readVisible(frames - 1, frames)
    const midi = drawMidi[0] ?? NaN
    if (Number.isFinite(midi) && midi >= view.lo && midi <= view.hi && end >= left) {
      const color = loudnessColor(drawLevel[0] ?? 0)
      c.globalAlpha = 1
      c.fillStyle = color
      c.shadowColor = color
      c.shadowBlur = 12
      c.beginPath()
      c.arc(nowX, y(midi), thickness / 2 + 1.5, 0, Math.PI * 2)
      c.fill()
      c.shadowBlur = 0
    }
  }
}

/**
 * The ruler along the top: bars numbered from the take's first downbeat, beat ticks while they
 * fit, the stretch chosen on it and the loop's brace — bright while it loops.
 */
function drawRuler(
  c: CanvasRenderingContext2D,
  x: (seconds: number) => number,
  w: number,
  h: number,
): void {
  const left = view.t1 - view.span
  c.save()
  c.beginPath()
  c.rect(GUTTER, 0, w - GUTTER, h)
  c.clip()
  c.globalAlpha = 0.9
  c.fillStyle = palette.bg
  c.fillRect(GUTTER, 0, w - GUTTER, RULER)
  c.globalAlpha = 0.05
  c.fillStyle = palette.ink
  c.fillRect(GUTTER, 0, w - GUTTER, RULER)
  c.globalAlpha = 0.14
  c.fillRect(GUTTER, RULER - 0.5, w - GUTTER, 1)

  const chosenSpan = selection.value
  if (chosenSpan !== null) {
    c.globalAlpha = 0.3
    c.fillStyle = palette.accent
    c.fillRect(x(chosenSpan.from), 0, x(chosenSpan.to) - x(chosenSpan.from), RULER)
  }
  const loop = loopRange.value
  if (loop !== null) {
    const a = x(loop.from)
    const b = x(loop.to)
    c.globalAlpha = props.looping ? 0.9 : 0.32
    c.fillStyle = palette.accent
    c.beginPath()
    c.roundRect(a, 2, Math.max(2, b - a), BRACE - 3, 3)
    c.fill()
    if (props.looping) {
      c.globalAlpha = 0.45
      c.fillRect(a - 0.5, RULER, 1, h - RULER)
      c.fillRect(b - 0.5, RULER, 1, h - RULER)
    }
  }

  const grid = props.grid
  if (grid !== null) {
    const width = plotWidth()
    const { origin, beatSeconds, beatsPerBar } = grid
    const beatWidth = (beatSeconds / view.span) * width
    const barWidth = beatWidth * beatsPerBar
    const every = [1, 2, 4, 8, 16, 32, 64].find((bars) => bars * barWidth >= 28) ?? 64
    c.fillStyle = palette.ink
    for (let beat = Math.ceil((left - origin) / beatSeconds); ; beat++) {
      const time = origin + beat * beatSeconds
      if (time > view.t1) break
      const at = x(time)
      const inBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar
      const bar = Math.floor(beat / beatsPerBar)
      if (inBar === 0) {
        c.globalAlpha = 0.35
        c.fillRect(at - 0.5, RULER - 8, 1, 8)
        if (bar >= 0 && bar % every === 0 && at > GUTTER + 2) {
          c.globalAlpha = 0.8
          c.font = `600 10px ${palette.font}`
          c.textAlign = 'left'
          c.textBaseline = 'middle'
          c.fillText(String(bar + 1), at + 3, (BRACE + RULER) / 2)
        }
      } else if (beatWidth >= 8) {
        c.globalAlpha = 0.22
        c.fillRect(at - 0.5, RULER - 4, 1, 4)
        if (beatWidth >= 34 && bar >= 0) {
          c.globalAlpha = 0.45
          c.font = `500 9px ${palette.font}`
          c.textAlign = 'left'
          c.textBaseline = 'middle'
          c.fillText(`${bar + 1}.${inBar + 1}`, at + 3, (BRACE + RULER) / 2)
        }
      }
    }
  }
  c.restore()
}

/**
 * The edited pitch line over the voice: the target the notes are read from, gold; the line
 * tool's straight stroke while it is drawn; and the brush of the bend and the eraser.
 */
function drawLine(
  c: CanvasRenderingContext2D,
  x: (seconds: number) => number,
  y: (midi: number) => number,
  h: number,
): void {
  const curve = props.curve
  if (curve === null || !props.editing) return
  const values = curve.target.value
  const start = curve.firstTime.value
  const rate = curve.frameRate.value
  const left = view.t1 - view.span
  const from = Math.max(0, Math.floor((left - start) * rate) - 1)
  const to = Math.min(values.length, Math.ceil((view.t1 - start) * rate) + 1)
  c.save()
  c.globalAlpha = 0.95
  c.strokeStyle = palette.accent
  c.lineWidth = 2.5
  c.lineJoin = 'round'
  c.lineCap = 'round'
  c.beginPath()
  let open = false
  for (let i = from; i < to; i++) {
    const value = values[i]
    if (value === undefined || !Number.isFinite(value)) {
      open = false
      continue
    }
    const px = x(start + i / rate)
    const py = y(value)
    if (open) c.lineTo(px, py)
    else c.moveTo(px, py)
    open = true
  }
  c.stroke()
  const drawn = curve.preview.value
  if (drawn !== null) {
    c.strokeStyle = palette.ink
    c.lineWidth = 1.5
    c.setLineDash([5, 4])
    c.beginPath()
    c.moveTo(x(start + drawn.from / rate), y(drawn.fromPitch))
    c.lineTo(x(start + drawn.to / rate), y(drawn.toPitch))
    c.stroke()
    c.setLineDash([])
  }
  const tool = lineTool()
  if (pointerX !== null && (tool === 'bend' || tool === 'erase')) {
    const half = (curve.brush.value / 2 / view.span) * plotWidth()
    c.globalAlpha = 0.07
    c.fillStyle = palette.ink
    c.fillRect(pointerX - half, 0, half * 2, h)
    c.globalAlpha = 0.4
    c.strokeStyle = palette.ink
    c.lineWidth = 1
    c.strokeRect(pointerX - half + 0.5, 0.5, half * 2, h - 1)
  }
  c.restore()
}

/** The choosing frame over everything else on the chart. */
function drawBand(c: CanvasRenderingContext2D): void {
  if (band === null) return
  c.globalAlpha = 0.08
  c.fillStyle = palette.accent
  c.fillRect(band.x0, band.y0, band.x1 - band.x0, band.y1 - band.y0)
  c.globalAlpha = 0.8
  c.strokeStyle = palette.accent
  c.lineWidth = 1
  c.setLineDash([4, 3])
  c.strokeRect(band.x0 + 0.5, band.y0 + 0.5, band.x1 - band.x0, band.y1 - band.y0)
  c.setLineDash([])
}

const worldRight = () => Math.max(t0 + 10, end, view.t1)

function drawMini(): void {
  const { ctx: c, w, h } = mini
  if (!w || !h) return
  const world = worldRight() - t0
  const x = (seconds: number) => ((seconds - t0) / world) * w
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.globalAlpha = 1
  c.clearRect(0, 0, w, h)
  c.globalAlpha = 0.05
  c.fillStyle = palette.ink
  c.fillRect(x(end), 0, w - x(end), h)
  const low = (Number.isFinite(takeLow) ? takeLow : 55) - 1
  const high = (Number.isFinite(takeHigh) ? takeHigh : 75) + 1
  const y = (midi: number) => 6 + ((high - midi) / (high - low)) * (h - 12)
  const perPixel = (world * rate) / w
  c.globalAlpha = 0.9
  for (let px = 0; px < w; px++) {
    const first = Math.floor(px * perPixel)
    if (first >= frames) break
    const last = Math.min(frames, Math.max(first + 1, Math.floor((px + 1) * perPixel)))
    let min = Infinity
    let max = -Infinity
    let level = 0
    for (let b = Math.floor(first / BUCKET); b < Math.ceil(last / BUCKET); b++) {
      min = Math.min(min, bucketMin[b] ?? Infinity)
      max = Math.max(max, bucketMax[b] ?? -Infinity)
      level = Math.max(level, bucketLevel[b] ?? 0)
    }
    if (min > max) continue
    c.fillStyle = loudnessColor(level)
    c.fillRect(px, y(max), 1, Math.max(1.5, y(min) - y(max)))
  }
  const from = x(view.t1 - view.span)
  const to = x(view.t1)
  c.globalAlpha = 0.5
  c.fillStyle = palette.bg
  c.fillRect(0, 0, Math.max(0, from), h)
  c.fillRect(to, 0, w - to, h)
  drawFrame(c, from, 0, to - from, h, true)
  if (playhead.value !== null) {
    c.globalAlpha = 1
    c.fillStyle = palette.ink
    c.fillRect(x(playhead.value) - 0.75, 0, 1.5, h)
  }
}

const keyY = (midi: number) => ((P_MAX + 0.5 - midi) / RANGE_MAX) * keys.h
const keyNote = (y: number) => P_MAX + 0.5 - (y / keys.h) * RANGE_MAX

function drawKeys(lit: { note: number } | null): void {
  const { ctx: c, w, h } = keys
  if (!w || !h) return
  const lane = h / RANGE_MAX
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.globalAlpha = 1
  c.clearRect(0, 0, w, h)
  let most = 0
  for (let note = P_MIN; note <= P_MAX; note++) most = Math.max(most, noteTime[note] ?? 0)
  for (let note = P_MIN; note <= P_MAX; note++) {
    const top = keyY(note + 0.5)
    if (BLACK_KEYS.has(pitchClass(note))) {
      c.globalAlpha = 0.07
      c.fillStyle = palette.ink
      c.fillRect(0, top, w, lane)
    }
    if (pitchClass(note) === 0) {
      c.globalAlpha = 0.18
      c.fillStyle = palette.ink
      c.fillRect(0, top + lane - 0.5, w, 1)
    }
    const time = noteTime[note] ?? 0
    if (most > 0 && time > 0) {
      const length = (time / most) * (w - 4)
      c.globalAlpha = 0.6
      c.fillStyle = palette.good
      c.fillRect(w - 2 - length, top + 0.5, length, Math.max(1, lane - 1))
    }
  }
  c.font = `600 8px ${palette.font}`
  c.textBaseline = 'middle'
  c.globalAlpha = 0.75
  c.fillStyle = palette.muted
  for (let note = P_MIN; note <= P_MAX; note += 12) {
    c.fillText(noteName(note), 2, clamp(keyY(note), 5, h - 5))
  }
  const top = keyY(view.hi)
  const bottom = keyY(view.lo)
  c.globalAlpha = 0.5
  c.fillStyle = palette.bg
  c.fillRect(0, 0, w, Math.max(0, top))
  c.fillRect(0, bottom, w, h - bottom)
  drawFrame(c, 0, top, w, bottom - top, false)
  if (lit !== null) {
    c.globalAlpha = 1
    c.fillStyle = palette.accent
    c.fillRect(0, keyY(lit.note) - 1.5, 5, 3)
  }
}

/** The window's frame with two grips, drawn outside it when it is too thin to hold them. */
function drawFrame(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  across: boolean,
): void {
  c.globalAlpha = 1
  c.strokeStyle = c.fillStyle = palette.accent
  c.lineWidth = 1.5
  c.beginPath()
  c.roundRect(x + 0.75, y + 0.75, Math.max(2, width - 1.5), Math.max(2, height - 1.5), 6)
  c.stroke()
  c.beginPath()
  if (across) {
    const grip = Math.min(20, height - 12)
    const top = y + (height - grip) / 2
    const outside = width < 22
    c.roundRect(outside ? x - 7 : x + 3, top, 4, grip, 2)
    c.roundRect(outside ? x + width + 3 : x + width - 7, top, 4, grip, 2)
  } else {
    const grip = Math.min(20, width - 12)
    const left = x + (width - grip) / 2
    const outside = height < 22
    c.roundRect(left, outside ? y - 7 : y + 3, grip, 4, 2)
    c.roundRect(left, outside ? y + height + 3 : y + height - 7, grip, 4, 2)
  }
  c.fill()
}

function clockText(seconds: number, tenths: boolean): string {
  const total = Math.max(0, seconds)
  const minutes = Math.floor(total / 60)
  const rest = total - minutes * 60
  return tenths
    ? `${minutes}:${rest.toFixed(1).padStart(4, '0')}`
    : `${minutes}:${String(Math.round(rest) % 60).padStart(2, '0')}`
}

// ---- Every frame: take in new frames, turn pages after the cursor, draw ----

let raf = 0
let pinching = false
let dragging = false

function frame(): void {
  frames = props.source.length()
  rate = props.source.frameRate()
  t0 = frames > 0 ? props.source.timeOf(0) : 0
  end = frames > 0 ? props.source.timeOf(frames - 1) : 0
  summarize()
  const cursor = playhead.value
  if (props.playing && cursor !== null && !follow.value && !dragging && !pinching) {
    // The page turns once the cursor passes 60% of the window.
    if (cursor >= view.t1 - view.span && cursor > view.t1 - view.span * 0.4) {
      view.t1 = cursor + view.span * 0.4
    }
  }
  if (props.followPitch && props.recording && follow.value && !autoPitch) followVoice()
  if (props.autoZoom && props.recording && follow.value && autoPitch) goToFirstNote()
  clampView()
  const lit = litNote()
  drawRoll(lit)
  drawBand(roll.ctx)
  drawMini()
  drawKeys(lit)
  raf = requestAnimationFrame(frame)
}

// A new take goes live; a cursor moved from outside (Stop, back to the start) is brought into view.
watch(
  () => props.recording,
  (on) => {
    if (on) {
      follow.value = true
      autoPitch = true
      pitchGoal = null
    }
  },
)

watch(playhead, (cursor) => {
  if (cursor === null || props.playing) return
  if (cursor >= view.t1 - view.span && cursor <= view.t1) return
  follow.value = false
  view.t1 = cursor + view.span * 0.9
  clampView()
})

// ---- Gestures on the chart: drag, pinch per axis, wheel, the note ruler, taps ----

interface Point {
  x: number
  y: number
}

const position = (el: HTMLElement, event: { clientX: number; clientY: number }): Point => {
  const rect = el.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

type Gesture =
  | { kind: 'pan'; start: Point; x0: number; t1: number; lo: number; hi: number; moved: boolean }
  | { kind: 'ruler'; start: Point; range: number; anchor: number; moved: boolean }
  | {
      kind: 'pinch'
      span: number
      range: number
      middle: Point
      dx: number
      dy: number
      time: number
      note: number
      live: boolean
    }
  | {
      kind: 'band'
      start: Point
      /** What was chosen before, kept when ⇧ adds to it. */
      base: ReadonlySet<number>
      moved: boolean
    }
  | {
      kind: 'note'
      start: Point
      part: 'start' | 'end' | 'body'
      id: number
      /** Where the note began, beats, and the beat under the mouse when the drag began. */
      from: number
      beat: number
      moved: boolean
    }
  | { kind: 'line' }
  /** A note's handle dragged: its vibrato or how level it is. */
  | { kind: 'shape'; start: Point; handle: HandleKind; ids: ReadonlySet<number> }
  /** Along the ruler: a stretch of time chosen from `from`. */
  | { kind: 'span'; start: Point; from: number; moved: boolean }
  /** The loop's brace moved, or one of its ends. */
  | {
      kind: 'loop'
      start: Point
      part: 'from' | 'to' | 'body'
      range: { from: number; to: number }
      moved: boolean
    }
  | { kind: 'none' }

const pointers = new Map<number, Point>()
/** The editor's note under the mouse, and where the scissors would cut it, px. */
let hover: { id: number; cut: number } | null = null
/** The loose piece under the mouse. */
let hoverLoose: LoosePiece | null = null
/** The note whose handle is being dragged, and which handle. */
let shaping: { id: number; kind: HandleKind } | null = null
/** Where the mouse is over the chart, px, for showing the brush; null when it is elsewhere. */
let pointerX: number | null = null
/** The frame being drawn to choose notes, px on the chart. */
let band: { x0: number; x1: number; y0: number; y1: number } | null = null
let gesture: Gesture | null = null
let lastTap = 0
let lastTapX = 0
/** The note clicked last and when, so a second click on it soon after takes it away. */
let lastNoteTap: { id: number; time: number } | null = null

function startPinch(): void {
  const [a, b] = [...pointers.values()] as [Point, Point]
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  pinching = true
  gesture = {
    kind: 'pinch',
    span: view.span,
    range: view.hi - view.lo,
    middle,
    dx: Math.abs(a.x - b.x),
    dy: Math.abs(a.y - b.y),
    time: timeAt(middle.x),
    note: noteAt(middle.y),
    live: follow.value,
  }
}

function movePinch(g: Extract<Gesture, { kind: 'pinch' }>): void {
  const [a, b] = [...pointers.values()] as [Point, Point]
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  if (g.dx > 40) {
    view.span = clamp((g.span * g.dx) / Math.max(Math.abs(a.x - b.x), 10), SPAN_MIN, spanMax())
  }
  if (g.dy > 40) autoPitch = false
  const range =
    g.dy > 40
      ? clamp((g.range * g.dy) / Math.max(Math.abs(a.y - b.y), 10), RANGE_MIN, RANGE_MAX)
      : g.range
  view.hi = g.note + (middle.y / roll.h) * range
  view.lo = view.hi - range
  if (g.live && Math.abs(middle.x - g.middle.x) < 24) {
    follow.value = true
  } else {
    follow.value = false
    view.t1 = g.time + ((GUTTER + plotWidth() - middle.x) / plotWidth()) * view.span
  }
  clampView()
}

/** Which part of the loop's brace is at `x` on the ruler: an end, the body, or none. */
function loopPart(px: number): 'from' | 'to' | 'body' | null {
  const loop = loopRange.value
  if (loop === null) return null
  const a = xOfTime(loop.from)
  const b = xOfTime(loop.to)
  if (Math.abs(px - a) <= 6) return 'from'
  if (Math.abs(px - b) <= 6) return 'to'
  return px > a && px < b ? 'body' : null
}

/** The loop's brace dragged: moved whole, or an end stretched, by steps of the ruler. */
function moveLoop(g: Extract<Gesture, { kind: 'loop' }>, point: Point, free: boolean): void {
  if (!g.moved && Math.abs(point.x - g.start.x) > 3) g.moved = true
  if (!g.moved) return
  const shift = timeAt(point.x) - timeAt(g.start.x)
  const grid = props.grid
  const shortest = grid === null || free ? 0.1 : rulerStep() * grid.beatSeconds
  const { from, to } = g.range
  if (g.part === 'body') {
    const start = snapTime(from + shift, free)
    loopRange.value = { from: start, to: start + (to - from) }
  } else if (g.part === 'from') {
    loopRange.value = { from: Math.min(snapTime(from + shift, free), to - shortest), to }
  } else {
    loopRange.value = { from, to: Math.max(snapTime(to + shift, free), from + shortest) }
  }
}

function onPointerDown(event: PointerEvent): void {
  const el = roll.el
  // Before the chart has a size there is nothing to point at.
  if (!roll.w || !roll.h) return
  el.setPointerCapture(event.pointerId)
  const point = position(el, event)
  pointers.set(event.pointerId, point)
  if (pointers.size === 1 && point.y < RULER && point.x >= GUTTER) {
    // The ruler: the loop's brace, in its strip, moves or stretches; below it a drag chooses a
    // stretch of time; a click puts the cursor on the beat.
    dragging = true
    const part = point.y < BRACE ? loopPart(point.x) : null
    const loop = loopRange.value
    gesture =
      part !== null && loop !== null
        ? { kind: 'loop', start: point, part, range: { ...loop }, moved: false }
        : {
            kind: 'span',
            start: point,
            from: snapTime(timeAt(point.x), event.altKey),
            moved: false,
          }
    return
  }
  const grabbed = pointers.size === 1 ? handleUnder(point) : null
  if (grabbed !== null && props.editor !== null) {
    // A handle on a note: its shape — and that of the other chosen notes — follows the drag.
    const editor = props.editor
    if (!editor.selected.value.has(grabbed.note.id)) editor.select([grabbed.note.id])
    dragging = true
    shaping = { id: grabbed.note.id, kind: grabbed.kind }
    editor.beginShape()
    gesture = { kind: 'shape', start: point, handle: grabbed.kind, ids: editor.selected.value }
    return
  }
  const hit = pointers.size === 1 ? noteUnder(point) : null
  const tool = props.editor?.tool.value ?? 'select'
  const drawing = lineTool()
  const piece = hit === null && pointers.size === 1 ? looseUnder(point) : null
  if (piece !== null) {
    promote(piece)
    hoverLoose = null
    gesture = { kind: 'none' }
    return
  }
  if (drawing !== null && pointers.size === 1 && point.x >= GUTTER) {
    // A line tool: the stroke goes to the line; ⇧ turns snapping to notes the other way.
    const curve = props.curve!
    dragging = true
    curve.begin(drawing, lineFrame(point.x), noteAt(point.y), curve.snap.value !== event.shiftKey)
    gesture = { kind: 'line' }
    return
  }
  if (props.editing && props.editor !== null && pointers.size === 1 && tool === 'cut') {
    // Scissors: a click on a note cuts it there; on empty space it does nothing. Until the notes
    // are edited by hand they are read from the line, so the cut goes into the line.
    if (hit !== null) {
      const beat = cutBeat(point, event.altKey)
      const curve = props.curve
      if (curve !== null && !props.editor.edited.value) {
        curve.cutAt(lineFrame(xOfTime(timeOfBeat(beat))))
      } else {
        props.editor.cutAt(hit.note.id, beat)
      }
    }
    gesture = { kind: 'none' }
    return
  }
  if (
    hit === null &&
    tool === 'draw' &&
    props.editing &&
    props.editor !== null &&
    props.grid !== null &&
    pointers.size === 1 &&
    point.x >= GUTTER
  ) {
    // Pencil: a click draws a note, a drag to the right makes it longer.
    const editor = props.editor
    editor.add(Math.round(noteAt(point.y)), beatOfTime(timeAt(point.x)))
    const id = [...editor.selected.value][0]
    const drawn = editor.notes.value.find((note) => note.id === id)
    if (drawn !== undefined) {
      dragging = true
      editor.beginDrag()
      gesture = {
        kind: 'note',
        start: point,
        part: 'end',
        id: drawn.id,
        from: drawn.start + drawn.length,
        beat: beatOfTime(timeAt(point.x)),
        moved: false,
      }
    }
    return
  }
  if (hit !== null) {
    const editor = props.editor!
    const chosen = editor.selected.value.has(hit.note.id)
    if (event.shiftKey) editor.toggle(hit.note.id)
    else if (!chosen) editor.select([hit.note.id])
    dragging = true
    editor.beginDrag()
    gesture = {
      kind: 'note',
      start: point,
      part: hit.part,
      id: hit.note.id,
      from: hit.part === 'end' ? hit.note.start + hit.note.length : hit.note.start,
      beat: beatOfTime(timeAt(point.x)),
      moved: false,
    }
    el.style.cursor = hit.part === 'body' ? 'grabbing' : 'ew-resize'
    return
  }
  if (
    pointers.size === 1 &&
    props.editing &&
    props.editor !== null &&
    tool !== 'hand' &&
    point.x >= GUTTER
  ) {
    // While editing, a drag over empty space draws a frame that chooses the notes it touches.
    dragging = true
    gesture = {
      kind: 'band',
      start: point,
      base: event.shiftKey ? props.editor.selected.value : new Set(),
      moved: false,
    }
    return
  }
  if (pointers.size === 1) {
    dragging = true
    gesture =
      point.x < GUTTER
        ? {
            kind: 'ruler',
            start: point,
            range: view.hi - view.lo,
            anchor: noteAt(point.y),
            moved: false,
          }
        : {
            kind: 'pan',
            start: point,
            x0: point.x,
            t1: view.t1,
            lo: view.lo,
            hi: view.hi,
            moved: false,
          }
    if (gesture.kind === 'pan') el.style.cursor = 'grabbing'
  } else if (pointers.size === 2) {
    startPinch()
  } else {
    gesture = { kind: 'none' }
  }
}

function onPointerMove(event: PointerEvent): void {
  const el = roll.el
  const point = position(el, event)
  pointerX = point.x
  if (!pointers.has(event.pointerId)) {
    if (point.y < RULER && point.x >= GUTTER) {
      hover = null
      const part = point.y < BRACE ? loopPart(point.x) : null
      el.style.cursor = part === 'body' ? 'grab' : part !== null ? 'ew-resize' : 'text'
      return
    }
    if (handleUnder(point) !== null) {
      el.style.cursor = 'ns-resize'
      return
    }
    const under = noteUnder(point)
    hoverLoose = under === null ? looseUnder(point) : null
    if (hoverLoose !== null) {
      hover = null
      el.style.cursor = 'copy'
      return
    }
    const tool = props.editor?.tool.value ?? 'select'
    if (lineTool() !== null) {
      hover = null
      el.style.cursor = point.x < GUTTER ? 'ns-resize' : 'crosshair'
      return
    }
    hover =
      under === null
        ? null
        : { id: under.note.id, cut: xOfTime(timeOfBeat(cutBeat(point, event.altKey))) }
    el.style.cursor =
      under !== null
        ? tool === 'cut'
          ? 'col-resize'
          : under.part === 'body'
            ? 'move'
            : 'ew-resize'
        : point.x < GUTTER
          ? 'ns-resize'
          : props.editing && tool !== 'hand'
            ? tool === 'cut'
              ? 'default'
              : 'crosshair'
            : 'grab'
    return
  }
  pointers.set(event.pointerId, point)
  const g = gesture
  if (g === null || g.kind === 'none') return
  if (g.kind === 'note') {
    moveNote(g, point, event.altKey)
    return
  }
  if (g.kind === 'shape') {
    const delta = (g.start.y - point.y) / HANDLE_PIXELS
    props.editor?.dragShape(g.ids, (shape) =>
      g.handle === 'vibrato'
        ? { ...shape, vibratoScale: clamp(shape.vibratoScale + delta, 0, VIBRATO_MAX) }
        : { ...shape, flatness: clamp(shape.flatness + delta, 0, 1) },
    )
    return
  }
  if (g.kind === 'loop') {
    moveLoop(g, point, event.altKey)
    return
  }
  if (g.kind === 'span') {
    if (!g.moved && Math.abs(point.x - g.start.x) > 4) g.moved = true
    if (!g.moved) return
    const at = snapTime(timeAt(point.x), event.altKey)
    selection.value =
      at === g.from ? null : { from: Math.min(g.from, at), to: Math.max(g.from, at) }
    return
  }
  if (g.kind === 'line') {
    const curve = props.curve
    curve?.move(lineFrame(point.x), noteAt(point.y), curve.snap.value !== event.shiftKey)
    return
  }
  if (g.kind === 'band') {
    if (!g.moved && Math.hypot(point.x - g.start.x, point.y - g.start.y) > 4) g.moved = true
    if (!g.moved) return
    band = {
      x0: Math.min(g.start.x, point.x),
      x1: Math.max(g.start.x, point.x),
      y0: Math.min(g.start.y, point.y),
      y1: Math.max(g.start.y, point.y),
    }
    const inside = new Set(
      noteBoxes()
        .filter(
          (box) =>
            box.note !== null &&
            box.x1 >= band!.x0 &&
            box.x0 <= band!.x1 &&
            box.y1 >= band!.y0 &&
            box.y0 <= band!.y1,
        )
        .map((box) => box.note!.id),
    )
    props.editor?.selectWhere((note) => inside.has(note.id), g.base)
    return
  }
  if (g.kind === 'pinch') {
    movePinch(g)
    return
  }
  const dy = point.y - g.start.y
  if (!g.moved && Math.hypot(point.x - g.start.x, dy) > 6) g.moved = true
  if (!g.moved) return
  if (g.kind === 'ruler') {
    autoPitch = false
    const range = clamp(g.range * Math.exp(dy * 0.012), RANGE_MIN, RANGE_MAX)
    view.hi = g.anchor + (g.start.y / roll.h) * range
    view.lo = view.hi - range
    clampView()
    return
  }
  const range = g.hi - g.lo
  if (Math.abs(dy) > 6) autoPitch = false
  view.hi = g.hi + (dy / roll.h) * range
  view.lo = view.hi - range
  if (!follow.value) {
    view.t1 = g.t1 - ((point.x - g.x0) / plotWidth()) * view.span
    clampView()
    refollow()
  } else if (Math.abs(point.x - g.x0) > 10) {
    follow.value = false
    g.t1 = view.t1
    g.x0 = point.x
  }
  clampView()
}

/**
 * A note dragged: its body moves by grid steps and semitones, an edge snaps to the grid. With
 * Alt held it moves freely.
 */
function moveNote(g: Extract<Gesture, { kind: 'note' }>, point: Point, free: boolean): void {
  const editor = props.editor
  if (editor === null) return
  if (!g.moved && Math.hypot(point.x - g.start.x, point.y - g.start.y) > 3) g.moved = true
  if (!g.moved) return
  const step = free ? 0 : editor.snap.value
  const beat = beatOfTime(timeAt(point.x))
  const target = snapBeat(g.from + (beat - g.beat), step)
  if (g.part === 'body') {
    const semitones = Math.round(noteAt(point.y) - noteAt(g.start.y))
    editor.dragMove(target - g.from, semitones)
  } else {
    editor.dragResize(g.id, g.part, target)
  }
}

function onPointerUp(event: PointerEvent): void {
  if (!pointers.has(event.pointerId)) return
  const point = position(roll.el, event)
  pointers.delete(event.pointerId)
  const g = gesture
  if (g !== null && g.kind === 'line') props.curve?.end()
  if (g !== null && g.kind === 'shape') {
    props.editor?.endShape()
    shaping = null
  }
  if (g !== null && (g.kind === 'span' || g.kind === 'loop') && !g.moved) {
    // A click on the ruler: the cursor on the beat, nothing chosen.
    selection.value = null
    if (frames > 0) playhead.value = snapTime(timeAt(point.x), event.altKey)
  }
  if (g !== null && g.kind === 'note') {
    const editor = props.editor
    editor?.endDrag()
    if (!g.moved) {
      const now = performance.now()
      if (lastNoteTap?.id === g.id && now - lastNoteTap.time < DOUBLE_TAP_MS && !event.shiftKey) {
        // A double click on a note: with the pencil it goes, with the arrow it is made level —
        // or, when it is, back as sung.
        if (editor?.tool.value === 'draw') editor.remove(g.id)
        else editor?.toggleLevel(new Set([g.id]))
        lastNoteTap = null
      } else {
        lastNoteTap = { id: g.id, time: now }
        if (!event.shiftKey) editor?.select([g.id])
        // A click on a note also puts the cursor there, where S cuts it.
        if (frames > 0) playhead.value = clamp(timeAt(point.x), t0, Math.max(end, timeAt(point.x)))
      }
    } else {
      lastNoteTap = null
    }
  }
  if (
    g !== null &&
    (g.kind === 'pan' || g.kind === 'ruler' || g.kind === 'band') &&
    !g.moved &&
    event.type === 'pointerup'
  ) {
    const now = performance.now()
    const editor = props.editing ? props.editor : null
    if (now - lastTap < DOUBLE_TAP_MS && Math.abs(point.x - lastTapX) < 30) {
      // While editing, a double click on an empty spot draws a note there.
      if (editor !== null && props.grid !== null && g.kind === 'band' && point.x >= GUTTER) {
        editor.add(Math.round(noteAt(point.y)), beatOfTime(timeAt(point.x)))
      } else {
        fitVoice()
      }
      lastTap = 0
    } else {
      lastTap = now
      lastTapX = point.x
      if (editor !== null && editor.tool.value !== 'hand' && !event.shiftKey) {
        editor.clearSelection()
      }
      selection.value = null
      if (point.x >= GUTTER && frames > 0) {
        follow.value = false
        playhead.value = clamp(snapTime(timeAt(point.x), event.altKey), t0, end)
      }
    }
  }
  band = null
  if (pointers.size === 0) {
    gesture = null
    dragging = false
    pinching = false
  } else {
    gesture = { kind: 'none' }
  }
  roll.el.style.cursor = 'grab'
}

function onWheel(event: WheelEvent): void {
  event.preventDefault()
  if (!roll.w || !roll.h) return
  const point = position(roll.el, event)
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? roll.h : 1
  let dx = event.deltaX * scale
  let dy = event.deltaY * scale
  if (event.ctrlKey || event.metaKey) {
    zoomTime(Math.exp(clamp(dy, -50, 50) * 0.01), point.x)
  } else if (event.altKey) {
    zoomNotes(Math.exp(clamp(dy, -50, 50) * 0.01), point.y)
  } else {
    if (event.shiftKey && !dx) {
      dx = dy
      dy = 0
    }
    if (dx) panTime((dx / plotWidth()) * view.span)
    if (dy) panNotes((-dy / roll.h) * (view.hi - view.lo))
  }
}

// Safari on a Mac sends trackpad pinches as gesture events, not ctrl + wheel.
interface SafariGesture extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}
let safariPinch: { span: number; x: number } | null = null

function onGestureStart(event: Event): void {
  event.preventDefault()
  safariPinch =
    pointers.size > 1 ? null : { span: view.span, x: position(roll.el, event as SafariGesture).x }
}

function onGestureChange(event: Event): void {
  event.preventDefault()
  if (safariPinch === null || pointers.size > 1) return
  zoomTime(safariPinch.span / (event as SafariGesture).scale / view.span, safariPinch.x)
}

function onGestureEnd(event: Event): void {
  event.preventDefault()
  safariPinch = null
}

// ---- The bars: move the frame, stretch its edges, tap outside to jump, double tap to fit ----

type Grab = (point: Point) => void

function which(at: number, from: number, to: number): 'from' | 'to' | 'inside' | 'outside' {
  const narrow = to - from < 40
  if (narrow ? at >= from - 18 && at <= from + 2 : Math.abs(at - from) <= 12) return 'from'
  if (narrow ? at >= to - 2 && at <= to + 18 : Math.abs(at - to) <= 12) return 'to'
  return at > from && at < to ? 'inside' : 'outside'
}

let miniTap = 0
function grabMini(point: Point): Grab | null {
  const now = performance.now()
  if (now - miniTap < DOUBLE_TAP_MS) {
    miniTap = 0
    wholeTake()
    return null
  }
  miniTap = now
  const world = worldRight() - t0
  const seconds = (px: number) => t0 + (px / mini.w) * world
  const part = which(
    point.x,
    ((view.t1 - view.span - t0) / world) * mini.w,
    ((view.t1 - t0) / world) * mini.w,
  )
  if (part === 'from') {
    return (next) => {
      const start = Math.max(t0, seconds(next.x))
      view.span = follow.value ? (end - start) / (1 - props.ahead) : view.t1 - start
      clampView()
    }
  }
  if (part === 'to') {
    return (next) => {
      const start = view.t1 - view.span
      const stop = Math.max(start + SPAN_MIN, seconds(next.x))
      follow.value = false
      view.t1 = stop
      view.span = stop - start
      clampView()
      refollow()
    }
  }
  if (part === 'outside') {
    follow.value = false
    view.t1 = seconds(point.x) + view.span / 2
    clampView()
    refollow()
  }
  const right = view.t1
  return (next) => {
    follow.value = false
    view.t1 = right + ((next.x - point.x) / mini.w) * world
    clampView()
    refollow()
  }
}

let keysTap = 0
function grabKeys(point: Point): Grab | null {
  autoPitch = false
  const now = performance.now()
  if (now - keysTap < DOUBLE_TAP_MS) {
    keysTap = 0
    allNotes()
    return null
  }
  keysTap = now
  const part = which(point.y, keyY(view.hi), keyY(view.lo))
  if (part === 'from') {
    return (next) => {
      view.hi = Math.max(view.lo + RANGE_MIN, keyNote(next.y))
      clampView()
    }
  }
  if (part === 'to') {
    return (next) => {
      view.lo = Math.min(view.hi - RANGE_MIN, keyNote(next.y))
      clampView()
    }
  }
  if (part === 'outside') {
    const range = view.hi - view.lo
    const middle = keyNote(point.y)
    view.lo = middle - range / 2
    view.hi = middle + range / 2
    clampView()
  }
  const lo = view.lo
  const hi = view.hi
  return (next) => {
    const shift = keyNote(point.y) - keyNote(next.y)
    view.lo = lo - shift
    view.hi = hi - shift
    clampView()
  }
}

function track(el: HTMLCanvasElement, grab: (point: Point) => Grab | null): () => void {
  let move: Grab | null = null
  const down = (event: PointerEvent) => {
    move = grab(position(el, event))
    if (move !== null) {
      el.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
  }
  const drag = (event: PointerEvent) => move?.(position(el, event))
  const up = () => {
    move = null
  }
  el.addEventListener('pointerdown', down)
  el.addEventListener('pointermove', drag)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
  return () => {
    el.removeEventListener('pointerdown', down)
    el.removeEventListener('pointermove', drag)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
  }
}

// ---- Setup ----

const scheme = window.matchMedia('(prefers-color-scheme: dark)')
const cleanups: (() => void)[] = []

function mount(surface: Surface, el: HTMLCanvasElement): void {
  surface.el = el
  surface.ctx = el.getContext('2d')!
  const observer = new ResizeObserver(() => {
    const rect = el.getBoundingClientRect()
    dpr = window.devicePixelRatio || 1
    surface.w = rect.width
    surface.h = rect.height
    el.width = Math.round(rect.width * dpr)
    el.height = Math.round(rect.height * dpr)
  })
  observer.observe(el)
  el.addEventListener('contextmenu', (event) => event.preventDefault())
  cleanups.push(() => observer.disconnect())
}

onMounted(() => {
  readPalette()
  mount(roll, rollEl.value!)
  mount(mini, miniEl.value!)
  mount(keys, keysEl.value!)
  const el = roll.el
  const listeners: [string, EventListener, AddEventListenerOptions?][] = [
    ['pointerdown', onPointerDown as EventListener],
    ['pointermove', onPointerMove as EventListener],
    ['pointerup', onPointerUp as EventListener],
    ['pointercancel', onPointerUp as EventListener],
    [
      'pointerleave',
      () => {
        hover = null
        pointerX = null
      },
    ],
    ['wheel', onWheel as EventListener, { passive: false }],
    ['gesturestart', onGestureStart],
    ['gesturechange', onGestureChange],
    ['gestureend', onGestureEnd],
  ]
  for (const [name, listener, options] of listeners) el.addEventListener(name, listener, options)
  cleanups.push(() => {
    for (const [name, listener] of listeners) el.removeEventListener(name, listener)
  })
  cleanups.push(track(mini.el, grabMini), track(keys.el, grabKeys))
  scheme.addEventListener('change', readPalette)
  cleanups.push(() => scheme.removeEventListener('change', readPalette))
  raf = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  for (const cleanup of cleanups) cleanup()
})

defineExpose({
  /** The part of the take in view, trace-clock seconds. */
  window: () => ({ from: Math.max(t0, view.t1 - view.span), to: Math.min(view.t1, end) }),
  fitVoice,
  wholeTake,
  showRange,
  showPitch,
})
</script>

<template>
  <div ref="root" class="take">
    <div class="take__roll">
      <canvas ref="rollEl" class="take__canvas" role="img" :aria-label="label" />
      <button
        v-if="!follow"
        type="button"
        class="take__live"
        title="К последнему спетому"
        @click="goLive"
      >
        <PhArrowRight :size="13" weight="bold" aria-hidden="true" />
        Live
      </button>
    </div>
    <canvas
      ref="keysEl"
      class="take__keys"
      role="img"
      aria-label="Все ноты: рамка — видимый диапазон, полосы — сколько пелась каждая нота"
    />
    <canvas
      ref="miniEl"
      class="take__mini"
      role="img"
      aria-label="Вся запись: рамка — видимое окно"
    />
  </div>
</template>

<style scoped>
.take {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 26px;
  grid-template-rows: var(--take-height, clamp(15rem, 52vh, 22rem)) 40px;
  gap: 8px;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.take__roll {
  position: relative;
  min-width: 0;
  height: 100%;
}

.take__canvas,
.take__keys,
.take__mini {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.take__canvas {
  border-radius: var(--radius-core);
  background: var(--bg);
  box-shadow: 0 0 0 1px var(--line);
  cursor: grab;
}

.take__keys,
.take__mini {
  border-radius: 10px;
  background: var(--bg-inset);
}

.take__mini {
  grid-column: 1 / -1;
}

.take__live {
  position: absolute;
  top: 10px;
  right: 14px;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  height: 2.1rem;
  padding: 0 0.85rem;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-ink);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 14px rgb(0 0 0 / 18%);
}

.take__live:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
