<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import {
  PhMicrophone,
  PhMicrophoneSlash,
  PhMusicNotes,
  PhVideoCamera,
  PhVideoCameraSlash,
} from '@phosphor-icons/vue'
import MouthFigure from '@/components/face/MouthFigure.vue'
import HarmonicStrings from '@/components/timbre/HarmonicStrings.vue'
import SegmentedChoice, { type SegmentedOption } from '@/components/builder/SegmentedChoice.vue'
import VolumeStrip from '@/components/volume/VolumeStrip.vue'
import { loudnessColor } from '@/components/loudness'
import PitchRoll from '@/components/pitch/PitchRoll.vue'
import { targetEnd, type PitchSegment, type PitchTarget } from '@/components/pitch/trace'
import ExerciseConsole from '@/components/exercise/ExerciseConsole.vue'
import { useExercise } from '@/composables/useExercise'
import { useMouthTracker } from '@/composables/useMouthTracker'
import { LOUDNESS_ZONES, type LoudnessZone } from '@/training/builder'
import { SANDBOX } from '@/training/exercises'
import {
  TIMBRE_TARGET,
  harmonicRatios,
  lackingHarmonics,
  stringStrengths,
  timbreSuccess,
} from '@/training/timbre'

// One live source for the whole sandbox: every component below gets the same real data. The
// console at the bottom drives the same session, so Play and the microphone share one clock.
const exercise = useExercise(SANDBOX)
const {
  level,
  rawLevel,
  averageLevel,
  pitch,
  timbre,
  micState: state,
  error,
  startListening,
  stopListening,
} = exercise.session

// Loudness: the strip against a chosen zone; the zone and the average are the only things judged.
const zoneOptions: SegmentedOption<LoudnessZone>[] = LOUDNESS_ZONES.map((option) => ({
  value: option.zone,
  label: option.label,
  color: loudnessColor((option.low + option.high) / 2),
}))
const zoneId = ref<LoudnessZone>('good')
const zone = computed(() => LOUDNESS_ZONES.find((option) => option.zone === zoneId.value)!)
const inZone = computed(
  () => zone.value.low <= averageLevel.value && averageLevel.value <= zone.value.high,
)

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

// Timbre: the strings follow the voice's first three harmonics against the default target.
const ratios = computed(() => (timbre.value ? harmonicRatios(timbre.value) : null))
const strengths = computed(() => stringStrengths(ratios.value, level.value))
const timbreTargets = computed(() => stringStrengths(TIMBRE_TARGET, Math.max(level.value, 0.5)))
const success = computed(() => (ratios.value ? timbreSuccess(ratios.value) : 0))
const lacking = computed(() => (ratios.value ? lackingHarmonics(ratios.value) : []))
const braids = ref(0)

const formatDb = (value: number | undefined) =>
  value === undefined
    ? '—'
    : `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Math.round(value))} дБ`

// The mouth follows the webcam; `success` has no exercise behind it here, the slider only shows
// how the colour blends.
const face = useMouthTracker()
const { status: faceStatus, error: faceError, mouth } = face
const mouthSuccess = ref(0)

function toggleCamera(): void {
  if (faceStatus.value === 'running') face.stop()
  else void face.start()
}

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
      <div class="head__actions">
        <RouterLink class="calibrate" :to="{ name: 'calibration', query: { next: '/lab' } }">
          Калибровка микрофона
        </RouterLink>
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
      </div>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section class="category" aria-labelledby="category-volume">
      <h2 id="category-volume" class="category__title">Громкость</h2>
      <ul class="specimens">
        <li class="specimen specimen--wide">
          <SegmentedChoice v-model="zoneId" :options="zoneOptions" label="Зона громкости" />
          <div class="strip-stage">
            <VolumeStrip
              :level="rawLevel"
              :average="averageLevel"
              :success="inZone"
              :low="zone.low"
              :high="zone.high"
            />
          </div>
          <code class="specimen__name">VolumeStrip</code>
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

    <section class="category" aria-labelledby="category-timbre">
      <h2 id="category-timbre" class="category__title">Тембр</h2>
      <ul class="specimens">
        <li class="specimen specimen--wide">
          <HarmonicStrings
            :strengths="strengths"
            :targets="timbreTargets"
            :success="success"
            :lacking="lacking"
            @braided="braids++"
          />
          <dl class="timbre-readout">
            <div>
              <dt>H2 к H1</dt>
              <dd>{{ formatDb(ratios?.h2) }}</dd>
            </div>
            <div>
              <dt>H3 к H1</dt>
              <dd>{{ formatDb(ratios?.h3) }}</dd>
            </div>
            <div>
              <dt>success</dt>
              <dd>{{ success.toFixed(2) }}</dd>
            </div>
            <div>
              <dt>Сплетено</dt>
              <dd>{{ braids }}</dd>
            </div>
          </dl>
          <code class="specimen__name">
            HarmonicStrings · цель H2 ≥ {{ TIMBRE_TARGET.h2 }}, H3 ≥ {{ TIMBRE_TARGET.h3 }} дБ
          </code>
        </li>
      </ul>
    </section>

    <section class="category" aria-labelledby="category-mouth">
      <h2 id="category-mouth" class="category__title">Рот</h2>
      <ul class="specimens">
        <li class="specimen specimen--wide">
          <div class="pitch-tools">
            <button
              type="button"
              class="preview"
              :class="{ 'preview--on': faceStatus === 'running' }"
              :aria-pressed="faceStatus === 'running'"
              :disabled="faceStatus === 'loading'"
              @click="toggleCamera"
            >
              <PhVideoCameraSlash
                v-if="faceStatus === 'running'"
                :size="16"
                weight="light"
                aria-hidden="true"
              />
              <PhVideoCamera v-else :size="16" weight="light" aria-hidden="true" />
              {{
                faceStatus === 'running'
                  ? 'Выключить камеру'
                  : faceStatus === 'loading'
                    ? 'Подключаю…'
                    : 'Включить камеру'
              }}
            </button>
            <label class="success">
              success
              <input v-model.number="mouthSuccess" type="range" min="0" max="1" step="0.01" />
              <output>{{ mouthSuccess.toFixed(2) }}</output>
            </label>
          </div>
          <p v-if="faceError" class="error" role="alert">{{ faceError.message }}</p>
          <div class="mouth-stage">
            <MouthFigure
              :class="{ 'mouth-stage--idle': !mouth }"
              :open="mouth?.open ?? 0"
              :narrow="mouth?.narrow ?? 0"
              :aperture="mouth?.aperture ?? 0"
              :width="mouth?.width ?? 0.5"
              :success="mouthSuccess"
            />
          </div>
          <code class="specimen__name">MouthFigure · useMouthTracker</code>
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

.head__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.calibrate {
  padding: 0.7rem 1.1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  color: var(--muted);
  font-weight: 600;
  text-decoration: none;
  transition:
    border-color 280ms var(--ease),
    color 280ms var(--ease);
}

.calibrate:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  color: var(--ink);
}

.calibrate:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
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

.strip-stage {
  height: 22rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-core);
  background: var(--bg);
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

.preview:disabled {
  opacity: 0.6;
  cursor: progress;
}

.success {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--muted);
  font-size: 0.8rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.success input {
  accent-color: var(--accent);
}

.timbre-readout {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.75rem;
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.timbre-readout dt {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}

.timbre-readout dd {
  margin: 0.15rem 0 0;
  font-weight: 600;
}

.mouth-stage {
  display: grid;
  place-items: center;
  min-height: 9rem;
}

.mouth-stage--idle {
  opacity: 0.45;
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
