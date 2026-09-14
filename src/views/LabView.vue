<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { PhMicrophone, PhMicrophoneSlash, PhMusicNotes } from '@phosphor-icons/vue'
import PitchRoll from '@/components/pitch/PitchRoll.vue'
import { targetEnd, type PitchSegment, type PitchTarget } from '@/components/pitch/trace'
import VolumeBar from '@/components/volume/VolumeBar.vue'
import VolumeCapsule from '@/components/volume/VolumeCapsule.vue'
import VolumeSegments from '@/components/volume/VolumeSegments.vue'
import ExerciseConsole from '@/components/exercise/ExerciseConsole.vue'
import { useExercise } from '@/composables/useExercise'
import { SANDBOX } from '@/training/exercises'

// One live source for the whole sandbox: every component below gets the same real data. The
// console at the bottom drives the same session, so Play and the microphone share one clock.
const exercise = useExercise(SANDBOX)
const { level, pitch, micState: state, error, startListening, stopListening } = exercise.session

/** Ranges to try the flexible note axis with, from a fifth to three octaves. */
const PITCH_RANGES = [
  { label: 'Квинта', low: 60, high: 67 },
  { label: 'Октава', low: 60, high: 72 },
  { label: 'Две октавы', low: 48, high: 72 },
  { label: 'Три октавы', low: 48, high: 84 },
] as const

type PitchRange = (typeof PITCH_RANGES)[number]

const pitchRange = ref<PitchRange>(PITCH_RANGES[1])

/**
 * Seconds of upcoming notes shown while the preview runs — the same as the chart's history (its
 * default 6 s), so now sits in the middle.
 */
const PREVIEW_AHEAD = 6
/** Notes older than this many seconds are dropped from the preview. */
const PREVIEW_KEEP = 8

// A preview of how target notes look on the chart: random notes from the chosen range scroll in
// from the right. It only exercises the drawing; no exercise logic is behind it. With the
// microphone on, the notes run on the voice's clock so the voice can be seen against them; with
// it off, the lab keeps its own clock and hands it to the chart as `now`.
const previewOn = ref(false)
const previewTargets = shallowRef<PitchTarget[]>([])
const previewNow = ref<number | undefined>(undefined)
let previewRaf = 0
let previewClock: 'voice' | 'lab' | null = null
let labClockOrigin = 0
let nextStart = 0

/** Note shapes the preview picks from: single segments and the ways they combine. */
function previewSegments(midi: number, low: number, high: number): PitchSegment[] {
  const between = (min: number, max: number) => min + Math.random() * (max - min)
  // A slide by up to a fifth either way, kept inside the range.
  const step = (1 + Math.floor(Math.random() * 7)) * (Math.random() < 0.5 ? -1 : 1)
  const to = Math.min(high, Math.max(low, midi + step))
  const shapes: PitchSegment[][] = [
    [{ kind: 'hold', duration: between(0.5, 1.3) }],
    [{ kind: 'staccato', duration: between(0.25, 0.4) }],
    [
      { kind: 'staccato', duration: between(0.12, 0.2) },
      { kind: 'hold', duration: between(0.4, 0.8) },
    ],
    [
      { kind: 'hold', duration: between(0.4, 0.8) },
      { kind: 'slide', to, duration: between(0.3, 0.6) },
    ],
    [
      { kind: 'staccato', duration: between(0.12, 0.2) },
      { kind: 'slide', to, duration: between(0.3, 0.6) },
      { kind: 'hold', duration: between(0.3, 0.7) },
    ],
  ]
  return shapes[Math.floor(Math.random() * shapes.length)]!
}

function previewTick(): void {
  const trace = pitch.value
  const clock = trace.length > 0 ? 'voice' : 'lab'
  const now = clock === 'voice' ? trace.endTime : (performance.now() - labClockOrigin) / 1000
  if (clock !== previewClock) {
    // The clocks do not line up, so a switch starts the stream over.
    previewClock = clock
    previewTargets.value = []
    nextStart = now + 0.5
  }
  previewNow.value = clock === 'lab' ? now : undefined

  let targets = previewTargets.value.filter((target) => targetEnd(target) > now - PREVIEW_KEEP)
  let changed = targets.length !== previewTargets.value.length
  while (nextStart < now + PREVIEW_AHEAD + 1) {
    const { low, high } = pitchRange.value
    const midi = low + Math.floor(Math.random() * (high - low + 1))
    const target: PitchTarget = {
      midi,
      start: nextStart,
      segments: previewSegments(midi, low, high),
    }
    targets = [...targets, target]
    nextStart = targetEnd(target) + 0.15 + Math.random() * 0.4
    changed = true
  }
  if (changed) previewTargets.value = targets
  previewRaf = requestAnimationFrame(previewTick)
}

function togglePreview(): void {
  cancelAnimationFrame(previewRaf)
  previewOn.value = !previewOn.value
  previewTargets.value = []
  previewNow.value = undefined
  previewClock = null
  if (!previewOn.value) return
  labClockOrigin = performance.now()
  previewRaf = requestAnimationFrame(previewTick)
}

onBeforeUnmount(() => {
  cancelAnimationFrame(previewRaf)
})

function toggleMic(): void {
  if (state.value === 'running') void stopListening()
  else startListening().catch(() => {})
}
</script>

<template>
  <main id="main" class="lab">
    <header class="head">
      <div>
        <p class="kicker">Лаборатория</p>
        <h1 class="head__title">Песочница</h1>
        <p class="head__lead">Компоненты на живых данных. Источник — микрофон.</p>
      </div>
      <button
        type="button"
        class="mic"
        :class="{ 'mic--on': state === 'running' }"
        :aria-pressed="state === 'running'"
        :disabled="state === 'starting'"
        @click="toggleMic"
      >
        <PhMicrophoneSlash
          v-if="state === 'running'"
          :size="16"
          weight="light"
          aria-hidden="true"
        />
        <PhMicrophone v-else :size="16" weight="light" aria-hidden="true" />
        {{
          state === 'running'
            ? 'Выключить микрофон'
            : state === 'starting'
              ? 'Подключаю…'
              : 'Включить микрофон'
        }}
      </button>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section class="category" aria-labelledby="category-volume">
      <h2 id="category-volume" class="category__title">Громкость</h2>
      <ul class="specimens">
        <li class="specimen">
          <VolumeBar :value="level" />
          <code class="specimen__name">VolumeBar</code>
        </li>
        <li class="specimen">
          <VolumeSegments :value="level" />
          <code class="specimen__name">VolumeSegments</code>
        </li>
        <li class="specimen">
          <VolumeCapsule :value="level" />
          <code class="specimen__name">VolumeCapsule</code>
        </li>
      </ul>
    </section>

    <section class="category" aria-labelledby="category-pitch">
      <h2 id="category-pitch" class="category__title">Высота</h2>
      <ul class="specimens">
        <li class="specimen specimen--wide">
          <div class="pitch-tools">
            <div class="ranges" role="radiogroup" aria-label="Диапазон нот">
              <button
                v-for="range in PITCH_RANGES"
                :key="range.label"
                type="button"
                role="radio"
                class="ranges__opt"
                :class="{ 'ranges__opt--on': range.label === pitchRange.label }"
                :aria-checked="range.label === pitchRange.label"
                @click="pitchRange = range"
              >
                {{ range.label }}
              </button>
            </div>
            <button
              type="button"
              class="preview"
              :class="{ 'preview--on': previewOn }"
              :aria-pressed="previewOn"
              @click="togglePreview"
            >
              <PhMusicNotes :size="16" weight="light" aria-hidden="true" />
              {{ previewOn ? 'Остановить ноты' : 'Пустить ноты' }}
            </button>
          </div>
          <PitchRoll
            :trace="pitch"
            :low="pitchRange.low"
            :high="pitchRange.high"
            :targets="previewTargets"
            :ahead="previewOn ? PREVIEW_AHEAD : 0"
            :now="previewNow"
          />
        </li>
      </ul>
    </section>

    <section class="category" aria-labelledby="category-controls">
      <h2 id="category-controls" class="category__title">Контролы</h2>
      <p class="category__note">
        <code>ExerciseConsole</code> на <code>ControlSheet</code> — внизу страницы. Стрелка или
        свайп по ней открывают и закрывают панель; на узком экране она выезжает поверх страницы.
        Настройки и Play настоящие: метроном играет на той же сессии, что слушает микрофон.
      </p>
    </section>

    <ExerciseConsole :exercise="exercise" class="lab__console" />
  </main>
</template>

<style scoped>
.lab {
  max-width: 56rem;
  margin: 0 auto;
  padding: 0 1rem 5rem;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.25rem;
  padding: 4rem 0 2.5rem;
}

.kicker {
  margin: 0 0 0.75rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

.head__title {
  margin: 0 0 0.6rem;
  font-size: clamp(2rem, 4.6vw, 3.2rem);
  font-weight: 600;
  letter-spacing: -0.045em;
  line-height: 1.1;
}

.head__lead {
  margin: 0;
  color: var(--muted);
  font-size: 1.05rem;
  line-height: 1.55;
}

.mic {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 1.1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--bg-raised);
  color: var(--ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 280ms var(--ease),
    background 280ms var(--ease),
    color 280ms var(--ease);
}

.mic:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
}

.mic:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.mic:disabled {
  opacity: 0.6;
  cursor: progress;
}

.mic--on {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-ink);
}

.error {
  margin: 0 0 1.5rem;
  padding: 0.8rem 1rem;
  border: 1px solid color-mix(in srgb, var(--tonic) 55%, var(--line));
  border-radius: var(--radius-core);
  background: color-mix(in srgb, var(--tonic) 14%, transparent);
}

.category {
  padding: 1.5rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-shell);
  background: var(--bg-raised);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 12%);
}

.category + .category {
  margin-top: 1.25rem;
}

.category__title {
  margin: 0 0 1.5rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

.specimens {
  display: flex;
  flex-wrap: wrap;
  gap: 2.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.specimen {
  display: grid;
  justify-items: center;
  align-content: end;
  gap: 0.9rem;
  min-width: 6rem;
}

.specimen--wide {
  flex: 1 1 100%;
  justify-items: stretch;
}

.specimen__name {
  font-size: 0.78rem;
  color: var(--muted);
}

.pitch-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.ranges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  padding: 0.3rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--bg-inset) 62%, transparent);
}

.ranges__opt {
  height: 2.1rem;
  padding: 0 0.9rem;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 280ms var(--ease),
    color 280ms var(--ease);
}

.ranges__opt:hover {
  color: var(--ink);
}

.ranges__opt:focus-visible,
.preview:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.ranges__opt--on {
  background: var(--accent);
  color: var(--accent-ink);
}

.ranges__opt--on:hover {
  color: var(--accent-ink);
}

.preview {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  height: 2.8rem;
  padding: 0 1.1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--bg-inset) 62%, transparent);
  color: var(--ink);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 280ms var(--ease),
    background 280ms var(--ease),
    color 280ms var(--ease);
}

.preview:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
}

.preview--on {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-ink);
}

.category__note {
  margin: 0;
  max-width: 60ch;
  color: var(--muted);
  line-height: 1.55;
  text-wrap: pretty;
}

.lab__console {
  margin-top: 2rem;
}
</style>
