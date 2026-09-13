<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { MapPosition } from '@audio-core/core/clock/tempo-map'
import ModeScheme from '@/components/ModeScheme.vue'
import type { MetronomeClock } from '@/composables/useMetronome'
import type { CyclePlan } from '@/training/melody'
import { BEATS_DEFAULT, BPM_DEFAULT, meterFor, secondsPerBeat, type Meter } from '@/training/tempo'
import { randomMode, type ChangeEvery, type ModePattern } from '@/training/patterns'
import { TAB_INSTRUMENT_DEFAULT, type TabInstrument } from '@/training/tabs'

const props = withDefaults(
  defineProps<{
    playing: boolean
    changeEvery: ChangeEvery
    tabInstrument?: TabInstrument
    showModeName?: boolean
    bpm?: number
    beatsPerMeasure?: number
    /** Audio-clock position while playing; schemes change on its bar lines. */
    clock?: MetronomeClock
  }>(),
  {
    tabInstrument: TAB_INSTRUMENT_DEFAULT,
    showModeName: true,
    bpm: BPM_DEFAULT,
    beatsPerMeasure: BEATS_DEFAULT,
  },
)

const emit = defineEmits<{
  'update:mode': [mode: ModePattern]
  /** What should sound while playing: the running cycle and the next one. */
  'update:plan': [plan: CyclePlan | null]
}>()

type Slot = {
  id: number
  mode: ModePattern
}

let nextId = 1

function makeSlot(exclude?: ModePattern): Slot {
  return { id: nextId++, mode: randomMode(exclude) }
}

const current = ref<Slot>(makeSlot())
const next = ref<Slot>(makeSlot(current.value.mode))
const flyer = ref<ModePattern | null>(null)
const flyerPhase = ref<'start' | 'lift' | 'go' | 'settle'>('start')
const sliding = ref(false)
/** The card in flight; it becomes `current` when it lands. */
let moving: Slot | null = null
const timers: number[] = []

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const LIFT_MS = 280
const FLY_MS = 780
/** Start falling this long before arrival so it lands already seated. */
const FALL_LEAD_MS = 420

const leftMode = computed(() => current.value.mode)
const rightMode = computed(() => next.value.mode)
/** The mode of the running cycle, even while its card is still flying in. */
const soundingMode = computed(() => flyer.value ?? current.value.mode)

/** One pulse cycle: bars until the next change, at the current tempo and meter. */
const cycleSeconds = computed(
  () => secondsPerBeat(props.bpm) * props.beatsPerMeasure * props.changeEvery,
)

const remaining = ref(cycleSeconds.value)
/** Bar, within the clock's epoch, on which the current scheme appeared. */
const cycleStartBar = ref(0)
const cycleEpoch = ref(0)
/** Meter of that epoch, once the clock has reported it. */
const cycleMeter = shallowRef<Meter | null>(null)
let rafId = 0

const nextCaption = computed(() => `${remaining.value.toFixed(1)} с`)

function tickClock() {
  const position = props.clock?.() ?? null
  if (position !== null) followClock(position)
  rafId = requestAnimationFrame(tickClock)
}

function followClock({ bar, beat, phase, epoch, grid }: MapPosition) {
  // A meter change restarts bar numbering on a downbeat: the cycle starts over there.
  if (epoch !== cycleEpoch.value) {
    cycleEpoch.value = epoch
    cycleStartBar.value = bar
  }
  const { beatsPerBar, beatUnit } = grid.meter
  const meter = cycleMeter.value
  if (meter === null || meter.beatsPerBar !== beatsPerBar || meter.beatUnit !== beatUnit) {
    cycleMeter.value = { beatsPerBar, beatUnit }
  }
  const barsIn = bar - cycleStartBar.value
  if (barsIn >= props.changeEvery) {
    cycleStartBar.value += barsIn - (barsIn % props.changeEvery)
    advance()
  }
  const cycleBeats = props.changeEvery * beatsPerBar
  const beatsLeft = (cycleStartBar.value - bar) * beatsPerBar + cycleBeats - beat - phase
  remaining.value = Math.min(beatsLeft, cycleBeats) * grid.secondsPerBeat
}

function startClock() {
  stopClock()
  cycleStartBar.value = 0
  cycleEpoch.value = 0
  cycleMeter.value = null
  remaining.value = cycleSeconds.value
  rafId = requestAnimationFrame(tickClock)
}

function stopClock() {
  if (rafId !== 0) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
}

function clearTimers() {
  while (timers.length > 0) {
    const id = timers.pop()
    if (id !== undefined) window.clearTimeout(id)
  }
}

function after(ms: number, fn: () => void) {
  timers.push(window.setTimeout(fn, ms))
}

function resetPair() {
  clearTimers()
  sliding.value = false
  flyerPhase.value = 'start'
  flyer.value = null
  moving = null
  current.value = makeSlot()
  next.value = makeSlot(current.value.mode)
}

watch(
  () => props.playing,
  (on) => {
    if (on) {
      resetPair()
      startClock()
      return
    }
    stopClock()
    clearTimers()
    moving = null
    sliding.value = false
    flyerPhase.value = 'start'
    flyer.value = null
    remaining.value = cycleSeconds.value
  },
)

// Idle, the countdown previews a full cycle; while playing the clock drives it and follows tempo.
watch(cycleSeconds, (seconds) => {
  if (!props.playing) remaining.value = seconds
})

// Shortened below what has already played: change on the next bar line rather than mid-bar.
watch(
  () => props.changeEvery,
  (every) => {
    const position = props.playing ? (props.clock?.() ?? null) : null
    if (position === null || position.epoch !== cycleEpoch.value) return
    if (position.bar - cycleStartBar.value >= every) cycleStartBar.value = position.bar + 1 - every
  },
)

function swapInstant() {
  const arriving = next.value
  current.value = arriving
  next.value = makeSlot(arriving.mode)
}

function finishSlide() {
  if (moving === null) return
  current.value = moving
  moving = null
  sliding.value = false
  // Keep the flyer covering the left slot for one frame so the seated card
  // is already opaque when the overlay drops. No fade-in.
  void nextTick(() => {
    requestAnimationFrame(() => {
      // A new slide may have started in that frame; its flyer stays.
      if (sliding.value) return
      flyer.value = null
      flyerPhase.value = 'start'
    })
  })
}

function advance() {
  if (sliding.value) {
    // The next change came before the card landed: seat it and swap without motion, so the cards
    // never fall behind what is heard.
    clearTimers()
    finishSlide()
    flyer.value = null
    flyerPhase.value = 'start'
    swapInstant()
    return
  }

  if (prefersReducedMotion.matches) {
    swapInstant()
    return
  }

  const arriving = next.value
  moving = arriving
  flyer.value = arriving.mode
  sliding.value = true
  flyerPhase.value = 'start'
  next.value = makeSlot(arriving.mode)

  void nextTick(() => {
    requestAnimationFrame(() => {
      flyerPhase.value = 'lift'
    })
  })

  clearTimers()
  after(LIFT_MS, () => {
    flyerPhase.value = 'go'
  })
  after(LIFT_MS + Math.max(0, FLY_MS - FALL_LEAD_MS), () => {
    flyerPhase.value = 'settle'
  })
  after(LIFT_MS + FLY_MS, finishSlide)
}

watch(
  leftMode,
  (mode) => {
    emit('update:mode', mode)
  },
  { immediate: true },
)

/**
 * The running cycle and the one after it, in bars of the clock's epoch; `null` when silent. Ready as
 * soon as play starts — before the first frame reports a position the meter comes from props, which
 * is what the transport starts with — so the first notes are not late.
 */
const plan = computed<CyclePlan | null>(() => {
  if (!props.playing) return null
  const meter = cycleMeter.value ?? meterFor(props.beatsPerMeasure)
  const start = cycleStartBar.value
  const bars = props.changeEvery
  return {
    epoch: cycleEpoch.value,
    meter,
    cycles: [
      { startBar: start, bars, mode: soundingMode.value },
      { startBar: start + bars, bars, mode: rightMode.value },
    ],
  }
})

watch(plan, (value) => {
  emit('update:plan', value)
})

onUnmounted(() => {
  stopClock()
  clearTimers()
})
</script>

<template>
  <section class="stage" aria-label="Лады тренировки">
    <div class="stage__viewport">
      <article
        class="stage__pane stage__pane--left"
        :class="{ 'stage__pane--exit': sliding }"
      >
        <ModeScheme
          :mode="leftMode"
          caption="Сейчас"
          :motion="false"
          :tab-instrument="tabInstrument"
          :show-mode-name="showModeName"
        />
      </article>
      <article class="stage__pane stage__pane--right" :class="{ 'stage__pane--enter': sliding }">
        <ModeScheme
          :mode="rightMode"
          :caption="nextCaption"
          caption-count
          quiet
          :tab-instrument="tabInstrument"
          :show-mode-name="showModeName"
        />
      </article>

      <div
        v-if="flyer"
        class="stage__flyer"
        :class="{
          'stage__flyer--lift': flyerPhase === 'lift' || flyerPhase === 'go',
          'stage__flyer--go': flyerPhase === 'go' || flyerPhase === 'settle',
          'stage__flyer--settle': flyerPhase === 'settle',
        }"
        aria-hidden="true"
      >
        <ModeScheme
          :mode="flyer"
          caption="Сейчас"
          :quiet="flyerPhase === 'start'"
          :lifted="flyerPhase === 'lift' || flyerPhase === 'go'"
          :tab-instrument="tabInstrument"
          :show-mode-name="showModeName"
        />
      </div>

      <div class="stage__split" aria-hidden="true" />
    </div>
  </section>
</template>

<style scoped>
.stage {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  width: 100%;
}

.stage__viewport {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  overflow: hidden;
  flex: 1 1 auto;
  min-height: 18rem;
}

.stage__pane {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 2.35rem 1rem;
}

.stage__pane--left :deep(.mode) {
  opacity: 1;
  transform: none;
  transition: none;
}

.stage__pane--exit :deep(.mode) {
  opacity: 0;
  transform: scale(0.9);
  transition:
    transform 520ms cubic-bezier(0.33, 0.08, 0.18, 1),
    opacity 480ms cubic-bezier(0.33, 0.08, 0.18, 1);
}

.stage__pane--enter {
  animation: next-arrive 860ms cubic-bezier(0.33, 0.08, 0.18, 1) 300ms both;
}

.stage__flyer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 50%;
  padding: 2.35rem 1rem;
  pointer-events: none;
  transform: translateX(0);
  transition: transform 780ms cubic-bezier(0.33, 0.08, 0.18, 1);
  will-change: transform;
}

.stage__flyer--go,
.stage__flyer--settle {
  transform: translateX(-100%);
}

.stage__split {
  position: absolute;
  top: 12%;
  bottom: 12%;
  left: 50%;
  z-index: 1;
  width: 1px;
  background: color-mix(in srgb, var(--ink) 28%, transparent);
  transform: translateX(-50%);
  pointer-events: none;
}

@keyframes next-arrive {
  from {
    opacity: 0;
    transform: scale(0.72);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .stage__pane--left :deep(.mode),
  .stage__flyer {
    transition: none;
  }

  .stage__pane--enter {
    animation: none;
  }
}

@media (max-width: 767px) {
  .stage__viewport {
    min-height: 22rem;
  }

  .stage__pane,
  .stage__flyer {
    padding: 2.1rem 0.45rem;
  }
}
</style>
