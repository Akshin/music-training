<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhGauge } from '@phosphor-icons/vue'
import { BPM_DEFAULT, BPM_MAX, BPM_MIN, clampBpm } from '@/training/tempo'

/** Visual dial sweep: hard left → hard right. */
const ANGLE_MIN = -135
const ANGLE_MAX = 135

/** Vertical drag travel that covers the full BPM range — larger = smoother. */
const DRAG_TRAVEL_PX = 280
const DRAG_THRESHOLD_PX = 4

const TAP_RESET_MS = 2000
const TAP_HISTORY = 8

const props = withDefaults(
  defineProps<{
    modelValue?: number
    compact?: boolean
  }>(),
  {
    modelValue: BPM_DEFAULT,
    compact: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [bpm: number]
}>()

const bpm = ref(clampBpm(props.modelValue))

watch(
  () => props.modelValue,
  (next) => {
    const clamped = clampBpm(next)
    if (clamped !== bpm.value) bpm.value = clamped
  },
)

function setBpm(value: number) {
  const next = clampBpm(value)
  if (next === bpm.value) return
  bpm.value = next
  emit('update:modelValue', next)
}

function bpmToAngle(value: number): number {
  const t = (clampBpm(value) - BPM_MIN) / (BPM_MAX - BPM_MIN)
  return ANGLE_MIN + t * (ANGLE_MAX - ANGLE_MIN)
}

const knobAngle = computed(() => bpmToAngle(bpm.value))

/** Arc fill in degrees over the −135°…+135° sweep (270° total). */
const sweepDegrees = computed(() => {
  const t = (bpm.value - BPM_MIN) / (BPM_MAX - BPM_MIN)
  return t * (ANGLE_MAX - ANGLE_MIN)
})

const dragging = ref(false)
const dragMoved = ref(false)
const dragOriginY = ref(0)
const dragStartBpm = ref(BPM_DEFAULT)

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  dragging.value = true
  dragMoved.value = false
  dragOriginY.value = event.clientY
  dragStartBpm.value = bpm.value
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  const dy = event.clientY - dragOriginY.value
  if (!dragMoved.value && Math.abs(dy) < DRAG_THRESHOLD_PX) return
  dragMoved.value = true
  // Up (negative dy) raises tempo; down lowers it.
  const delta = (-dy / DRAG_TRAVEL_PX) * (BPM_MAX - BPM_MIN)
  setBpm(dragStartBpm.value + delta)
}

function onPointerUp(event: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId)
  }
  // Pure tap (no drag) → tap tempo.
  if (!dragMoved.value) registerTap()
}

const tapTimes = ref<number[]>([])

function registerTap() {
  const now = performance.now()
  const prev = tapTimes.value
  const recent = prev.filter((t) => now - t < TAP_RESET_MS)
  recent.push(now)
  tapTimes.value = recent.slice(-TAP_HISTORY)

  if (recent.length < 2) return

  const intervals: number[] = []
  for (let i = 1; i < recent.length; i++) {
    intervals.push(recent[i]! - recent[i - 1]!)
  }
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
  if (avg <= 0) return
  setBpm(60_000 / avg)
}

function onInputChange(event: Event) {
  const el = event.target as HTMLInputElement
  const parsed = Number.parseInt(el.value, 10)
  if (Number.isNaN(parsed)) {
    el.value = String(bpm.value)
    return
  }
  setBpm(parsed)
}
</script>

<template>
  <div class="bpm-control" :class="{ 'bpm-control--compact': compact }" role="group" aria-label="BPM">
    <label class="bpm-control__label ctrl-title" for="bpm-input">
      <PhGauge :size="14" weight="light" aria-hidden="true" />
      BPM
    </label>
    <input
      id="bpm-input"
      class="bpm-control__input"
      type="number"
      inputmode="numeric"
      :min="BPM_MIN"
      :max="BPM_MAX"
      :value="bpm"
      @change="onInputChange"
    />

    <button
      type="button"
      class="bpm-control__knob"
      :class="{ 'bpm-control__knob--dragging': dragging }"
      :style="{ '--sweep': sweepDegrees }"
      :aria-valuemin="BPM_MIN"
      :aria-valuemax="BPM_MAX"
      :aria-valuenow="bpm"
      :aria-label="`Темп ${bpm} BPM. Тяните вверх или вниз, тап — tap tempo`"
      role="slider"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <span class="bpm-control__track" aria-hidden="true" />
      <span
        class="bpm-control__dial"
        :style="{ transform: `rotate(${knobAngle}deg)` }"
        aria-hidden="true"
      >
        <span class="bpm-control__pointer" />
      </span>
      <span class="bpm-control__value" aria-hidden="true">{{ bpm }}</span>
      <span v-if="!compact" class="bpm-control__hint">tap</span>
    </button>

    <p v-if="!compact" class="bpm-control__range">{{ BPM_MIN }}–{{ BPM_MAX }}</p>
  </div>
</template>

<style scoped>
.bpm-control {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  width: max-content;
  max-width: 100%;
  color: var(--ink);
  user-select: none;
}

.bpm-control__label {
  z-index: 1;
}

.bpm-control__input {
  width: 4.5rem;
  padding: 0.35rem 0.4rem;
  border: 1px solid var(--line);
  border-radius: 0.35rem;
  background: var(--bg-inset);
  color: var(--ink);
  font-size: 1.25rem;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  text-align: center;
  outline: none;
}

.bpm-control__input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

.bpm-control__input::-webkit-outer-spin-button,
.bpm-control__input::-webkit-inner-spin-button {
  margin: 0;
  -webkit-appearance: none;
}

.bpm-control__input[type='number'] {
  appearance: textfield;
  -moz-appearance: textfield;
}

.bpm-control__knob {
  --knob-size: 7.25rem;
  --ring: 1.5px;

  position: relative;
  display: grid;
  place-items: center;
  width: var(--knob-size);
  height: var(--knob-size);
  margin: 0.45rem 0 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: ns-resize;
  touch-action: none;
}

.bpm-control__knob:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}

.bpm-control__knob--dragging {
  cursor: ns-resize;
}

.bpm-control__track {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(
    from -135deg,
    var(--accent) 0deg,
    var(--accent) calc(var(--sweep) * 1deg),
    color-mix(in srgb, var(--line) 90%, transparent) calc(var(--sweep) * 1deg),
    color-mix(in srgb, var(--line) 90%, transparent) 270deg,
    transparent 270deg
  );
  -webkit-mask: radial-gradient(
    farthest-side,
    transparent calc(100% - var(--ring) - 0.5px),
    #000 calc(100% - var(--ring))
  );
  mask: radial-gradient(
    farthest-side,
    transparent calc(100% - var(--ring) - 0.5px),
    #000 calc(100% - var(--ring))
  );
  pointer-events: none;
}

.bpm-control__dial {
  position: absolute;
  inset: 0.7rem;
  border-radius: 50%;
  border: 1px solid var(--line);
  background:
    radial-gradient(circle at 32% 28%, rgb(255 255 255 / 10%), transparent 42%),
    var(--bg-raised);
  box-shadow:
    inset 0 1px 1px rgb(255 255 255 / 12%),
    inset 0 -10px 18px rgb(8 10 14 / 22%);
  transition:
    transform 40ms linear,
    border-color 280ms var(--ease),
    background 280ms var(--ease);
}

.bpm-control__knob:hover .bpm-control__dial {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
}

.bpm-control__knob--dragging .bpm-control__dial {
  border-color: color-mix(in srgb, var(--accent) 70%, var(--line));
  background: color-mix(in srgb, var(--bg-raised) 88%, var(--accent));
  transition: none;
}

.bpm-control__pointer {
  position: absolute;
  top: 14%;
  left: 50%;
  width: 0.22rem;
  height: 22%;
  border-radius: 999px;
  background: var(--accent);
  transform: translateX(-50%);
}

.bpm-control__range {
  margin: 0;
  font-size: 0.7rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.bpm-control__value {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  font-size: 1.15rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  pointer-events: none;
}

.bpm-control__hint {
  position: relative;
  z-index: 1;
  margin-top: 1.9rem;
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
  pointer-events: none;
}

.bpm-control--compact {
  gap: 0.4rem;
}

.bpm-control--compact .bpm-control__input {
  width: 3.6rem;
  padding: 0.28rem 0.3rem;
  font-size: 1.05rem;
  border-radius: 0.55rem;
}

.bpm-control--compact .bpm-control__knob {
  --knob-size: 5.35rem;

  margin: 0;
}

.bpm-control--compact .bpm-control__knob:focus-visible {
  outline-offset: 2px;
}

.bpm-control--compact .bpm-control__value {
  font-size: 1.02rem;
}
</style>
