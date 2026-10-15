<script setup lang="ts">
import { computed } from 'vue'
import { PhTimer, PhX } from '@phosphor-icons/vue'
import { useLatency } from '@/composables/useLatency'
import { useLatencyCalibration } from '@/composables/useLatencyCalibration'
import { LATENCY_CLICKS } from '@/training/latency'

const calibration = useLatencyCalibration()
const { state, played, last, error } = calibration
const { latencyOf, clearLatency } = useLatency()

const active = computed(() => state.value !== 'idle')

function ms(seconds: number): string {
  return `${Math.round(seconds * 1000)} мс`
}

const status = computed(() => {
  switch (state.value) {
    case 'starting':
      return 'Включаю микрофон…'
    case 'listening':
      return `Щелчок ${played.value} из ${LATENCY_CLICKS}`
    case 'reading':
      return 'Считаю…'
    default:
      return ''
  }
})

/** The analysis's own delays, stage by stage, as measured on the devices of the last run. */
const stages = computed(() => {
  const delays = last.value?.delays
  if (!delays) return []
  const inside = delays.capture + delays.window + delays.hop / 2 + delays.pitch
  return [
    { label: 'Пачка сэмплов с микрофона', value: ms(delays.capture) },
    { label: 'Вторая половина окна анализа', value: ms(delays.window) },
    { label: 'Шаг кадров', value: `до ${ms(delays.hop)}` },
    { label: 'Трекер высоты отстаёт', value: ms(delays.pitch) },
    { label: 'Итого до высоты, в среднем', value: ms(inside) },
    { label: 'Нота опознаётся после начала через', value: ms(delays.notes) },
    { label: 'Вывод, по словам браузера', value: ms(delays.output) },
  ]
})

/** What is stored for the devices of the last run. */
const stored = computed(() => latencyOf(last.value?.device))

const outcome = computed(() => {
  const run = last.value
  if (run === null) return null
  const { trip, fault } = run
  const heard = trip ? `${trip.hits} из ${trip.expected}` : `0 из ${LATENCY_CLICKS}`
  switch (fault) {
    case 'silent':
      return 'Щелчков не слышно. Сделайте звук громче, а в наушниках произносите «та» на каждый щелчок.'
    case 'few':
      return `Услышал только ${heard} щелчков. Повторите в тишине или погромче.`
    case 'unsteady':
      return `Щелчки вернулись вразнобой (±${ms(trip!.spread)}). Повторите; в наушниках — «та» точно в щелчок.`
    case 'far':
      return `Вышло ${ms(trip!.seconds)} — так не бывает, что-то помешало. Повторите.`
    default:
      return `Сохранено: звук возвращается на ${ms(trip!.seconds)} позже, чем сообщает браузер (±${ms(trip!.spread)}, ${heard}). Это учитывается в оценке и вводе голосом.`
  }
})
</script>

<template>
  <div class="latency">
    <p class="latency__lead">
      Щелчки из динамика возвращаются в микрофон — так видно, на сколько звук опаздывает сверх того,
      что сообщает браузер. В наушниках щелчок до микрофона не дойдёт: произносите «та» на каждый
      щелчок.
    </p>

    <div class="latency__actions">
      <button v-if="!active" type="button" class="btn btn--primary" @click="calibration.start">
        <PhTimer :size="16" weight="light" aria-hidden="true" />
        Измерить задержку
      </button>
      <button v-else type="button" class="btn" @click="calibration.cancel">
        <PhX :size="16" weight="light" aria-hidden="true" />
        Отмена
      </button>
      <span class="latency__status" aria-live="polite">{{ status }}</span>
    </div>

    <p v-if="error" class="latency__error" role="alert">
      Микрофон или звук недоступны: {{ error }}
    </p>
    <template v-else-if="last">
      <p class="latency__outcome" aria-live="polite">{{ outcome }}</p>
      <dl class="latency__stages">
        <template v-for="stage in stages" :key="stage.label">
          <dt>{{ stage.label }}</dt>
          <dd>{{ stage.value }}</dd>
        </template>
        <template v-if="last.device">
          <dt>Измерено сверх браузера</dt>
          <dd>{{ stored === null ? 'не измерено' : ms(stored) }}</dd>
        </template>
      </dl>
      <p v-if="last.device" class="latency__device">
        {{ last.device }}
        <button
          v-if="stored !== null"
          type="button"
          class="btn btn--quiet"
          @click="clearLatency(last.device)"
        >
          Сбросить
        </button>
      </p>
    </template>
  </div>
</template>

<style scoped>
.latency {
  display: grid;
  gap: 0.9rem;
}

.latency__lead {
  margin: 0;
  max-width: 44rem;
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.45;
}

.latency__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.9rem;
}

.latency__status {
  color: var(--muted);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.latency__outcome {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.45;
}

.latency__stages {
  display: grid;
  grid-template-columns: minmax(0, max-content) auto;
  gap: 0.35rem 1.5rem;
  margin: 0;
  font-size: 0.85rem;
}

.latency__stages dt {
  color: var(--muted);
}

.latency__stages dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.latency__device {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin: 0;
  color: var(--muted);
  font-size: 0.8rem;
}

.latency__error {
  margin: 0;
  padding: 0.8rem 1rem;
  border: 1px solid color-mix(in srgb, var(--tonic) 55%, var(--line));
  border-radius: var(--radius-core);
  background: color-mix(in srgb, var(--tonic) 14%, transparent);
}
</style>
