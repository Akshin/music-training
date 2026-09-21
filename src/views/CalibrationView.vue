<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ExerciseScreen from '@/components/exercise/ExerciseScreen.vue'
import VolumeStrip from '@/components/volume/VolumeStrip.vue'
import {
  CALIBRATION_STEPS,
  useCalibrationRun,
  type CalibrationStep,
  type CalibrationTrouble,
} from '@/composables/useCalibrationRun'
import { useExerciseSession } from '@/composables/useExerciseSession'
import { NOISE_MARGIN_DB, levelMap, looksBluetooth } from '@/training/calibration'

const route = useRoute()
const router = useRouter()

/** Where the way back leads: a path inside the app, else the list of trainings. */
const back = computed(() => {
  const value = route.query.next
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/'
})

// Only the microphone is used: the strip reads the plain −60…0 dBFS scale, not a calibration.
const session = useExerciseSession()
const { micState, error, rawDbfs, averageDbfs } = session
const run = useCalibrationRun(session)
const { status, step, measures, progress, holding, trouble, device } = run

const plain = levelMap(null)
const stripLevel = computed(() => plain(rawDbfs.value))
const stripAverage = computed(() => plain(averageDbfs.value))

interface StepCopy {
  readonly title: string
  readonly head: string
  readonly body: string
  readonly label: string
}

const STEP_COPY: Record<CalibrationStep, StepCopy> = {
  noise: {
    label: 'Тишина',
    title: 'Сначала послушаю комнату',
    head: 'Помолчи две секунды',
    body: 'Не пой и не говори — я замеряю шум, чтобы отличать от него голос.',
  },
  quiet: {
    label: 'Тихо',
    title: 'Теперь спой тихо',
    head: 'Спой «а» тихо',
    body: 'Так тихо, как можешь, но чтобы голос ещё звучал, а не шептал. Держи ровно две секунды.',
  },
  comfortable: {
    label: 'Удобно',
    title: 'Теперь спой удобно',
    head: 'Спой «а» в удобную громкость',
    body: 'Как поёшь обычно, без усилия и без экономии. Держи ровно две секунды.',
  },
  loud: {
    label: 'Громко',
    title: 'Осталась громкая нота',
    head: 'Спой «а» громко',
    body: 'Насколько можешь без напряжения и крика. Держи ровно две секунды.',
  },
}

const INTRO = {
  title: 'Настроим громкость под твой микрофон',
  kicker: 'Три ноты и тишина',
  head: 'Это займёт около двадцати секунд',
  body: 'Ты споёшь «а» три раза: тихо, удобно и громко, по две секунды на каждый. Так «Тихо», «Средне» и «Громко» в тренировках будут означать твой голос, а не громкость микрофона.',
}

const stepId = computed(() => CALIBRATION_STEPS[step.value] ?? 'noise')
const copy = computed(() => STEP_COPY[stepId.value])

const title = computed(() =>
  status.value === 'idle'
    ? INTRO.title
    : status.value === 'done'
      ? 'Микрофон настроен'
      : copy.value.title,
)

function troubleText(fault: CalibrationTrouble, id: CalibrationStep): string {
  switch (fault) {
    case 'noisy':
      return 'Тихая нота тонет в шуме комнаты. Спой чуть громче или придвинься к микрофону.'
    case 'order':
      return id === 'loud'
        ? 'Почти как удобная. Спой заметно громче — до предела, где голос ещё не напрягается.'
        : 'Почти как тихая. Спой заметно громче.'
    case 'narrow':
      return 'Между тихой и громкой мало разницы. Спой громче — до предела, где голос ещё не напрягается.'
    case 'clipped':
      return 'Звук режется. Отодвинься от микрофона или убавь уровень входа в системе.'
  }
}

/** The line under the bar: what is heard now and what to do. */
const message = computed<{ tone: 'ok' | 'bad' | ''; text: string } | null>(() => {
  if (status.value !== 'running') return null
  if (step.value === 0) return { tone: '', text: 'Слушаю тишину…' }
  if (holding.value) return { tone: 'ok', text: 'Ровно — держи' }
  if (trouble.value !== null) {
    return { tone: 'bad', text: troubleText(trouble.value, stepId.value) }
  }
  const heard = averageDbfs.value >= (measures.value.noise ?? -120) + NOISE_MARGIN_DB
  return {
    tone: '',
    text: heard ? 'Держи ровно — уровень ещё плавает' : 'Спой «а» — пока не слышу голос',
  }
})

const steps = computed(() =>
  CALIBRATION_STEPS.map((id, index) => {
    const state =
      status.value === 'done' || (status.value === 'running' && step.value > index)
        ? 'done'
        : status.value === 'running' && step.value === index
          ? 'cur'
          : 'todo'
    const measured = measures.value[id]
    const note =
      state === 'done' && measured !== undefined
        ? formatDb(measured)
        : state === 'cur'
          ? 'сейчас'
          : ''
    return { id, label: STEP_COPY[id].label, state, note }
  }),
)

const bluetooth = computed(
  () =>
    status.value === 'running' &&
    device.value !== null &&
    looksBluetooth(device.value.name, device.value.sampleRate),
)

function formatDb(value: number): string {
  return `${value < 0 ? '−' : ''}${Math.abs(Math.round(value))} дБ`
}

function formatRate(rate: number): string {
  return `${(rate / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} кГц`
}

const goBack = () => router.push(back.value)
const backLabel = computed(() => (back.value === '/' ? 'К тренировкам' : 'Вернуться к тренировке'))
</script>

<template>
  <ExerciseScreen title="Калибровка микрофона">
    <template #side>
      <VolumeStrip
        :level="stripLevel"
        :average="stripAverage"
        :success="holding"
        label="Громкость микрофона"
      />
    </template>

    <section class="calib" aria-labelledby="calib-title">
      <RouterLink :to="back" class="calib__back">← Назад</RouterLink>

      <header class="calib__head">
        <p class="kicker">Калибровка микрофона</p>
        <h2 id="calib-title" class="calib__title">{{ title }}</h2>
      </header>

      <p v-if="device" class="calib__device">
        <span class="chip">
          <span class="chip__dot" aria-hidden="true" />
          {{ device.name }}
          <template v-if="device.sampleRate > 0"> · {{ formatRate(device.sampleRate) }}</template>
        </span>
      </p>

      <p v-if="bluetooth" class="calib__warn">
        Bluetooth-гарнитура сама обрабатывает голос, и результат может слегка плавать. С проводными
        наушниками или встроенным микрофоном выйдет точнее.
      </p>

      <ol class="steps" aria-label="Шаги калибровки">
        <li v-for="item in steps" :key="item.id" class="step" :class="`step--${item.state}`">
          <b class="step__name">{{ item.label }}</b>
          <small class="step__note">{{ item.note }}</small>
        </li>
      </ol>

      <div class="card">
        <template v-if="status === 'idle'">
          <p class="kicker">{{ INTRO.kicker }}</p>
          <h3 class="card__head">{{ INTRO.head }}</h3>
          <p class="card__body">{{ INTRO.body }}</p>
        </template>
        <template v-else-if="status === 'done'">
          <p class="kicker">Готово</p>
          <h3 class="card__head">Калибровка сохранена для «{{ device?.name }}»</h3>
          <p class="card__body">
            Теперь «Тихо», «Средне» и «Громко» в тренировках — это твои тихая, удобная и громкая
            ноты. Для другого микрофона калибровку придётся пройти отдельно.
          </p>
        </template>
        <template v-else>
          <p class="kicker">Шаг {{ step + 1 }} из {{ CALIBRATION_STEPS.length }}</p>
          <h3 class="card__head">{{ copy.head }}</h3>
          <p class="card__body">{{ copy.body }}</p>
          <div
            class="bar"
            :class="{ 'bar--held': holding }"
            role="progressbar"
            aria-label="Держи ровно"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="Math.round(progress * 100)"
          >
            <span class="bar__fill" :style="{ width: `${progress * 100}%` }" />
          </div>
          <p
            v-if="message"
            class="card__msg"
            :class="message.tone && `card__msg--${message.tone}`"
            aria-live="polite"
          >
            {{ message.text }}
          </p>
        </template>
      </div>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="actions">
        <template v-if="status === 'idle'">
          <button
            type="button"
            class="btn btn--primary calib__btn"
            :disabled="micState === 'starting'"
            @click="run.start()"
          >
            {{ micState === 'starting' ? 'Подключаю…' : 'Включить микрофон' }}
          </button>
        </template>
        <template v-else-if="status === 'done'">
          <button type="button" class="btn btn--primary calib__btn" @click="goBack">
            {{ backLabel }}
          </button>
          <button type="button" class="btn calib__btn" @click="run.start()">Пройти заново</button>
        </template>
        <button v-else type="button" class="btn calib__btn" @click="run.start()">Заново</button>
      </div>
    </section>
  </ExerciseScreen>
</template>

<style scoped>
.calib {
  display: grid;
  align-content: start;
  gap: 0.9rem;
  width: min(100%, 40rem);
  flex: 1 1 auto;
  margin: 0 auto;
  padding: 1.25rem 1rem 2rem 0.75rem;
}

.calib__back {
  justify-self: start;
  color: var(--muted);
  font-size: 0.85rem;
  text-decoration: none;
}

.calib__back:hover {
  color: var(--ink);
}

.calib__back:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.calib__head .kicker {
  margin-bottom: 0.3rem;
}

.calib__title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.2;
  text-wrap: balance;
}

.calib__device {
  margin: 0;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--bg-raised);
  font-size: 0.82rem;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.chip__dot {
  flex: 0 0 auto;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--loudness-good);
}

.calib__warn {
  margin: 0;
  padding: 0.6rem 0.8rem;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--line));
  border-radius: 0.8rem;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  font-size: 0.82rem;
  line-height: 1.5;
}

.steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--line);
  border-radius: 0.9rem;
  background: var(--bg-raised);
  transition:
    border-color 200ms var(--ease),
    opacity 200ms var(--ease);
}

.step__name {
  display: block;
  font-size: 0.82rem;
  font-weight: 600;
}

.step__note {
  display: block;
  min-height: 1rem;
  color: var(--muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.step--todo {
  opacity: 0.55;
}

.step--cur {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--line));
}

.step--done {
  border-color: color-mix(in srgb, var(--loudness-good) 55%, var(--line));
}

.step--done .step__note {
  color: var(--loudness-good);
}

.card {
  display: grid;
  gap: 0.65rem;
  padding: 1rem 1.15rem;
  border: 1px solid var(--line);
  border-radius: 1.25rem;
  background: var(--bg-raised);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 12%);
}

.card .kicker {
  margin: 0;
  font-size: 0.68rem;
}

.card__head {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}

.card__body {
  margin: 0;
  color: var(--muted);
  font-size: 0.88rem;
  line-height: 1.55;
}

.card__msg {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 500;
}

.card__msg--ok {
  color: var(--loudness-good);
}

.card__msg--bad {
  color: var(--accent);
}

.bar {
  position: relative;
  height: 0.5rem;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--bg-inset);
  box-shadow: inset 0 0 0 1px var(--line);
}

.bar__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--accent);
  transition: background 240ms var(--ease);
}

.bar--held .bar__fill {
  background: var(--loudness-good);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.calib__btn {
  height: 2.6rem;
  padding: 0 1.4rem;
  font-size: 0.88rem;
}

.error {
  margin: 0;
  padding: 0.8rem 1rem;
  border: 1px solid color-mix(in srgb, var(--tonic) 55%, var(--line));
  border-radius: var(--radius-core);
  background: color-mix(in srgb, var(--tonic) 14%, transparent);
}

@media (max-width: 520px) {
  .steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
