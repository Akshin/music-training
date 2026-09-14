<script setup lang="ts">
import { ref, watch } from 'vue'
import { PhTimer } from '@phosphor-icons/vue'
import { BEATS_DEFAULT, TIME_SIGNATURES, clampBeats } from '@/training/tempo'

const props = withDefaults(
  defineProps<{
    modelValue?: number
    hideLabel?: boolean
  }>(),
  {
    modelValue: BEATS_DEFAULT,
    hideLabel: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [beats: number]
}>()

const beats = ref(clampBeats(props.modelValue))

watch(
  () => props.modelValue,
  (next) => {
    const clamped = clampBeats(next)
    if (clamped !== beats.value) beats.value = clamped
  },
)

function select(next: number) {
  const value = clampBeats(next)
  if (value === beats.value) return
  beats.value = value
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="meter" role="group" aria-label="Размер такта">
    <span v-if="!hideLabel" class="meter__label ctrl-title" id="meter-label">
      <PhTimer :size="14" weight="light" aria-hidden="true" />
      Размер
    </span>
    <div
      class="meter__options"
      role="radiogroup"
      :aria-labelledby="hideLabel ? undefined : 'meter-label'"
      :aria-label="hideLabel ? 'Размер такта' : undefined"
    >
      <button
        v-for="option in TIME_SIGNATURES"
        :key="option.label"
        type="button"
        class="meter__opt"
        :class="{ 'meter__opt--on': beats === option.beats }"
        role="radio"
        :aria-checked="beats === option.beats"
        @click="select(option.beats)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.meter {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  width: max-content;
}

.meter__options {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.3rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--bg-inset) 62%, transparent);
  box-shadow:
    inset 0 1px 1px rgb(255 255 255 / 8%),
    inset 0 -1px 0 rgb(8 10 14 / 12%);
}

.meter__opt {
  min-width: 2.35rem;
  height: 2.15rem;
  padding: 0 0.5rem;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition:
    background 280ms var(--ease),
    color 280ms var(--ease),
    border-color 280ms var(--ease);
}

.meter__opt:hover {
  color: var(--ink);
}

.meter__opt:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.meter__opt--on {
  background: var(--accent);
  color: var(--accent-ink);
}

.meter__opt--on:hover {
  color: var(--accent-ink);
  filter: brightness(1.04);
}
</style>
