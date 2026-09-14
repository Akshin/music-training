<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { PhCaretUp } from '@phosphor-icons/vue'

/** Below this width the panel slides over the page instead of opening in the flow. */
const COMPACT_QUERY = '(max-width: 860px)'
/** Vertical travel on a handle that opens or closes the panel, px. */
const SWIPE_DISTANCE = 36
/** Movement up to this still counts as a tap, px. */
const TAP_SLOP = 6

withDefaults(
  defineProps<{
    label?: string
  }>(),
  {
    label: 'Настройки',
  },
)

/** Open where there is room for it, closed on small screens. */
const open = defineModel<boolean>('open', {
  default: () => !window.matchMedia(COMPACT_QUERY).matches,
})

defineSlots<{
  /** The controls inside the panel. */
  default?: () => unknown
  /** Stays in reach whether the panel is open or not, e.g. Play. */
  pedal?: () => unknown
}>()

const panelId = useId()
const compactQuery = window.matchMedia(COMPACT_QUERY)
const compact = ref(compactQuery.matches)
const toggleButton = ref<HTMLButtonElement | null>(null)
const gripButton = ref<HTMLButtonElement | null>(null)
const drag = ref<{ pointer: number; startY: number; offset: number } | null>(null)
/** The last press was a swipe; the click that follows it must not toggle again. */
let swiped = false

function setOpen(next: boolean): void {
  if (open.value === next) return
  open.value = next
  // Move focus to the handle that is on screen now.
  void nextTick(() => {
    if (next) gripButton.value?.focus()
    else toggleButton.value?.focus()
  })
}

function onHandleClick(next: boolean): void {
  if (swiped) {
    swiped = false
    return
  }
  setOpen(next)
}

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  swiped = false
  drag.value = { pointer: event.pointerId, startY: event.clientY, offset: 0 }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  const current = drag.value
  if (current === null || event.pointerId !== current.pointer) return
  drag.value = { ...current, offset: event.clientY - current.startY }
}

function onPointerUp(event: PointerEvent): void {
  const current = drag.value
  if (current === null || event.pointerId !== current.pointer) return
  drag.value = null
  const offset = event.clientY - current.startY
  if (Math.abs(offset) <= TAP_SLOP) return
  swiped = true
  if (offset <= -SWIPE_DISTANCE) setOpen(true)
  else if (offset >= SWIPE_DISTANCE) setOpen(false)
}

function onPointerCancel(): void {
  drag.value = null
}

/** On a small screen the panel follows the finger while a handle is dragged. */
const panelStyle = computed(() => {
  const current = drag.value
  if (!compact.value || current === null) return undefined
  const offset = open.value ? Math.max(0, current.offset) : Math.min(0, current.offset)
  const rest = open.value ? '0px' : '100% + 1.5rem'
  return { transform: `translateY(calc(${rest} + ${offset}px))`, transition: 'none' }
})

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value && compact.value) setOpen(false)
}

function onCompactChange(event: MediaQueryListEvent): void {
  compact.value = event.matches
}

onMounted(() => {
  compactQuery.addEventListener('change', onCompactChange)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  compactQuery.removeEventListener('change', onCompactChange)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    class="sheet"
    :class="{ 'sheet--open': open, 'sheet--compact': compact, 'sheet--dragging': drag !== null }"
  >
    <div v-if="compact" class="sheet__scrim" aria-hidden="true" @click="setOpen(false)" />

    <div
      :id="panelId"
      class="sheet__panel"
      role="region"
      :aria-label="label"
      :inert="!open"
      :style="panelStyle"
    >
      <div class="sheet__clip">
        <div v-if="compact" class="sheet__head">
          <button
            ref="gripButton"
            type="button"
            class="sheet__grip"
            aria-label="Скрыть настройки"
            @click="onHandleClick(false)"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerCancel"
          >
            <span class="sheet__grip-bar" aria-hidden="true" />
          </button>
          <div class="sheet__pedal">
            <slot name="pedal" />
          </div>
        </div>
        <div class="sheet__surface">
          <slot />
        </div>
      </div>
    </div>

    <div class="sheet__pedal">
      <slot name="pedal" />
    </div>

    <button
      ref="toggleButton"
      type="button"
      class="sheet__toggle"
      :aria-expanded="open"
      :aria-controls="panelId"
      :aria-label="open ? 'Скрыть настройки' : 'Показать настройки'"
      @click="onHandleClick(!open)"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <PhCaretUp class="sheet__caret" :size="18" weight="light" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.sheet {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 0.25rem 1rem 1rem;
}

/* In the flow: the panel grows up out of the dock above the pedal. */
.sheet__panel {
  display: grid;
  grid-template-rows: 0fr;
  width: min(100%, 64rem);
  transition: grid-template-rows 620ms var(--ease);
}

.sheet--open .sheet__panel {
  grid-template-rows: 1fr;
}

.sheet__clip {
  min-height: 0;
  overflow: hidden;
}

.sheet--open .sheet__clip {
  overflow: visible;
}

.sheet__surface {
  width: 100%;
  padding: 0.95rem 0.85rem 1.1rem;
  border: 1px solid var(--line);
  border-radius: 2rem;
  background: color-mix(in srgb, var(--bg-raised) 82%, var(--bg-inset));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 10%),
    0 18px 48px var(--shadow);
  opacity: 0;
  transform: translateY(28%);
  transition:
    transform 620ms var(--ease),
    opacity 420ms var(--ease);
}

.sheet--open .sheet__surface {
  opacity: 1;
  transform: none;
}

.sheet__pedal {
  display: flex;
  justify-content: center;
}

.sheet__toggle {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 1.75rem;
  padding: 0;
  border: none;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--ink) 8%, transparent);
  color: var(--muted);
  cursor: pointer;
  touch-action: none;
  transition:
    background 280ms var(--ease),
    color 280ms var(--ease);
}

.sheet__toggle:hover {
  background: color-mix(in srgb, var(--ink) 14%, transparent);
  color: var(--ink);
}

.sheet__toggle:focus-visible,
.sheet__grip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.sheet__caret {
  transition: transform 420ms var(--ease);
}

.sheet--open .sheet__caret {
  transform: rotate(180deg);
}

/* Small screens: the panel slides up over the page from the bottom edge. */
.sheet__scrim {
  position: fixed;
  inset: 0;
  z-index: 25;
  background: rgb(8 10 14 / 45%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 360ms var(--ease);
}

.sheet--open .sheet__scrim {
  opacity: 1;
  pointer-events: auto;
}

.sheet--compact .sheet__panel {
  position: fixed;
  inset: auto 0 0;
  z-index: 26;
  display: block;
  width: 100%;
  transform: translateY(calc(100% + 1.5rem));
  transition: transform 460ms var(--ease);
}

.sheet--compact.sheet--open .sheet__panel {
  transform: translateY(0);
}

.sheet--compact .sheet__clip,
.sheet--compact.sheet--open .sheet__clip {
  max-height: 88dvh;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: env(safe-area-inset-bottom);
  border: 1px solid var(--line);
  border-bottom: none;
  border-radius: 1.75rem 1.75rem 0 0;
  background: color-mix(in srgb, var(--bg-raised) 92%, var(--bg-inset));
  box-shadow: 0 -18px 48px var(--shadow);
}

.sheet--compact .sheet__surface {
  padding: 0 0.7rem 1.25rem;
  border: none;
  border-radius: 0;
  background: none;
  box-shadow: none;
  opacity: 1;
  transform: none;
}

.sheet__head {
  position: sticky;
  top: 0;
  z-index: 20;
  display: grid;
  justify-items: center;
  gap: 0.2rem;
  padding: 0.2rem 0 0.9rem;
  background: color-mix(in srgb, var(--bg-raised) 92%, var(--bg-inset));
}

.sheet__grip {
  display: grid;
  place-items: center;
  width: 100%;
  height: 1.9rem;
  padding: 0;
  border: none;
  background: none;
  cursor: grab;
  touch-action: none;
}

.sheet__grip-bar {
  width: 2.5rem;
  height: 0.3rem;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--ink) 24%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .sheet__panel,
  .sheet__surface,
  .sheet__caret,
  .sheet__scrim,
  .sheet--compact .sheet__panel {
    transition: none;
  }
}
</style>
