<script setup lang="ts">
import { computed } from 'vue'
import { FIRST_POSITION_MAX, layoutModeMarks } from '@/training/fretboard'
import { modeLabel, type ModePattern } from '@/training/patterns'

const props = defineProps<{
  mode: ModePattern
  /** Pitch class of the tonic, C = 0; E when absent. */
  tonic?: number
}>()

const W = 240
const H = 118
const PAD_X = 16
const PAD_Y = 18
const R = 5.6
const STRING_COUNT = 6
const FRETS = FIRST_POSITION_MAX

const layout = computed(() => layoutModeMarks(props.mode, props.tonic))

const geo = computed(() => {
  const innerW = W - PAD_X * 2
  const innerH = H - PAD_Y * 2
  return {
    innerW,
    innerH,
    colW: innerW / FRETS,
    stringGap: innerH / (STRING_COUNT - 1),
  }
})

function stringY(lowEIndex: number): number {
  return Math.round(PAD_Y + (STRING_COUNT - 1 - lowEIndex) * geo.value.stringGap)
}

function markX(fret: number): number {
  return Math.round(PAD_X + (fret - 0.5) * geo.value.colW)
}

function kindToken(via: 'tone' | 'semitone' | 'tc'): string {
  if (via === 'semitone') return 'semitone'
  if (via === 'tc') return 'tc'
  return 'tone'
}

const marks = computed(() =>
  layout.value.marks.map((mark) => ({
    ...mark,
    x: markX(mark.fret),
    y: stringY(mark.string),
    token: kindToken(mark.via),
  })),
)
</script>

<template>
  <svg
    class="tab"
    :viewBox="`0 0 ${W} ${H}`"
    role="img"
    :aria-label="`Первая позиция: ${modeLabel(mode)}`"
  >
    <line
      v-for="fret in FRETS - 1"
      :key="`fret-${fret}`"
      class="tab__fret"
      :x1="PAD_X + fret * geo.colW"
      :y1="PAD_Y"
      :x2="PAD_X + fret * geo.colW"
      :y2="H - PAD_Y"
    />

    <line
      v-for="s in STRING_COUNT"
      :key="`str-${s}`"
      class="tab__string"
      :class="{ 'tab__string--bass': s >= 5 }"
      :x1="PAD_X"
      :y1="stringY(s - 1)"
      :x2="W - PAD_X"
      :y2="stringY(s - 1)"
    />

    <circle
      v-for="(mark, i) in marks"
      :key="`${mark.string}-${mark.fret}-${i}`"
      class="tab__dot"
      :data-kind="mark.token"
      :cx="mark.x"
      :cy="mark.y"
      :r="R"
    />
  </svg>
</template>

<style scoped>
.tab {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.tab__fret {
  stroke: color-mix(in srgb, var(--ink) 14%, transparent);
  stroke-width: 0.75;
}

.tab__string {
  stroke: color-mix(in srgb, var(--ink) 36%, transparent);
  stroke-width: 0.85;
}

.tab__string--bass {
  stroke-width: 1.45;
}

.tab__dot {
  fill: var(--tone);
}

.tab__dot[data-kind='semitone'] {
  fill: var(--semitone);
}

.tab__dot[data-kind='tc'] {
  fill: var(--tc);
}
</style>
