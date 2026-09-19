<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  drawBreath,
  loopedBreathPhase,
  rgbChannels,
  type BreathTarget,
} from '@/components/pitch/breath'
import { barCapacity, breathAnchor, sixteenthsPerBeat, type BuilderNote } from '@/training/builder'
import { BPM_DEFAULT, secondsPerBeat } from '@/training/tempo'

const props = withDefaults(
  defineProps<{
    notes: readonly BuilderNote[]
    beats: number
    /** Pitch range of the lanes, MIDI; shared by all bars so they compare at a glance. */
    low: number
    high: number
    /** Pitch the bar's last note may slide into: the first note after the bar. */
    nextMidi?: number | null
    /** The last pitch before the bar, which an exhale at its start leaves from. */
    prevMidi?: number | null
    /** Tempo the breaths move at: each one gathers or spreads over its own length. */
    bpm?: number
    /** Show the free part of the bar as a dashed slot. */
    showRest?: boolean
  }>(),
  {
    nextMidi: null,
    prevMidi: null,
    bpm: BPM_DEFAULT,
    showRest: false,
  },
)

/** Units of the drawing: one sixteenth wide, one semitone tall. */
const X = 10
const Y = 10
/** Note body height, of a lane. */
const BODY = 0.8
/** Attack length at most, sixteenths. */
const ATTACK = 1

const capacity = computed(() => barCapacity(props.beats))
const lanes = computed(() => Math.max(1, props.high - props.low + 1))
const width = computed(() => capacity.value * X)
const height = computed(() => lanes.value * Y)

const beatLines = computed(() => {
  const step = sixteenthsPerBeat(props.beats)
  const lines: number[] = []
  for (let at = step; at < capacity.value; at += step) lines.push(at * X)
  return lines
})

/** Centre of a pitch's lane, clamped into the drawing. */
function laneY(midi: number): number {
  const clamped = Math.min(props.high, Math.max(props.low, midi))
  return (props.high - clamped + 0.5) * Y
}

interface Shape {
  key: number
  body: string
  /** The glide into the next pitch for a slide, drawn as a stroke. */
  glide: string | null
}

const shapes = computed<Shape[]>(() => {
  const result: Shape[] = []
  let at = 0
  props.notes.forEach((note, index) => {
    const left = at * X
    const right = (at + note.sixteenths) * X
    at += note.sixteenths
    if (note.midi === null) return
    const y = laneY(note.midi)
    const half = (BODY * Y) / 2
    const top = y - half
    const bottom = y + half
    const next =
      index + 1 < props.notes.length ? (props.notes[index + 1]?.midi ?? null) : props.nextMidi
    if (note.kind === 'attack') {
      const tip = left + Math.min(ATTACK * X, (right - left) / 2)
      result.push({
        key: index,
        body: `M${left},${y} L${tip},${top} L${right},${top} L${right},${bottom} L${tip},${bottom} Z`,
        glide: null,
      })
      return
    }
    if (note.kind === 'slide' && next !== null && next !== note.midi) {
      const middle = (left + right) / 2
      const to = laneY(next)
      result.push({
        key: index,
        body: `M${left},${top} L${middle},${top} L${middle},${bottom} L${left},${bottom} Z`,
        glide: `M${middle},${y} C${(middle + right) / 2},${y} ${(middle + right) / 2},${to} ${right},${to}`,
      })
      return
    }
    result.push({
      key: index,
      body: `M${left},${top} L${right},${top} L${right},${bottom} L${left},${bottom} Z`,
      glide: null,
    })
  })
  return result
})

const fill = computed(() => props.notes.reduce((sum, note) => sum + note.sixteenths, 0))

// ---- Breaths: veils of haze on a canvas over the drawing, played over and over at the tempo ----

const breathCanvas = ref<HTMLCanvasElement | null>(null)
let frame = 0

/** A breath of the bar: where it lies in sixteenths, its length in seconds, the pitch it hangs from. */
interface BarBreath extends BreathTarget {
  readonly from: number
  readonly to: number
}

const breaths = computed<BarBreath[]>(() => {
  const perSixteenth = secondsPerBeat(props.bpm) / sixteenthsPerBeat(props.beats)
  const around = (midi: number | null): BuilderNote[] =>
    midi === null ? [] : [{ midi, sixteenths: 0, kind: 'hold' }]
  const before = around(props.prevMidi)
  const context = [...before, ...props.notes, ...around(props.nextMidi)]
  const result: BarBreath[] = []
  let at = 0
  props.notes.forEach((note, index) => {
    if (note.breath) {
      result.push({
        kind: note.breath,
        start: 0,
        duration: note.sixteenths * perSixteenth,
        midi: breathAnchor(context, index + before.length),
        from: at,
        to: at + note.sixteenths,
      })
    }
    at += note.sixteenths
  })
  return result
})

function drawBreaths(): void {
  const element = breathCanvas.value
  if (element === null) return
  const ratio = window.devicePixelRatio || 1
  const { width: w, height: h } = element.getBoundingClientRect()
  if (element.width !== Math.round(w * ratio)) element.width = Math.round(w * ratio)
  if (element.height !== Math.round(h * ratio)) element.height = Math.round(h * ratio)
  const context = element.getContext('2d')
  if (context === null) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, w, h)
  const lane = h / lanes.value
  const channels = rgbChannels(getComputedStyle(element).getPropertyValue('--muted'))
  const clock = performance.now() / 1000
  for (const breath of breaths.value) {
    const left = (breath.from / capacity.value) * w
    const right = (breath.to / capacity.value) * w
    drawBreath(
      context,
      breath.kind,
      loopedBreathPhase(breath, clock),
      {
        centre: (left + right) / 2,
        halfWidth: (right - left) / 2,
        point: (laneY(breath.midi ?? (props.low + props.high) / 2) / Y) * lane + lane * 0.2,
        depth: Math.min(lane * 5, h * 0.6),
      },
      channels,
    )
  }
}

function tick(): void {
  drawBreaths()
  frame = requestAnimationFrame(tick)
}

function restart(): void {
  cancelAnimationFrame(frame)
  if (breaths.value.length > 0) frame = requestAnimationFrame(tick)
  else drawBreaths()
}

watch(() => breaths.value.length > 0, restart, { flush: 'post' })
onMounted(restart)
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <div class="roll-wrap">
    <svg
      class="roll"
      :viewBox="`0 0 ${width} ${height}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line
        v-for="x in beatLines"
        :key="x"
        class="roll__beat"
        :x1="x"
        :x2="x"
        y1="0"
        :y2="height"
        vector-effect="non-scaling-stroke"
      />
      <rect
        v-if="showRest && fill < capacity"
        class="roll__free"
        :x="fill * X + 1"
        y="1"
        :width="(capacity - fill) * X - 2"
        :height="height - 2"
        vector-effect="non-scaling-stroke"
      />
      <g v-for="shape in shapes" :key="shape.key">
        <path class="roll__note" :d="shape.body" />
        <path v-if="shape.glide" class="roll__glide" :d="shape.glide" :stroke-width="BODY * Y" />
      </g>
    </svg>
    <canvas v-if="breaths.length" ref="breathCanvas" class="roll__breaths" aria-hidden="true" />
  </div>
</template>

<style scoped>
.roll-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}

.roll__breaths {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.roll {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.roll__beat {
  stroke: var(--line);
  stroke-width: 1;
}

.roll__free {
  fill: none;
  stroke: color-mix(in srgb, var(--muted) 45%, transparent);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}

.roll__note {
  fill: var(--accent);
}

.roll__glide {
  fill: none;
  stroke: var(--accent);
  stroke-linecap: butt;
}
</style>
