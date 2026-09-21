<script setup lang="ts">
import { computed } from 'vue'
import { LOUDNESS_GRADIENT } from '@/components/loudness'
import { clampLevel } from './meter'

const props = withDefaults(
  defineProps<{
    /** Loudness of the newest frame in [0, 1], as it is; fills the strip from the bottom. */
    level: number
    /** Loudness averaged over the last second in [0, 1]; the tick beside the strip. */
    average: number
    /** The average has been held in the zone: the corridor locks and the tick settles in. */
    success?: boolean
    /** The target corridor in [0, 1]; without both there is no corridor. */
    low?: number
    high?: number
    label?: string
  }>(),
  {
    success: false,
    low: undefined,
    high: undefined,
    label: 'Громкость',
  },
)

const level = computed(() => clampLevel(props.level))
const average = computed(() => clampLevel(props.average))

const zone = computed(() => {
  if (props.low === undefined || props.high === undefined) return null
  const low = clampLevel(props.low)
  const high = clampLevel(props.high)
  return high > low ? { low, high } : null
})

// The loudness scale is laid along the whole strip and cut at the level, so the top of the fill
// always shows the colour of the current loudness.
const fillStyle = computed(() => ({
  background: LOUDNESS_GRADIENT,
  clipPath: `inset(${(1 - level.value) * 100}% 0 0 round 999px)`,
}))

const zoneStyle = computed(() =>
  zone.value === null
    ? undefined
    : {
        bottom: `${zone.value.low * 100}%`,
        height: `${(zone.value.high - zone.value.low) * 100}%`,
      },
)

const tickStyle = computed(() => ({ bottom: `${average.value * 100}%` }))

const valueText = computed(
  () => `${Math.round(level.value * 100)}%, среднее ${Math.round(average.value * 100)}%`,
)
</script>

<template>
  <div
    class="strip"
    :class="{ 'strip--hold': success }"
    role="meter"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(level * 100)"
    :aria-valuetext="valueText"
  >
    <div class="strip__gauge">
      <span class="strip__track">
        <span class="strip__fill" :style="fillStyle" />
      </span>
      <span v-if="zone" class="strip__zone" :style="zoneStyle" aria-hidden="true" />
      <span class="strip__tick" :style="tickStyle" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.strip {
  width: 3.1rem;
  height: 100%;
  padding: 0.9rem 0 0.9rem 0.75rem;
}

.strip__gauge {
  position: relative;
  height: 100%;
}

.strip__track {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0.6rem;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--bg-inset);
  box-shadow: inset 0 0 0 1px var(--line);
}

.strip__fill {
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

/* The corridor to hold the average in: always drawn, filled green once the average holds. */
.strip__zone {
  position: absolute;
  left: 0.95rem;
  width: 2rem;
  border-radius: 0.5rem;
  box-shadow: inset 0 0 0 1px var(--line);
  transition: box-shadow 220ms var(--ease);
}

.strip__zone::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: color-mix(in srgb, var(--loudness-good) 20%, transparent);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 240ms var(--ease);
}

/* The average's tick: it drifts with the mean and, on success, seats itself in the corridor. */
.strip__tick {
  position: absolute;
  left: 1.15rem;
  width: 1.1rem;
  height: 3px;
  margin-bottom: -1.5px;
  border-radius: 2px;
  background: var(--ink);
  opacity: 0.85;
  transition:
    bottom 320ms var(--ease),
    width 420ms cubic-bezier(0.34, 1.56, 0.64, 1),
    height 420ms var(--ease),
    margin 420ms var(--ease),
    background 240ms var(--ease),
    opacity 240ms var(--ease);
}

.strip__tick::after {
  content: '';
  position: absolute;
  inset: -5px -6px;
  border-radius: var(--radius-pill);
  opacity: 0;
}

.strip--hold .strip__zone {
  box-shadow: inset 0 0 0 1.5px var(--loudness-good);
}

.strip--hold .strip__zone::before {
  transform: scaleX(1);
  transition-duration: 1200ms;
}

.strip--hold .strip__tick {
  width: 1.85rem;
  height: 4px;
  margin-bottom: -2px;
  background: var(--loudness-good);
  opacity: 1;
}

.strip--hold .strip__tick::after {
  opacity: 1;
  animation: strip-breathe 2.4s ease-in-out 1.2s infinite;
}

@keyframes strip-breathe {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--loudness-good) 55%, transparent);
  }
  50% {
    box-shadow: 0 0 0 7px color-mix(in srgb, var(--loudness-good) 0%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .strip__zone,
  .strip__zone::before,
  .strip__tick {
    transition: none;
  }

  .strip--hold .strip__tick::after {
    animation: none;
  }
}
</style>
