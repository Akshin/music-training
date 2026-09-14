<script setup lang="ts">
import { computed } from 'vue'
import { LOUDNESS_GRADIENT } from '@/components/loudness'
import { clampLevel } from './meter'

const props = withDefaults(
  defineProps<{
    /** Loudness in [0, 1]; fills the bar from the bottom. */
    value: number
    label?: string
  }>(),
  {
    label: 'Громкость',
  },
)

const level = computed(() => clampLevel(props.value))

// The loudness scale is laid along the whole bar and cut at the level, so the top of the fill
// always shows the colour of the current loudness.
const fillStyle = computed(() => ({
  background: LOUDNESS_GRADIENT,
  clipPath: `inset(${(1 - level.value) * 100}% 0 0 round 999px)`,
}))
</script>

<template>
  <div
    class="bar"
    role="meter"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(level * 100)"
  >
    <span class="bar__fill" :style="fillStyle" />
  </div>
</template>

<style scoped>
.bar {
  position: relative;
  width: 0.5rem;
  height: 10rem;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--bg-inset);
  box-shadow: inset 0 0 0 1px var(--line);
}

.bar__fill {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  transition: clip-path 80ms linear;
}

@media (prefers-reduced-motion: reduce) {
  .bar__fill {
    transition: none;
  }
}
</style>
