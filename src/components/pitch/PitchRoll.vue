<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loudnessColorTable } from '@/components/loudness'
import { noteName } from '@/training/keys'
import type { PitchTarget, PitchTrace } from './trace'

const props = withDefaults(
  defineProps<{
    /** Recent frames, oldest first: pitch and loudness of what is being sung. */
    trace: PitchTrace
    /** Lowest MIDI note drawn as a lane. */
    low: number
    /** Highest MIDI note drawn as a lane. */
    high: number
    /** Seconds of history left of now. */
    seconds?: number
    /** Seconds right of now, where upcoming targets come in. */
    ahead?: number
    /** Notes on the trace clock: alike blocks on their lanes, behind the band. */
    targets?: readonly PitchTarget[]
    /**
     * Now on the trace clock while there are no frames to take it from (the microphone is off), so
     * targets can still move. With frames, the newest frame is now.
     */
    now?: number
    label?: string
  }>(),
  {
    seconds: 6,
    ahead: 0,
    targets: () => [],
    now: undefined,
    label: 'Высота звука во времени',
  },
)

/** Width reserved for note names on the left, px. */
const GUTTER = 36
/** Room for the head of the band on the right, px. */
const HEAD_ROOM = 10
/** Consecutive frames further apart than this are a jump, not a slide, and are not joined. */
const MAX_JOIN_SEMITONES = 2
/** How long the lit lane keeps following the last sung note, seconds. */
const CURRENT_HOLD_SECONDS = 0.15
/** Frames above or below the range run along that edge as a thin rail, px from the edge. */
const RAIL_INSET = 2
const RAIL_WIDTH = 2
/** Band thickness, px: still readable on a wide range, not bloated on a narrow one. */
const MIN_THICKNESS = 3
const MAX_THICKNESS = 12
/** Lane height from which every note is named, and from which the naturals still are, px. */
const LABEL_ALL_LANE = 11
const LABEL_NATURALS_LANE = 7
const BLACK_KEYS = new Set([1, 3, 6, 8, 10])

type Side = 'above' | 'below'
type Naming = 'all' | 'naturals' | 'octaves'

const root = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)

const palette = { ink: '#eceae4', muted: '#9aa0a8', font: 'sans-serif' }
/** Loudness colours from silence to full, resolved from the theme for canvas. */
let loudnessColors: string[] = []
const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
let width = 0
let height = 0
let ratio = 1
let resizeObserver: ResizeObserver | null = null

function readPalette(): void {
  const element = root.value
  if (element === null) return
  const style = getComputedStyle(element)
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  palette.ink = pick('--ink', palette.ink)
  palette.muted = pick('--muted', palette.muted)
  palette.font = pick('--font', palette.font)
  loudnessColors = loudnessColorTable((token) => style.getPropertyValue(token))
}

function resize(): void {
  const element = canvas.value
  if (element === null) return
  const rect = element.getBoundingClientRect()
  ratio = window.devicePixelRatio || 1
  width = rect.width
  height = rect.height
  element.width = Math.round(width * ratio)
  element.height = Math.round(height * ratio)
  draw()
}

function onSchemeChange(): void {
  readPalette()
  draw()
}

function loudnessColor(level: number): string {
  const loud = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
  return loudnessColors[Math.round(loud * (loudnessColors.length - 1))] ?? palette.muted
}

/** The same colour fully transparent, so gradients fade without darkening. */
function clear(color: string): string {
  return color.startsWith('rgb(')
    ? color.replace('rgb(', 'rgba(').replace(')', ', 0)')
    : 'rgba(0, 0, 0, 0)'
}

/** The note sung a moment ago, rounded to its lane, with its loudness; null during silence. */
function currentNote(trace: PitchTrace): { note: number; level: number } | null {
  const oldest = Math.max(0, trace.length - Math.ceil(CURRENT_HOLD_SECONDS * trace.frameRate))
  for (let i = trace.length - 1; i >= oldest; i--) {
    const midi = trace.midi[i]
    if (midi !== undefined && Number.isFinite(midi)) {
      return { note: Math.round(midi), level: trace.level[i] ?? 0 }
    }
  }
  return null
}

/** Which notes get a name, from how much room a lane has. */
function namingFor(lane: number): Naming {
  if (lane >= LABEL_ALL_LANE) return 'all'
  if (lane >= LABEL_NATURALS_LANE) return 'naturals'
  return 'octaves'
}

/**
 * The sung note is off the chart: a soft glow hugging that edge around the head of the band and a
 * small chevron pointing the way.
 */
function drawEdgeCue(
  context: CanvasRenderingContext2D,
  side: Side,
  x: number,
  color: string,
): void {
  const edge = side === 'above' ? 0 : height
  const glowRadius = 18
  context.save()
  context.translate(x, edge)
  context.scale(5, 1)
  const glow = context.createRadialGradient(0, 0, 0, 0, 0, glowRadius)
  glow.addColorStop(0, color)
  glow.addColorStop(1, clear(color))
  context.globalAlpha = 0.35
  context.fillStyle = glow
  context.beginPath()
  context.arc(0, 0, glowRadius, 0, Math.PI * 2)
  context.fill()
  context.restore()

  const size = 4.5
  const tip = side === 'above' ? 4 : height - 4
  const back = side === 'above' ? tip + size : tip - size
  context.globalAlpha = 1
  context.strokeStyle = color
  context.lineWidth = 2
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.shadowColor = color
  context.shadowBlur = 8
  context.beginPath()
  context.moveTo(x - size, back)
  context.lineTo(x, tip)
  context.lineTo(x + size, back)
  context.stroke()
  context.shadowBlur = 0
}

function draw(): void {
  const context = canvas.value?.getContext('2d')
  if (context === undefined || context === null || width === 0 || height === 0) return

  // The note axis is flexible: the range shares the chart's height, so a narrow range gets wide
  // lanes and a wide one gets tight lanes, and everything below scales from the lane.
  const low = Math.round(Math.min(props.low, props.high))
  const high = Math.round(Math.max(props.low, props.high))
  const lane = height / (high - low + 1)
  const thickness = Math.min(MAX_THICKNESS, Math.max(MIN_THICKNESS, lane * 0.55))
  const right = width - HEAD_ROOM
  const plotWidth = Math.max(0, right - GUTTER)
  const ahead = Math.max(0, props.ahead)
  const perSecond = plotWidth / Math.max(0.001, props.seconds + ahead)
  /** Where the newest frame sits; the chart right of it is the future. */
  const nowX = GUTTER + props.seconds * perSecond
  const { trace } = props
  /** Now on the trace clock: the newest frame, or `now` from outside when there are no frames. */
  const now = trace.length > 0 ? trace.endTime : props.now
  const frames = Math.max(1, props.seconds * trace.frameRate)
  const yOf = (midi: number) => (high + 0.5 - midi) * lane
  const xOf = (index: number) => nowX - ((trace.length - 1 - index) / trace.frameRate) * perSecond
  /** Rail height for a frame outside the range, or null inside it. */
  const railOf = (midi: number): number | null => {
    if (midi > high + 0.5) return RAIL_INSET
    if (midi < low - 0.5) return height - RAIL_INSET
    return null
  }
  const sung = currentNote(trace)
  const sungColor = sung === null ? palette.muted : loudnessColor(sung.level)
  const offChart: Side | null =
    sung === null ? null : sung.note > high ? 'above' : sung.note < low ? 'below' : null

  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.globalCompositeOperation = 'source-over'
  context.globalAlpha = 1
  context.clearRect(0, 0, width, height)

  // Notes first, so the band draws over them: blocks centred on their lanes, all alike. They are
  // placed on the trace clock, so they need a now to hang from.
  if (now !== undefined) {
    const xOfTime = (seconds: number) => nowX - (now - seconds) * perSecond
    const blockHeight = Math.min(lane * 0.76, thickness + 10)
    for (const target of props.targets) {
      const note = Math.round(target.midi)
      if (note < low || note > high) continue
      const from = Math.max(GUTTER, xOfTime(target.start))
      const to = Math.min(width, xOfTime(target.end))
      if (to <= from) continue
      context.beginPath()
      context.roundRect(
        from,
        yOf(note) - blockHeight / 2,
        to - from,
        blockHeight,
        blockHeight * 0.4,
      )
      context.globalAlpha = 0.16
      context.fillStyle = palette.ink
      context.fill()
      context.globalAlpha = 0.35
      context.strokeStyle = palette.ink
      context.lineWidth = 1
      context.stroke()
    }
  }

  // The sung band: one round-capped stroke per frame, coloured by its loudness. Stretches outside
  // the range become a faint rail along the edge they left through.
  context.lineCap = 'round'
  let head: { x: number; y: number; color: string } | null = null
  for (let i = Math.max(1, Math.floor(trace.length - frames)); i < trace.length; i++) {
    const from = trace.midi[i - 1]
    const to = trace.midi[i]
    if (from === undefined || to === undefined) continue
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    if (Math.abs(to - from) > MAX_JOIN_SEMITONES) continue
    const color = loudnessColor(trace.level[i] ?? 0)
    const fromRail = railOf(from)
    const toRail = railOf(to)
    context.strokeStyle = color
    context.beginPath()
    if (fromRail !== null && fromRail === toRail) {
      context.globalAlpha = 0.55
      context.lineWidth = RAIL_WIDTH
      context.moveTo(xOf(i - 1), fromRail)
      context.lineTo(xOf(i), toRail)
    } else {
      context.globalAlpha = 1
      context.lineWidth = thickness
      context.moveTo(xOf(i - 1), yOf(from))
      context.lineTo(xOf(i), yOf(to))
    }
    context.stroke()
    if (i === trace.length - 1 && toRail === null) head = { x: xOf(i), y: yOf(to), color }
  }
  context.globalAlpha = 1

  // History fades out towards the note names; the future stays clear and the gutter ends up empty.
  context.globalCompositeOperation = 'destination-in'
  const fade = context.createLinearGradient(GUTTER, 0, nowX, 0)
  fade.addColorStop(0, 'rgba(0, 0, 0, 0)')
  fade.addColorStop(0.3, 'rgba(0, 0, 0, 0.5)')
  fade.addColorStop(1, 'rgba(0, 0, 0, 1)')
  context.fillStyle = fade
  context.fillRect(0, 0, width, height)

  // Lanes go behind everything and stay barely there: black keys a shade darker, a hairline under
  // every C, the lane of the sung note lit in the colour of its loudness.
  context.globalCompositeOperation = 'destination-over'
  for (let note = low; note <= high; note++) {
    const top = (high - note) * lane
    const pitchClass = ((note % 12) + 12) % 12
    if (note === sung?.note) {
      context.globalAlpha = 0.14
      context.fillStyle = sungColor
      context.fillRect(GUTTER, top, plotWidth + HEAD_ROOM, lane)
    } else if (BLACK_KEYS.has(pitchClass)) {
      context.globalAlpha = 0.035
      context.fillStyle = palette.ink
      context.fillRect(GUTTER, top, plotWidth + HEAD_ROOM, lane)
    }
    if (pitchClass === 0) {
      context.globalAlpha = 0.1
      context.fillStyle = palette.ink
      context.fillRect(GUTTER, top + lane - 0.5, plotWidth + HEAD_ROOM, 1)
    }
  }

  // Note names thin out as the lanes get tight — every note, then the naturals, then only the Cs —
  // and never overlap: the sung note is placed first (in its loudness colour), then the Cs as
  // anchors, then the rest wherever they still fit.
  context.globalCompositeOperation = 'source-over'
  context.textBaseline = 'middle'
  const naming = namingFor(lane)
  const fontSize = Math.min(11, Math.max(8, lane * 0.8))
  const minGap = fontSize + 2
  const candidates: number[] = []
  for (let note = low; note <= high; note++) {
    const pitchClass = ((note % 12) + 12) % 12
    if (
      naming === 'all' ||
      pitchClass === 0 ||
      (naming === 'naturals' && !BLACK_KEYS.has(pitchClass))
    )
      candidates.push(note)
  }
  const rank = (note: number) => (note === sung?.note ? 0 : ((note % 12) + 12) % 12 === 0 ? 1 : 2)
  const ordered = [
    ...new Set([
      ...(sung !== null && sung.note >= low && sung.note <= high ? [sung.note] : []),
      ...candidates,
    ]),
  ].sort((a, b) => rank(a) - rank(b) || a - b)
  const placed: number[] = []
  for (const note of ordered) {
    const y = yOf(note)
    const isSung = note === sung?.note
    if (!isSung && placed.some((other) => Math.abs(other - y) < minGap)) continue
    placed.push(y)
    const isSharp = BLACK_KEYS.has(((note % 12) + 12) % 12)
    context.font = `${isSung ? 700 : 500} ${fontSize}px ${palette.font}`
    context.globalAlpha = isSung ? 1 : isSharp ? 0.38 : 0.7
    context.fillStyle = isSung ? sungColor : palette.muted
    context.fillText(noteName(note), 2, y)
  }

  // With room for the future, a hairline marks now.
  if (ahead > 0) {
    context.globalAlpha = 0.22
    context.fillStyle = palette.ink
    context.fillRect(nowX - 0.5, 0, 1, height)
  }

  if (offChart !== null) {
    drawEdgeCue(context, offChart, nowX, sungColor)
  } else if (head !== null) {
    context.globalAlpha = 1
    context.fillStyle = head.color
    context.shadowColor = head.color
    context.shadowBlur = 12
    context.beginPath()
    context.arc(head.x, head.y, thickness / 2 + 1.5, 0, Math.PI * 2)
    context.fill()
    context.shadowBlur = 0
  }
}

onMounted(() => {
  readPalette()
  resizeObserver = new ResizeObserver(resize)
  if (canvas.value !== null) resizeObserver.observe(canvas.value)
  colorScheme.addEventListener('change', onSchemeChange)
  resize()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  colorScheme.removeEventListener('change', onSchemeChange)
})

watch(
  () => [props.trace, props.targets, props.low, props.high, props.seconds, props.ahead, props.now],
  draw,
)
</script>

<template>
  <div ref="root" class="roll" role="img" :aria-label="label">
    <canvas ref="canvas" class="roll__canvas" />
  </div>
</template>

<style scoped>
/* The chart's height is set from outside (class, style or a stretching parent); the note range
   shares it. */
.roll {
  width: 100%;
  height: 20rem;
  min-height: 6rem;
}

.roll__canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
