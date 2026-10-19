<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { brushWidth, strokeBrush, type BrushPoint } from '@/components/pitch/brush'
import type { TakeNote, TakeSource } from '@/components/pitch/inkTake'

/**
 * The instrument: a sheet of paper where the notes to sing drift from the right towards a line
 * that stands still, a third of the way in. The voice lives on that line as the head of a brush
 * stroke; what has been sung stays to the left in ink, what is to come waits on the right in gold.
 * Nothing is written on the sheet while singing: the stroke itself says how it goes, full and
 * dark on the note, a hair off it, and the gold under the head glows when the voice sits on it.
 *
 * As a card, the whole take is laid out across the sheet, the line gone.
 */
const props = withDefaults(
  defineProps<{
    source: TakeSource
    /** The notes to sing, trace-clock seconds. */
    target: readonly TakeNote[]
    /** The moment on the line, trace-clock seconds. */
    now: number
    /** Seconds of notes to come visible right of the line. */
    ahead?: number
    /** Live: the sheet drifts; card: the take whole. */
    mode?: 'live' | 'card'
    /** The take's span for the card, trace-clock seconds. */
    span?: { readonly from: number; readonly to: number } | null
    /** Draw the voice; off while the phrase only plays. */
    voice?: boolean
    font?: string
    label?: string
  }>(),
  {
    ahead: 4,
    mode: 'live',
    span: null,
    voice: true,
    font: 'Georgia, serif',
    label: 'Ноты и голос',
  },
)

const NAMES = ['до', 'до♯', 'ре', 'ми♭', 'ми', 'фа', 'фа♯', 'соль', 'ля♭', 'ля', 'си♭', 'си']
/** Lanes at least: an octave with a semitone to spare either side. */
const MIN_LANES = 14
/** A quarter tone either side of a note counts as the note. */
const BAND = 0.25
/** Frames further apart than this are a jump, not a slide, semitones. */
const JUMP = 2
const GUTTER = 46
/** Where the line stands, as a share of the sheet's width right of the names. */
const LINE_AT = 0.34

const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let width = 0
let height = 0
let raf = 0
let midi = new Float32Array(4096)
let level = new Float32Array(4096)

const palette = { ink: '23,21,15', muted: '#7a746a', paper: '#ece8df', gold: '#c79a2a' }
const ink = (alpha = 1) => `rgba(${palette.ink},${alpha})`

let paper: HTMLCanvasElement | null = null
function makePaper(w: number, h: number, dpr: number): void {
  const p = document.createElement('canvas')
  p.width = Math.max(1, Math.round(w * dpr))
  p.height = Math.max(1, Math.round(h * dpr))
  const c = p.getContext('2d')!
  c.fillStyle = palette.paper
  c.fillRect(0, 0, p.width, p.height)
  const image = c.getImageData(0, 0, p.width, p.height)
  const d = image.data
  let s = 3
  for (let i = 0; i < d.length; i += 4) {
    s = (s * 16807) % 2147483647
    const n = (s / 2147483647 - 0.5) * 12
    d[i]! += n
    d[i + 1]! += n
    d[i + 2]! += n
  }
  c.putImageData(image, 0, 0)
  paper = p
}

/** Frames of `[from, to]` seconds into `midi` and `level`: how many, and the first's index. */
function read(from: number, to: number): { count: number; begin: number } {
  const total = props.source.length()
  if (total === 0) return { count: 0, begin: 0 }
  const rate = props.source.frameRate()
  const first = props.source.timeOf(0)
  const begin = Math.max(0, Math.floor((from - first) * rate))
  const end = Math.min(total, Math.max(begin, Math.ceil((to - first) * rate)))
  const count = end - begin
  if (midi.length < count) {
    midi = new Float32Array(count * 2)
    level = new Float32Array(count * 2)
  }
  props.source.read(begin, end, midi, level)
  return { count, begin }
}

function draw(): void {
  if (ctx === null || width === 0) return
  const c = ctx
  const { target } = props
  if (paper !== null) c.drawImage(paper, 0, 0, width, height)
  if (target.length === 0) return
  const rate = props.source.frameRate()
  const first = props.source.timeOf(0)

  // The view: the target's notes with a semitone to spare, an octave at least.
  const lowest = Math.round(Math.min(...target.map((n) => n.midi)))
  const highest = Math.round(Math.max(...target.map((n) => n.midi)))
  const lanes = Math.max(MIN_LANES, highest - lowest + 3)
  const low = lowest - 1 - Math.floor((lanes - (highest - lowest + 3)) / 2)
  const top = 24
  const bottom = height - 18
  const lane = (bottom - top) / lanes
  const y = (value: number) => bottom - (value - low + 0.5) * lane
  const clampY = (value: number) => y(Math.min(low + lanes - 0.5, Math.max(low - 0.5, value)))

  // Time across the sheet: live, the line stands and time drifts past it; as a card, the take whole.
  const live = props.mode === 'live'
  const right = width - 10
  const lineX = GUTTER + (right - GUTTER) * LINE_AT
  const perSecond = (right - lineX) / props.ahead
  const from = live ? props.now - (lineX - GUTTER) / perSecond : (props.span?.from ?? first)
  const to = live
    ? props.now + props.ahead
    : (props.span?.to ?? (target[target.length - 1]?.end ?? first) + 0.5)
  const x = live
    ? (t: number) => lineX + (t - props.now) * perSecond
    : (t: number) => GUTTER + ((t - from) / Math.max(0.1, to - from)) * (right - GUTTER)

  // The steps: a faint line per semitone; the target's notes named.
  const named = new Set(target.map((n) => Math.round(n.midi)))
  c.lineWidth = 1
  for (let note = low; note < low + lanes; note++) {
    const ly = y(note)
    const isNamed = named.has(note)
    c.strokeStyle = ink()
    c.globalAlpha = isNamed ? 0.2 : 0.07
    c.beginPath()
    c.moveTo(GUTTER, ly)
    c.lineTo(right, ly)
    c.stroke()
    if (isNamed) {
      c.globalAlpha = 0.9
      c.fillStyle = palette.muted
      c.font = `${Math.min(17, lane * 0.62)}px ${props.font}`
      c.textAlign = 'right'
      c.textBaseline = 'middle'
      c.fillText(NAMES[((note % 12) + 12) % 12]!, GUTTER - 10, ly)
    }
  }

  // The voice: the frames on the sheet, as one stroke per breath, open at the line while live.
  const sung = props.voice
    ? read(Math.max(from, first), live ? props.now : to)
    : { count: 0, begin: 0 }
  const voiceAt = (t: number): number => {
    const i = Math.round((t - first) * rate) - sung.begin
    return i >= 0 && i < sung.count ? (midi[i] ?? NaN) : NaN
  }

  // The notes to come and those sung: gold bands, glowing under the head while the voice sits on them.
  for (const note of target) {
    if (note.end < from || note.start > to) continue
    const x0 = Math.max(GUTTER, x(note.start))
    const x1 = Math.min(right, x(note.end))
    if (x1 <= x0) continue
    const onIt =
      live &&
      props.now >= note.start &&
      props.now <= note.end &&
      Math.abs(voiceAt(props.now) - note.midi) <= BAND
    c.fillStyle = palette.gold
    c.globalAlpha = onIt ? 0.6 : 0.28
    c.fillRect(x0, y(note.midi + BAND), x1 - x0, y(note.midi - BAND) - y(note.midi + BAND))
  }
  c.globalAlpha = 1

  const w = brushWidth(lane)
  let run: BrushPoint[] = []
  let seed = 0
  const flush = (open = false) => {
    if (run.length >= 3) strokeBrush(c, run, w, ink(), seed++, open)
    run = []
  }
  const step = Math.max(1, Math.floor(sung.count / ((right - GUTTER) * 1.5)))
  let last: { value: number; t: number } | null = null
  for (let i = 0; i < sung.count; i += step) {
    const value = midi[i] ?? NaN
    const t = first + (sung.begin + i) / rate
    if (!Number.isFinite(value) || (last !== null && Math.abs(value - last.value) > JUMP)) {
      flush()
      last = null
      if (!Number.isFinite(value)) continue
    }
    const aimed = target.find((note) => t >= note.start && t <= note.end)
    const off = aimed ? Math.abs(value - aimed.midi) : Math.abs(value - Math.round(value))
    run.push({ x: x(t), y: clampY(value), off: Math.min(1, off * 2) })
    last = { value, t }
  }
  const singing = live && last !== null && props.now - last.t < 0.2
  flush(singing)

  if (live) {
    // The line that stands, and the head of the stroke on it.
    c.strokeStyle = ink()
    c.globalAlpha = 0.35
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(lineX, top - 10)
    c.lineTo(lineX, bottom + 10)
    c.stroke()
    c.globalAlpha = 1
    if (singing && last !== null) {
      const aimed = target.find((note) => last!.t >= note.start && last!.t <= note.end)
      const off = aimed ? Math.abs(last.value - aimed.midi) : 1
      c.fillStyle = ink()
      c.beginPath()
      c.arc(lineX, clampY(last.value), w * (off <= BAND ? 1.15 : 0.7), 0, Math.PI * 2)
      c.fill()
    }
  }
}

function resize(): void {
  const el = canvas.value
  if (el === null) return
  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  width = rect.width
  height = rect.height
  el.width = Math.round(width * dpr)
  el.height = Math.round(height * dpr)
  ctx = el.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  makePaper(width, height, dpr)
  draw()
}

function frame(): void {
  draw()
  if (props.mode === 'live') raf = requestAnimationFrame(frame)
}

let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(resize)
  if (canvas.value) observer.observe(canvas.value)
  resize()
  frame()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  observer?.disconnect()
})
watch(
  () => [props.mode, props.now, props.target, props.span, props.source, props.voice],
  () => {
    cancelAnimationFrame(raf)
    frame()
  },
)

defineExpose({ redraw: draw })
</script>

<template>
  <div ref="root" class="ink">
    <canvas ref="canvas" class="ink__canvas" role="img" :aria-label="label" />
  </div>
</template>

<style scoped>
.ink {
  position: relative;
  width: 100%;
  height: 100%;
}
.ink__canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
