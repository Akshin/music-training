<script setup lang="ts">
import { computed } from 'vue'
import { BPM_MAX, BPM_MIN } from '@/training/tempo'
import { clampBpmRange, type BpmRange } from '@/training/builder'

const props = defineProps<{
  modelValue: BpmRange
}>()

const emit = defineEmits<{
  'update:modelValue': [range: BpmRange]
}>()

const span = BPM_MAX - BPM_MIN
const left = computed(() => (props.modelValue.min - BPM_MIN) / span)
const right = computed(() => (props.modelValue.max - BPM_MIN) / span)

function setMin(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  const next = clampBpmRange({
    min: Math.min(value, props.modelValue.max),
    max: props.modelValue.max,
  })
  ;(event.target as HTMLInputElement).value = String(next.min)
  emit('update:modelValue', next)
}

function setMax(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  const next = clampBpmRange({
    min: props.modelValue.min,
    max: Math.max(value, props.modelValue.min),
  })
  ;(event.target as HTMLInputElement).value = String(next.max)
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="range">
    <p class="range__value">
      <span>{{ modelValue.min }}</span>
      <span class="range__dash">–</span>
      <span>{{ modelValue.max }}</span>
      <span class="range__unit">BPM</span>
    </p>
    <div class="range__track" :style="{ '--left': left, '--right': right }">
      <input
        class="range__input"
        type="range"
        :min="BPM_MIN"
        :max="BPM_MAX"
        :value="modelValue.min"
        aria-label="Самый медленный темп, BPM"
        @input="setMin"
      />
      <input
        class="range__input"
        type="range"
        :min="BPM_MIN"
        :max="BPM_MAX"
        :value="modelValue.max"
        aria-label="Самый быстрый темп, BPM"
        @input="setMax"
      />
    </div>
    <p class="range__scale" aria-hidden="true">
      <span>{{ BPM_MIN }}</span>
      <span>{{ BPM_MAX }}</span>
    </p>
  </div>
</template>

<style scoped>
.range {
  display: grid;
  gap: 0.4rem;
  width: 100%;
}

.range__value {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.range__dash {
  color: var(--muted);
}

.range__unit {
  margin-left: 0.2rem;
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  color: var(--muted);
}

.range__track {
  --thumb: 1.25rem;

  position: relative;
  height: 1.6rem;
}

.range__track::before,
.range__track::after {
  content: '';
  position: absolute;
  top: 50%;
  height: 4px;
  border-radius: 2px;
  transform: translateY(-50%);
}

.range__track::before {
  left: 0;
  right: 0;
  background: var(--line);
}

.range__track::after {
  /* Thumb centres run half a thumb in from the ends. */
  left: calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--left));
  right: calc(100% - var(--thumb) / 2 - (100% - var(--thumb)) * var(--right));
  background: var(--accent);
}

.range__input {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  margin: 0;
  background: transparent;
  pointer-events: none;
  appearance: none;
  -webkit-appearance: none;
}

.range__input::-webkit-slider-runnable-track {
  height: 100%;
  background: transparent;
}

.range__input::-moz-range-track {
  background: transparent;
}

.range__input::-webkit-slider-thumb {
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.175rem;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: var(--bg-raised);
  cursor: grab;
  pointer-events: auto;
  -webkit-appearance: none;
}

.range__input::-moz-range-thumb {
  width: 1rem;
  height: 1rem;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: var(--bg-raised);
  cursor: grab;
  pointer-events: auto;
}

.range__input:focus-visible::-webkit-slider-thumb {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.range__scale {
  display: flex;
  justify-content: space-between;
  margin: 0;
  font-size: 0.7rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
