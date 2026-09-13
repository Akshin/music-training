<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    label: string
    /** Native tooltip: what the switch actually does. */
    hint?: string
    /** Stretch the caption for longer labels like «Отображение лада». */
    wide?: boolean
  }>(),
  {
    wide: false,
  },
)

const announced = computed(() => (props.hint ? `${props.label}. ${props.hint}` : props.label))

const emit = defineEmits<{
  'update:modelValue': [on: boolean]
}>()

function toggle() {
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <div class="sw-wrap" :class="{ 'sw-wrap--wide': wide }" :title="hint || undefined">
    <button
      type="button"
      class="sw"
      :class="{ 'sw--on': modelValue }"
      :aria-pressed="modelValue"
      :aria-label="announced"
      :title="hint || undefined"
      @click="toggle"
    >
      <slot />
    </button>
    <span class="sw__caption" aria-hidden="true">{{ label }}</span>
  </div>
</template>

<style scoped>
.sw-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.28rem;
  width: 4.1rem;
}

.sw-wrap--wide {
  width: 6.6rem;
}

.sw {
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition:
    background 320ms var(--ease),
    color 320ms var(--ease),
    box-shadow 320ms var(--ease),
    transform 220ms var(--ease);
}

.sw:hover {
  color: var(--ink);
}

.sw:active {
  transform: scale(0.96);
}

.sw:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.sw--on {
  background: var(--accent);
  color: var(--accent-ink);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 28%);
}

.sw--on:hover {
  color: var(--accent-ink);
  filter: brightness(1.04);
}

.sw__caption {
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  text-align: center;
  line-height: 1.2;
}
</style>
