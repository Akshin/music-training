<script setup lang="ts">
import { computed } from 'vue'
import { loudnessColor } from '@/components/loudness'
import { clampLevel } from './meter'

const props = withDefaults(
  defineProps<{
    /** Loudness in [0, 1]; lights segments from the bottom. */
    value: number
    label?: string
    segments?: number
  }>(),
  {
    label: 'Громкость',
    segments: 16,
  },
)

const level = computed(() => clampLevel(props.value))
const lit = computed(() => Math.round(level.value * props.segments))

/** Each segment wears the loudness colour of its own height. */
const colors = computed(() =>
  Array.from({ length: props.segments }, (_, index) =>
    loudnessColor((index + 0.5) / props.segments),
  ),
)
</script>

<template>
  <div
    class="segments"
    role="meter"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(level * 100)"
  >
    <span
      v-for="segment in segments"
      :key="segment"
      class="segments__cell"
      :style="segment <= lit ? { background: colors[segment - 1] } : undefined"
    />
  </div>
</template>

<style scoped>
.segments {
  display: flex;
  flex-direction: column-reverse;
  gap: 0.1875rem;
  width: 1.1rem;
  height: 10rem;
  padding: 0.25rem;
  border-radius: 0.65rem;
  background: var(--bg-inset);
  box-shadow: inset 0 0 0 1px var(--line);
}

.segments__cell {
  flex: 1 1 0;
  border-radius: 0.15rem;
  background: color-mix(in srgb, var(--ink) 8%, transparent);
  transition: background-color 90ms linear;
}

@media (prefers-reduced-motion: reduce) {
  .segments__cell {
    transition: none;
  }
}
</style>
