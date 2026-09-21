<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { PhInfo, PhMicrophone, PhMusicNotes } from '@phosphor-icons/vue'
import { useRoute } from 'vue-router'
import type { MapPosition } from '@audio-core/core/index'
import IconSwitch from '@/components/controls/IconSwitch.vue'
import ExerciseConsole from '@/components/exercise/ExerciseConsole.vue'
import ExerciseScreen from '@/components/exercise/ExerciseScreen.vue'
import PitchRoll from '@/components/pitch/PitchRoll.vue'
import VolumeStrip from '@/components/volume/VolumeStrip.vue'
import type { BreathTarget } from '@/components/pitch/breath'
import type { PitchTarget } from '@/components/pitch/trace'
import { loudnessColor } from '@/components/loudness'
import { useExercise } from '@/composables/useExercise'
import { useTrainingScore } from '@/composables/useTrainingScore'
import {
  LOUDNESS_ZONES,
  ONSETS,
  expandBars,
  isBreath,
  isNote,
  noteSegments,
  pitchSpan,
  previewBpm,
  toBreaths,
  toTargets,
  type TrainingDraft,
} from '@/training/builder'
import {
  COUNT_IN_BARS,
  gradeNote,
  planRun,
  runBarBeat,
  runBarElements,
  runBarNotes,
  type NoteResult,
  type PassSummary,
} from '@/training/customRun'
import type { ExerciseDefinition } from '@/training/exercises'
import { noteName } from '@/training/keys'

const props = defineProps<{
  draft: TrainingDraft
}>()

/** Seconds of sung history and of upcoming notes on the chart. */
const HISTORY_SECONDS = 4
const AHEAD_SECONDS = 4

// The draft of a link does not change while the page is open.
const draft = props.draft
const plan = planRun(draft)
const definition: ExerciseDefinition = {
  title: draft.title || 'Своя тренировка',
  defaults: { bpm: previewBpm(draft), beats: draft.beats },
  listen: true,
}
const exercise = useExercise(definition)
const { settings, session } = exercise
const { playing, pitch, error, micState, rawLevel, averageLevel, calibration } = session
const route = useRoute()

// The description greets whoever opens the link, and can be read again from the terms row.
const about = ref<HTMLDialogElement | null>(null)

function openAbout() {
  about.value?.showModal()
}

function closeAbout() {
  about.value?.close()
}

/** A click on the backdrop lands on the dialog itself, outside its box. */
function onAboutClick(event: MouseEvent) {
  if (event.target === about.value) closeAbout()
}

onMounted(() => {
  // The route's title is generic; the tab should say which training this is.
  if (draft.title) document.title = draft.title
  if (draft.description) openAbout()
})

/** The reference plays the training's notes along the clicks. */
const melody = ref(true)

// The meter is the training's; the console shows it locked, this keeps it so.
watch(settings.beats, (beats) => {
  if (beats !== draft.beats) settings.beats.value = draft.beats
})

const position = shallowRef<MapPosition | null>(null)
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

watch(playing, (on) => {
  cancelAnimationFrame(raf)
  position.value = null
  if (on) raf = requestAnimationFrame(follow)
})

onBeforeUnmount(() => cancelAnimationFrame(raf))

const epoch = computed(() => position.value?.epoch ?? 0)
/** Bar of the training across passes; −1 while counting in or stopped. */
const sequence = computed(() =>
  position.value === null ? -1 : Math.max(-1, position.value.bar - COUNT_IN_BARS),
)

// The reference plays this bar and the next, so the next bar's first note is never late.
watch(
  [sequence, epoch, melody, playing],
  () => {
    if (!playing.value || !melody.value) {
      session.setNotes([], epoch.value)
      return
    }
    const from = Math.max(0, sequence.value)
    session.setNotes(
      [...runBarNotes(plan, from, 0.45), ...runBarNotes(plan, from + 1, 0.45)],
      epoch.value,
    )
  },
  { immediate: true },
)

const { passes, currentPass, last } = useTrainingScore({
  session,
  plan,
  loudness: draft.loudness,
  sequence,
  epoch,
})

// ---- The chart: notes and breaths around now, on the trace clock ----

const span = computed(() => {
  const found = pitchSpan(draft.bars.flatMap((bar) => bar.elements))
  const middle = found ? Math.round((found.low + found.high) / 2) : 64
  return {
    low: Math.min(found?.low ?? middle, middle - 6) - 2,
    high: Math.max(found?.high ?? middle, middle + 6) + 2,
  }
})

/** Where the first note sits on the chart before Play, seconds after its now. */
const PREVIEW_LEAD = 0.5

/** Before Play the chart shows how the training starts, breaths moving on their own. */
const preview = computed(() => {
  const played = expandBars(
    draft.bars.map((bar) => bar.elements),
    draft.repeats,
  )
  const bpm = settings.bpm.value
  return {
    targets: toTargets(played, draft.beats, bpm, PREVIEW_LEAD),
    breaths: toBreaths(played, draft.beats, bpm, PREVIEW_LEAD),
  }
})

const chart = computed(() => {
  if (!playing.value) return preview.value
  const at = position.value
  const targets: PitchTarget[] = []
  const breaths: BreathTarget[] = []
  if (at === null || micState.value !== 'running') return { targets, breaths }
  const { grid } = at
  for (let bar = Math.max(0, sequence.value - 1); bar <= sequence.value + 2; bar++) {
    const barStart = runBarBeat(plan, bar)
    for (const { element, offset, beats, next, anchor } of runBarElements(plan, bar)) {
      const beat = barStart + offset
      const start = session.traceTimeOf(grid.beatToSeconds(beat))
      const end = session.traceTimeOf(grid.beatToSeconds(beat + beats))
      if (start === null || end === null) continue
      if (isBreath(element)) {
        breaths.push({ kind: element.type, start, duration: end - start, midi: anchor })
      } else if (isNote(element)) {
        targets.push({
          midi: element.midi,
          start,
          segments: noteSegments(element, end - start, next),
        })
      }
    }
  }
  return { targets, breaths }
})

// ---- Read-outs ----

const onset = ONSETS.find((option) => option.onset === draft.onset)
const zone = LOUDNESS_ZONES.find((option) => option.zone === draft.loudness) ?? null
/** The microphone is open, but nobody has calibrated it: the meter is on the plain scale. */
const needsCalibration = computed(() => micState.value === 'running' && calibration.value === null)

/** The mean of the last second sits in the training's zone. */
const inZone = computed(
  () => zone !== null && zone.low <= averageLevel.value && averageLevel.value <= zone.high,
)

function pitchText(result: NoteResult): string {
  if (result.cents === null) return 'не услышал'
  const cents = Math.round(result.cents)
  return `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${Math.abs(cents)} ¢`
}

function timingText(result: NoteResult): string {
  if (result.offsetSeconds === null) return ''
  const ms = Math.round(Math.abs(result.offsetSeconds) * 1000)
  if (result.onTime) return 'вовремя'
  return result.offsetSeconds > 0 ? `${ms} мс поздно` : `${ms} мс рано`
}

function passText(summary: PassSummary): string {
  const parts = [`высота ${summary.inTune}`, `время ${summary.onTime}`]
  if (summary.loud !== null) parts.push(`громкость ${summary.loud}`)
  return parts.join(' · ')
}
</script>

<template>
  <ExerciseScreen :title="definition.title">
    <section class="stage" :aria-label="definition.title">
      <ul class="terms" aria-label="Условия тренировки">
        <li v-if="onset" class="term" :title="onset.hint">
          <span class="term__label">Смык</span>
          {{ onset.label }}
        </li>
        <li v-if="zone" class="term" :class="{ 'term--on': playing && inZone }">
          <span class="term__label">Громкость</span>
          <span
            class="term__dot"
            :style="{ background: loudnessColor((zone.low + zone.high) / 2) }"
            aria-hidden="true"
          />
          {{ zone.label }}
        </li>
        <li v-if="draft.bpmRange" class="term">
          <span class="term__label">Темп</span>
          {{ draft.bpmRange.min }}–{{ draft.bpmRange.max }}
        </li>
        <li v-if="draft.description">
          <button type="button" class="term term--button" @click="openAbout">
            <PhInfo :size="14" weight="light" aria-hidden="true" />
            Описание
          </button>
        </li>
        <li>
          <RouterLink
            class="term term--button"
            :class="{ 'term--attention': needsCalibration }"
            :to="{ name: 'calibration', query: { next: route.fullPath } }"
          >
            <PhMicrophone :size="14" weight="light" aria-hidden="true" />
            {{ needsCalibration ? 'Откалибровать микрофон' : 'Калибровка' }}
          </RouterLink>
        </li>
      </ul>

      <PitchRoll
        :trace="pitch"
        :targets="chart.targets"
        :breaths="chart.breaths"
        :low="span.low"
        :high="span.high"
        :seconds="HISTORY_SECONDS"
        :ahead="AHEAD_SECONDS"
        :now="playing ? undefined : 0"
        :breath-loop="!playing"
      />

      <div class="result">
        <p class="result__last" aria-live="polite">
          <template v-if="last">
            <span class="result__note">{{ noteName(last.midi) }}</span>
            <span :class="{ result__bad: !last.inTune }">{{ pitchText(last) }}</span>
            <span :class="{ result__bad: !last.onTime }">{{ timingText(last) }}</span>
            <span v-if="last.loudOk !== null" :class="{ result__bad: !last.loudOk }">
              {{ last.loudOk ? 'громкость в зоне' : 'громкость мимо' }}
            </span>
          </template>
          <span v-else class="result__idle">
            {{
              plan.noteCount === 0
                ? 'В тренировке нет нот для оценки'
                : 'Оценка появится после первого такта'
            }}
          </span>
        </p>
        <ol class="history" aria-label="Ноты этого прохода">
          <li
            v-for="(result, index) in currentPass"
            :key="index"
            class="history__dot"
            :class="`history__dot--${gradeNote(result)}`"
            :title="`${noteName(result.midi)}: ${pitchText(result)} ${timingText(result)}`"
          />
        </ol>
      </div>

      <ol v-if="passes.length" class="passes" aria-label="Проходы">
        <li v-for="summary in passes" :key="summary.pass" class="pass">
          <span class="pass__title">Проход {{ summary.pass + 1 }}</span>
          <span class="pass__hits">{{ summary.hits }} из {{ summary.notes }}</span>
          <span class="pass__detail">{{ passText(summary) }}</span>
        </li>
      </ol>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <dialog
        v-if="draft.description"
        ref="about"
        class="about"
        aria-labelledby="about-title"
        @click="onAboutClick"
      >
        <div class="about__box">
          <p class="about__kicker">Тренировка</p>
          <h2 id="about-title" class="about__title">{{ definition.title }}</h2>
          <p class="about__text">{{ draft.description }}</p>
          <button type="button" class="about__go" autofocus @click="closeAbout">Понятно</button>
        </div>
      </dialog>
    </section>

    <template #side>
      <VolumeStrip
        :level="rawLevel"
        :average="averageLevel"
        :success="playing && inZone"
        :low="zone?.low"
        :high="zone?.high"
      />
    </template>

    <template #dock>
      <ExerciseConsole
        :exercise="exercise"
        :bpm-min="draft.bpmRange?.min"
        :bpm-max="draft.bpmRange?.max"
        meter-locked
        metronome-hint="Щелчки метронома. Такты идут и без них."
      >
        <template #voices>
          <IconSwitch
            v-model="melody"
            label="Мелодия"
            hint="Ноты тренировки звучат вместе с тобой."
          >
            <PhMusicNotes :size="18" weight="light" aria-hidden="true" />
          </IconSwitch>
        </template>
      </ExerciseConsole>
    </template>
  </ExerciseScreen>
</template>

<style scoped>
.stage {
  display: grid;
  align-content: center;
  gap: 1.1rem;
  width: min(100%, 56rem);
  flex: 1 1 auto;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}

.term--button {
  color: var(--ink);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.term--attention {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
}

.term--button:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
}

.term--button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.about {
  width: min(32rem, calc(100% - 2rem));
  max-height: calc(100dvh - 4rem);
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-core);
  background: var(--bg-raised);
  color: var(--ink);
  box-shadow: 0 24px 64px var(--shadow);
}

.about::backdrop {
  background: rgb(8 10 14 / 55%);
  backdrop-filter: blur(4px);
}

.about[open] {
  animation: about-in 320ms var(--ease);
}

@keyframes about-in {
  from {
    opacity: 0;
    transform: translateY(0.75rem) scale(0.98);
  }
}

.about__box {
  display: grid;
  gap: 0.75rem;
  padding: 1.5rem 1.6rem 1.4rem;
}

.about__kicker {
  margin: 0;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

.about__title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.about__text {
  margin: 0;
  color: color-mix(in srgb, var(--ink) 85%, var(--muted));
  line-height: 1.6;
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.about__go {
  justify-self: end;
  margin-top: 0.4rem;
  padding: 0.65rem 1.3rem;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.about__go:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .about[open] {
    animation: none;
  }
}

.terms {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.term {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.75rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--bg-raised);
  font-size: 0.85rem;
  font-weight: 600;
  transition: border-color 200ms var(--ease);
}

.term--on {
  border-color: var(--loudness-good);
}

.term__label {
  color: var(--muted);
  font-weight: 500;
}

.term__dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
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

.result__bad,
.result__idle {
  color: var(--muted);
}

.history {
  display: flex;
  flex-wrap: wrap;
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

.passes {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pass {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.9rem;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}

.pass__title {
  min-width: 5.5rem;
  color: var(--muted);
}

.pass__hits {
  font-weight: 600;
}

.pass__detail {
  color: var(--muted);
  font-size: 0.82rem;
}

.error {
  margin: 0;
  padding: 0.8rem 1rem;
  border: 1px solid color-mix(in srgb, var(--tonic) 55%, var(--line));
  border-radius: var(--radius-core);
  background: color-mix(in srgb, var(--tonic) 14%, transparent);
}
</style>
