<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Jaw drop in [0, 1]: carries the lower lip down. */
    open?: number
    /** Lip rounding in [0, 1]: pouts the lips and rounds the opening; the width stays `width`. */
    narrow?: number
    /** Gap between the lips in [0, 1]. */
    aperture?: number
    /** Distance between the mouth corners in [0, 1], from pursed to a wide smile. */
    width?: number
    /** How well the shape fits the task in [0, 1]: both lips blend from ink/accent to green. */
    success?: number
    label?: string
  }>(),
  {
    open: 0,
    narrow: 0,
    aperture: 0,
    width: 0.5,
    success: 0,
    label: 'Рот',
  },
)

const CX = 100
const CY = 60
/** Bézier handle length of a quarter ellipse. */
const KAPPA = 0.5523

interface Point {
  x: number
  y: number
}

const clamp = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)
const lerp = (from: number, to: number, t: number) => from + (to - from) * t
const fmt = (value: number) => value.toFixed(2)
const pt = (p: Point) => `${fmt(p.x)} ${fmt(p.y)}`

/**
 * Handles of one cubic from a mouth corner to the apex above or below the centre. `round` blends a
 * lens (pointed corner, flat middle) at 0 into a quarter ellipse at 1.
 */
function handles(corner: Point, apex: Point, round: number): [Point, Point] {
  const dx = apex.x - corner.x
  const dy = apex.y - corner.y
  return [
    { x: corner.x + dx * lerp(0.3, 0, round), y: corner.y + dy * lerp(0.7, KAPPA, round) },
    { x: apex.x - dx * lerp(0.4, KAPPA, round), y: apex.y },
  ]
}

/** Corner → apex. */
function toApex(corner: Point, apex: Point, round: number): string {
  const [h1, h2] = handles(corner, apex, round)
  return `C ${pt(h1)} ${pt(h2)} ${pt(apex)}`
}

/** Apex → corner: the same profile traced backwards. */
function toCorner(apex: Point, corner: Point, round: number): string {
  const [h1, h2] = handles(corner, apex, round)
  return `C ${pt(h2)} ${pt(h1)} ${pt(corner)}`
}

const shape = computed(() => {
  const open = clamp(props.open)
  const narrow = clamp(props.narrow)
  const aperture = clamp(props.aperture)
  const width = clamp(props.width)

  const half = lerp(22, 70, width) * lerp(0.9, 0.62, narrow)
  const gapDown = 8 * aperture + 30 * open
  const cornerY = CY + gapDown * 0.3
  const left = { x: CX - half, y: cornerY }
  const right = { x: CX + half, y: cornerY }
  const up = { x: CX, y: CY - 14 * aperture }
  const down = { x: CX, y: CY + gapDown }

  return {
    upper: `M ${pt(left)} ${toApex(left, up, narrow)} ${toCorner(up, right, narrow)}`,
    lower: `M ${pt(left)} ${toApex(left, down, narrow)} ${toCorner(down, right, narrow)}`,
  }
})

// Each lip mixes its own colour with the success colour in proportion to `success`.
const colors = computed(() => {
  const share = `${(clamp(props.success) * 100).toFixed(1)}%`
  return {
    '--mouth-upper-now': `color-mix(in srgb, var(--mouth-success) ${share}, var(--mouth-upper))`,
    '--mouth-lower-now': `color-mix(in srgb, var(--mouth-success) ${share}, var(--mouth-lower))`,
  }
})
</script>

<template>
  <svg class="mouth" viewBox="0 30 200 80" role="img" :aria-label="label" :style="colors">
    <path class="mouth__lip mouth__lip--upper" :d="shape.upper" />
    <path class="mouth__lip mouth__lip--lower" :d="shape.lower" />
  </svg>
</template>

<style scoped>
.mouth {
  --mouth-upper: var(--ink);
  --mouth-lower: var(--accent);
  --mouth-success: var(--tone);

  display: block;
  width: 12rem;
  height: auto;
  overflow: visible;
}

.mouth__lip {
  fill: none;
  stroke-width: 5;
  stroke-linecap: round;
}

.mouth__lip--upper {
  stroke: var(--mouth-upper-now);
}

.mouth__lip--lower {
  stroke: var(--mouth-lower-now);
}
</style>
