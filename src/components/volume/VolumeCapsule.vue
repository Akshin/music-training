<script setup lang="ts">
import { computed } from 'vue'
import { LOUDNESS_GRADIENT } from '@/components/loudness'
import { clampLevel } from './meter'

const props = withDefaults(
  defineProps<{
    /** Loudness in [0, 1]; fills the capsule from the bottom. */
    value: number
    label?: string
  }>(),
  {
    label: 'Громкость',
  },
)

const level = computed(() => clampLevel(props.value))

// The loudness scale runs the full height and is cut at the level; the shine rides the surface.
const fillStyle = computed(() => ({
  background: LOUDNESS_GRADIENT,
  clipPath: `inset(${(1 - level.value) * 100}% 0 0 round 999px)`,
}))
const shineStyle = computed(() => ({ transform: `translateY(${(1 - level.value) * 100}%)` }))
</script>

<template>
  <div
    class="capsule"
    role="meter"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(level * 100)"
  >
    <span class="capsule__track">
      <span class="capsule__fill" :style="fillStyle" />
      <span class="capsule__shine" :style="shineStyle" aria-hidden="true" />
      <span class="capsule__ticks" aria-hidden="true" />
    </span>
  </div>
</template>

<style scoped>
.capsule {
  position: relative;
  width: 2.5rem;
  height: 10rem;
  border-radius: var(--radius-pill);
  background: linear-gradient(180deg, var(--bg-raised), var(--bg-inset));
  box-shadow:
    inset 0 1px 1px rgb(255 255 255 / 10%),
    inset 0 0 0 1px var(--line),
    0 12px 28px var(--shadow);
}

.capsule__track {
  position: absolute;
  inset: 0.3rem;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--bg-inset);
}

.capsule__fill,
.capsule__shine {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  transition:
    clip-path 80ms linear,
    transform 80ms linear;
}

/* A soft highlight on the surface of the level. */
.capsule__shine::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 1rem;
  border-radius: inherit;
  background: linear-gradient(180deg, rgb(255 255 255 / 38%), transparent);
}

.capsule__ticks {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent 0 calc(25% - 1px),
    color-mix(in srgb, var(--ink) 12%, transparent) calc(25% - 1px) 25%
  );
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .capsule__fill,
  .capsule__shine {
    transition: none;
  }
}
</style>
