<script setup lang="ts">
import { computed } from 'vue'
import { layoutPianoKeys } from '@/training/tabs'
import { modeLabel, type ModePattern } from '@/training/patterns'

const props = defineProps<{
  mode: ModePattern
  /** Pitch class of the tonic, C = 0; C when absent. */
  tonic?: number
}>()

const W = 240
const H = 76
const PAD_X = 6
const PAD_Y = 6
const WHITE_COUNT = 8
const WHITE_W = (W - PAD_X * 2) / WHITE_COUNT
const WHITE_H = H - PAD_Y * 2
const BLACK_W = WHITE_W * 0.58
const BLACK_H = WHITE_H * 0.58
const RX = 2.2

const layout = computed(() => layoutPianoKeys(props.mode, props.tonic))

function whiteX(index: number): number {
  return PAD_X + index * WHITE_W
}

function blackX(afterWhite: number): number {
  return PAD_X + (afterWhite + 1) * WHITE_W - BLACK_W / 2
}

function kindToken(via: 'tone' | 'semitone' | 'tc'): string {
  if (via === 'semitone') return 'semitone'
  if (via === 'tc') return 'tc'
  return 'tone'
}
</script>

<template>
  <svg
    class="piano"
    :viewBox="`0 0 ${W} ${H}`"
    role="img"
    :aria-label="`Пианино: ${modeLabel(mode)}`"
  >
    <rect
      v-for="key in layout.whites"
      :key="`w-${key.pc}`"
      class="piano__key piano__key--white"
      :class="{ 'piano__key--on': key.active }"
      :data-kind="kindToken(key.via)"
      :x="whiteX(key.afterWhite) + 0.6"
      :y="PAD_Y"
      :width="WHITE_W - 1.2"
      :height="WHITE_H"
      :rx="RX"
    />

    <rect
      v-for="key in layout.blacks"
      :key="`b-${key.pc}`"
      class="piano__key piano__key--black"
      :class="{ 'piano__key--on': key.active }"
      :data-kind="kindToken(key.via)"
      :x="blackX(key.afterWhite)"
      :y="PAD_Y"
      :width="BLACK_W"
      :height="BLACK_H"
      :rx="RX"
    />
  </svg>
</template>

<style scoped>
.piano {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.piano__key {
  stroke: color-mix(in srgb, var(--ink) 22%, transparent);
  stroke-width: 1;
}

.piano__key--white {
  fill: color-mix(in srgb, var(--bg-inset) 82%, #000);
}

.piano__key--black {
  fill: color-mix(in srgb, var(--bg-inset) 42%, #000);
}

.piano__key--on {
  fill: #08090c;
  stroke-width: 1.7;
}

.piano__key--on[data-kind='tone'] {
  stroke: var(--tone);
}

.piano__key--on[data-kind='semitone'] {
  stroke: var(--semitone);
}

.piano__key--on[data-kind='tc'] {
  stroke: var(--tc);
}
</style>
