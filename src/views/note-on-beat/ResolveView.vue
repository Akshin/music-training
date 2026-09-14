<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { MapPosition, NoteEvent } from '@audio-core/core/index'
import ExerciseConsole from '@/components/exercise/ExerciseConsole.vue'
import ExerciseScreen from '@/components/exercise/ExerciseScreen.vue'
import PitchRoll from '@/components/pitch/PitchRoll.vue'
import type { PitchTarget } from '@/components/pitch/trace'
import { useExercise } from '@/composables/useExercise'
import { NOTE_ON_BEAT } from '@/training/exercises'
import { noteName } from '@/training/keys'
import {
  CYCLE_BARS,
  NOTE_BEATS,
  RHYTHM_TOLERANCE_SECONDS,
  cycleNote,
  judge,
  listenBeat,
  singBeat,
  type Attempt,
} from '@/training/noteOnBeat'

const exercise = useExercise(NOTE_ON_BEAT)
const { settings, session, tonicMidi } = exercise
const { beats } = settings
const { playing, pitch, error, micState } = session

/** Attempts kept in the history strip. */
const HISTORY = 8
/** Wait after a cycle ends before scoring it: analysis runs a little behind the sound. */
const SCORE_DELAY_MS = 450
/** Seconds of sung history and of upcoming notes on the chart. */
const HISTORY_SECONDS = 4
const AHEAD_SECONDS = 4

const position = shallowRef<MapPosition | null>(null)
const seed = ref(1)
const attempts = ref<Attempt[]>([])
const timers = new Set<number>()
let raf = 0

/** Follow the audio clock, updating `position` once per beat. */
function follow(): void {
  const next = session.clock()
  const current = position.value
  if (next === null) {
    if (current !== null) position.value = null
  } else if (
    current === null ||
    next.epoch !== current.epoch ||
    next.bar !== current.bar ||
    next.beat !== current.beat
  ) {
    position.value = next
  }
  raf = requestAnimationFrame(follow)
}

function clearTimers(): void {
  for (const timer of timers) window.clearTimeout(timer)
  timers.clear()
}

watch(playing, (on) => {
  cancelAnimationFrame(raf)
  clearTimers()
  position.value = null
  if (!on) return
  seed.value = Math.floor(Math.random() * 2 ** 31)
  attempts.value = []
  raf = requestAnimationFrame(follow)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  clearTimers()
})

const epoch = computed(() => position.value?.epoch ?? 0)
const beatsPerBar = computed(() => position.value?.grid.meter.beatsPerBar ?? beats.value)
const cycle = computed(() => Math.max(0, Math.floor((position.value?.bar ?? 0) / CYCLE_BARS)))
const started = computed(() => position.value !== null && position.value.bar >= 0)
const singing = computed(() => started.value && (position.value?.bar ?? 0) % CYCLE_BARS === 1)
const beatInBar = computed(() => (started.value ? (position.value?.beat ?? -1) : -1))
const noteOf = (index: number) => cycleNote(tonicMidi.value, seed.value, index)

// The reference plays this cycle's note and the next one's on their listening downbeats.
watch(
  [cycle, epoch, beatsPerBar, tonicMidi, seed, playing],
  () => {
    if (!playing.value) {
      session.setNotes([], 0)
      return
    }
    const notes: NoteEvent[] = [cycle.value, cycle.value + 1].map((index) => ({
      midi: noteOf(index),
      startBeat: listenBeat(index, beatsPerBar.value),
      durationBeats: NOTE_BEATS,
      velocity: 0.45,
    }))
    session.setNotes(notes, epoch.value)
  },
  { immediate: true },
)

// When a cycle ends, judge the note sung in its second bar.
watch([cycle, epoch], ([next, nextEpoch], [previous, previousEpoch]) => {
  if (!playing.value || nextEpoch !== previousEpoch || next !== previous + 1) return
  const scored = previous
  const target: NoteEvent = {
    midi: noteOf(scored),
    startBeat: singBeat(scored, beatsPerBar.value),
    durationBeats: NOTE_BEATS,
    velocity: 1,
  }
  const timer = window.setTimeout(() => {
    timers.delete(timer)
    const take = session.scoreNotes([target], nextEpoch, { matchWindowSeconds: 0.6 })
    if (take === null) return
    const sung = take.notes[0]
    const attempt = judge(
      scored,
      target.midi,
      sung?.pitch?.cents ?? null,
      sung?.rhythm?.offsetSeconds ?? null,
    )
    attempts.value = [...attempts.value, attempt].slice(-HISTORY)
  }, SCORE_DELAY_MS)
  timers.add(timer)
})

/** Notes around now on the chart: listening notes faint, notes to sing strong. */
const targets = computed<PitchTarget[]>(() => {
  const at = position.value
  if (at === null || micState.value !== 'running') return []
  const list: PitchTarget[] = []
  for (let index = Math.max(0, cycle.value - 1); index <= cycle.value + 1; index++) {
    const midi = noteOf(index)
    const beatsInBar = beatsPerBar.value
    for (const [beat, strong] of [
      [listenBeat(index, beatsInBar), false],
      [singBeat(index, beatsInBar), true],
    ] as const) {
      const start = session.traceTimeOf(at.grid.beatToSeconds(beat))
      const end = session.traceTimeOf(at.grid.beatToSeconds(beat + NOTE_BEATS))
      if (start !== null && end !== null) list.push({ midi, start, end, strong })
    }
  }
  return list
})

const last = computed(() => attempts.value.at(-1) ?? null)

function pitchText(attempt: Attempt): string {
  if (attempt.cents === null) return 'не услышал'
  const cents = Math.round(attempt.cents)
  return `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${Math.abs(cents)} ¢`
}

function timingText(attempt: Attempt): string {
  if (attempt.offsetSeconds === null) return ''
  const ms = Math.round(Math.abs(attempt.offsetSeconds) * 1000)
  if (Math.abs(attempt.offsetSeconds) <= RHYTHM_TOLERANCE_SECONDS) return 'вовремя'
  return attempt.offsetSeconds > 0 ? `${ms} мс поздно` : `${ms} мс рано`
}

function grade(attempt: Attempt): 'hit' | 'near' | 'miss' {
  if (attempt.inTune && attempt.onTime) return 'hit'
  if (attempt.inTune || attempt.onTime) return 'near'
  return 'miss'
}
</script>

<template>
  <ExerciseScreen :title="NOTE_ON_BEAT.title">
    <section class="stage" aria-label="Нота на долю">
      <div class="cue">
        <p class="cue__phase" :class="{ 'cue__phase--sing': singing }">
          {{ !playing ? 'Нажми Play' : !started ? 'Приготовься' : singing ? 'Пой' : 'Слушай' }}
        </p>
        <p class="cue__note">{{ started ? noteName(noteOf(cycle)) : '' }}</p>
        <ol class="beats" aria-hidden="true">
          <li
            v-for="beat in beatsPerBar"
            :key="beat"
            class="beats__dot"
            :class="{ 'beats__dot--on': beat - 1 === beatInBar, 'beats__dot--sing': singing }"
          />
        </ol>
      </div>

      <PitchRoll
        :trace="pitch"
        :targets="targets"
        :low="tonicMidi - 12"
        :high="tonicMidi + 12"
        :seconds="HISTORY_SECONDS"
        :ahead="AHEAD_SECONDS"
      />

      <div class="result">
        <p class="result__last" aria-live="polite">
          <template v-if="last">
            <span class="result__note">{{ noteName(last.midi) }}</span>
            <span :class="{ result__bad: !last.inTune }">{{ pitchText(last) }}</span>
            <span :class="{ result__bad: !last.onTime }">{{ timingText(last) }}</span>
          </template>
          <span v-else class="result__idle">Результат появится после первой попытки</span>
        </p>
        <ol class="history" aria-label="Последние попытки">
          <li
            v-for="attempt in attempts"
            :key="attempt.cycle"
            class="history__dot"
            :class="`history__dot--${grade(attempt)}`"
            :title="`${noteName(attempt.midi)}: ${pitchText(attempt)} ${timingText(attempt)}`"
          />
        </ol>
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>

    <template #dock>
      <ExerciseConsole
        :exercise="exercise"
        metronome-hint="Щелчки метронома. Циклы идут по тактам и без них."
      />
    </template>
  </ExerciseScreen>
</template>

<style scoped>
.stage {
  display: grid;
  align-content: center;
  gap: 1.25rem;
  width: min(100%, 56rem);
  flex: 1 1 auto;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}

.cue {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem 1.1rem;
}

.cue__phase {
  margin: 0;
  font-size: clamp(1.8rem, 4vw, 2.6rem);
  font-weight: 600;
  letter-spacing: -0.04em;
  color: var(--muted);
  transition: color 280ms var(--ease);
}

.cue__phase--sing {
  color: var(--ink);
}

.cue__note {
  margin: 0;
  min-width: 3ch;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.beats {
  display: flex;
  gap: 0.45rem;
  margin: 0 0 0 auto;
  padding: 0;
  list-style: none;
  align-self: center;
}

.beats__dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ink) 14%, transparent);
  transition:
    background 120ms linear,
    transform 120ms linear;
}

.beats__dot--on {
  background: var(--muted);
  transform: scale(1.25);
}

.beats__dot--on.beats__dot--sing {
  background: var(--accent);
}

.result {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  min-height: 2rem;
}

.result__last {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.result__note {
  font-weight: 600;
}

.result__bad {
  color: var(--muted);
}

.result__idle {
  color: var(--muted);
}

.history {
  display: flex;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history__dot {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
}

.history__dot--hit {
  background: var(--loudness-good);
}

.history__dot--near {
  background: var(--loudness-soft);
}

.history__dot--miss {
  background: var(--loudness-loud);
}

.error {
  margin: 0;
  padding: 0.8rem 1rem;
  border: 1px solid color-mix(in srgb, var(--tonic) 55%, var(--line));
  border-radius: var(--radius-core);
  background: color-mix(in srgb, var(--tonic) 14%, transparent);
}
</style>
