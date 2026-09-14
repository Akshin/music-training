<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { PhCaretDown, PhGuitar } from '@phosphor-icons/vue'
import {
  TAB_INSTRUMENT_DEFAULT,
  TAB_INSTRUMENTS,
  tabInstrumentLabel,
  type TabInstrument,
} from '@/training/tabs'

const props = withDefaults(
  defineProps<{
    modelValue?: TabInstrument
  }>(),
  {
    modelValue: TAB_INSTRUMENT_DEFAULT,
  },
)

const emit = defineEmits<{
  'update:modelValue': [instrument: TabInstrument]
}>()

const instrument = ref<TabInstrument>(props.modelValue)
const active = ref(instrument.value)
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

watch(
  () => props.modelValue,
  (next) => {
    if (next !== instrument.value) instrument.value = next
  },
)

const triggerLabel = computed(() => tabInstrumentLabel(instrument.value))

function select(next: TabInstrument) {
  active.value = next
  open.value = false
  if (next === instrument.value) return
  instrument.value = next
  emit('update:modelValue', next)
}

function moveActive(delta: number) {
  const options = TAB_INSTRUMENTS
  const index = options.findIndex((entry) => entry.id === active.value)
  const from = index === -1 ? options.findIndex((entry) => entry.id === instrument.value) : index
  const next = options[Math.min(options.length - 1, Math.max(0, from + delta))]
  if (next === undefined) return
  active.value = next.id
  void nextTick(() => {
    listRef.value?.querySelector<HTMLElement>('[data-active="true"]')?.focus()
  })
}

function toggle() {
  open.value = !open.value
}

function onDocumentPointer(event: PointerEvent) {
  const root = rootRef.value
  if (!root || !open.value) return
  if (event.target instanceof Node && root.contains(event.target)) return
  open.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open.value = true
    }
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    open.value = false
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    select(active.value)
  }
}

watch(open, async (isOpen) => {
  if (!isOpen) return
  active.value = instrument.value
  await nextTick()
  listRef.value?.querySelector<HTMLElement>('[data-active="true"]')?.focus()
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointer)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointer)
})
</script>

<template>
  <div ref="rootRef" class="tabs" @keydown="onKeydown">
    <span class="tabs__label ctrl-title" id="tabs-label">
      <PhGuitar :size="14" weight="light" aria-hidden="true" />
      Табы
    </span>
    <button
      type="button"
      class="tabs__trigger"
      :aria-expanded="open"
      aria-haspopup="listbox"
      aria-labelledby="tabs-label"
      :aria-label="triggerLabel"
      @click="toggle"
    >
      <span class="tabs__value">{{ triggerLabel }}</span>
      <span class="tabs__caret" :class="{ 'tabs__caret--open': open }" aria-hidden="true">
        <PhCaretDown :size="16" weight="light" />
      </span>
    </button>

    <ul
      v-show="open"
      ref="listRef"
      class="tabs__menu"
      role="listbox"
      aria-labelledby="tabs-label"
    >
      <li v-for="option in TAB_INSTRUMENTS" :key="option.id" role="presentation">
        <button
          type="button"
          class="tabs__opt"
          role="option"
          :aria-selected="instrument === option.id"
          :data-active="active === option.id"
          tabindex="-1"
          @click="select(option.id)"
        >
          {{ option.label }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.tabs {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  width: max-content;
  z-index: 15;
}

.tabs__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 11.25rem;
  height: 2.75rem;
  padding: 0 0.45rem 0 1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--bg-inset) 62%, transparent);
  box-shadow:
    inset 0 1px 1px rgb(255 255 255 / 8%),
    inset 0 -1px 0 rgb(8 10 14 / 12%);
  color: var(--ink);
  cursor: pointer;
  transition:
    border-color 320ms var(--ease),
    background 320ms var(--ease),
    transform 220ms var(--ease);
}

.tabs__trigger:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
}

.tabs__trigger:active {
  transform: scale(0.98);
}

.tabs__trigger:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.tabs__value {
  flex: 1;
  font-size: 0.9rem;
  font-weight: 600;
  text-align: left;
}

.tabs__caret {
  display: grid;
  place-items: center;
  width: 1.85rem;
  height: 1.85rem;
  border-radius: 50%;
  background: rgb(26 29 20 / 10%);
  color: var(--muted);
  transition: transform 420ms var(--ease);
}

.tabs__caret--open {
  transform: rotate(180deg);
}

.tabs__menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 0.45rem);
  left: 0;
  z-index: 20;
  margin: 0;
  padding: 0.35rem;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: 1.15rem;
  background: var(--bg-raised);
  box-shadow:
    inset 0 1px 1px rgb(255 255 255 / 10%),
    0 16px 40px var(--shadow);
}

.tabs__opt {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 2.2rem;
  padding: 0 0.85rem;
  border: none;
  border-radius: 0.8rem;
  background: transparent;
  color: var(--muted);
  font-size: 0.88rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition:
    background 240ms var(--ease),
    color 240ms var(--ease);
}

.tabs__opt:hover,
.tabs__opt:focus-visible,
.tabs__opt[data-active='true'] {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--ink);
  outline: none;
}

.tabs__opt[aria-selected='true'] {
  background: var(--accent);
  color: var(--accent-ink);
}

.tabs__opt[aria-selected='true']:hover,
.tabs__opt[aria-selected='true']:focus-visible {
  filter: brightness(1.04);
  color: var(--accent-ink);
}
</style>
