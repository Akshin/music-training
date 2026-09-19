<script lang="ts">
export interface SegmentedOption<V> {
  readonly value: V
  readonly label: string
  /** Native tooltip. */
  readonly hint?: string
  /** A colour dot before the label. */
  readonly color?: string
  readonly disabled?: boolean
}
</script>

<script setup lang="ts" generic="T extends string | number">
defineProps<{
  modelValue: T | null
  options: readonly SegmentedOption<T>[]
  label: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: T]
}>()
</script>

<template>
  <div class="seg" role="radiogroup" :aria-label="label" :aria-disabled="disabled || undefined">
    <button
      v-for="option in options"
      :key="String(option.value)"
      type="button"
      class="seg__opt"
      :class="{ 'seg__opt--on': modelValue === option.value }"
      role="radio"
      :aria-checked="modelValue === option.value"
      :title="option.hint"
      :disabled="disabled || option.disabled"
      @click="emit('update:modelValue', option.value)"
    >
      <span
        v-if="option.color"
        class="seg__dot"
        :style="{ background: option.color }"
        aria-hidden="true"
      />
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.seg {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  width: max-content;
  max-width: 100%;
  padding: 0.3rem;
  border: 1px solid var(--line);
  border-radius: 1.2rem;
  background: color-mix(in srgb, var(--bg-inset) 62%, transparent);
  box-shadow:
    inset 0 1px 1px rgb(255 255 255 / 8%),
    inset 0 -1px 0 rgb(8 10 14 / 12%);
}

.seg__opt {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 2.35rem;
  height: 2.15rem;
  padding: 0 0.75rem;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    background 280ms var(--ease),
    color 280ms var(--ease),
    opacity 280ms var(--ease);
}

.seg__opt:hover:not(:disabled) {
  color: var(--ink);
}

.seg__opt:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.seg__opt:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.seg__opt--on {
  background: var(--accent);
  color: var(--accent-ink);
}

.seg__opt--on:hover:not(:disabled) {
  color: var(--accent-ink);
}

.seg__dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 18%);
}
</style>
