<script setup lang="ts">
import { ref, watch } from 'vue'
import { PhMusicNote } from '@phosphor-icons/vue'
import { TONAL_KEYS, TONAL_KEY_DEFAULT, type TonalKey } from '@/training/keys'

const props = withDefaults(
  defineProps<{
    modelValue?: TonalKey
    hideLabel?: boolean
  }>(),
  {
    modelValue: TONAL_KEY_DEFAULT,
    hideLabel: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [key: TonalKey]
}>()

const key = ref<TonalKey>(props.modelValue)

watch(
  () => props.modelValue,
  (next) => {
    if (next !== key.value) key.value = next
  },
)

function select(next: TonalKey) {
  if (next === key.value) return
  key.value = next
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="key" role="group" aria-label="Тональный центр">
    <span v-if="!hideLabel" class="key__label ctrl-title" id="key-label">
      <PhMusicNote :size="14" weight="light" aria-hidden="true" />
      Тональный центр
    </span>
    <div
      class="key__options"
      role="radiogroup"
      :aria-labelledby="hideLabel ? undefined : 'key-label'"
      :aria-label="hideLabel ? 'Тональный центр' : undefined"
    >
      <button
        v-for="option in TONAL_KEYS"
        :key="option"
        type="button"
        class="key__opt"
        :class="{ 'key__opt--on': key === option }"
        role="radio"
        :aria-checked="key === option"
        :aria-label="`Тональный центр ${option}`"
        @click="select(option)"
      >
        {{ option }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.key {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  width: max-content;
}

.key__options {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.3rem;
  max-width: 19rem;
  padding: 0.3rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--bg-inset) 62%, transparent);
  box-shadow:
    inset 0 1px 1px rgb(255 255 255 / 8%),
    inset 0 -1px 0 rgb(8 10 14 / 12%);
}

.key__opt {
  min-width: 2.15rem;
  height: 2.15rem;
  padding: 0 0.45rem;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition:
    background 280ms var(--ease),
    color 280ms var(--ease);
}

.key__opt:hover {
  color: var(--ink);
}

.key__opt:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.key__opt--on {
  background: var(--accent);
  color: var(--accent-ink);
}

.key__opt--on:hover {
  color: var(--accent-ink);
  filter: brightness(1.04);
}
</style>
