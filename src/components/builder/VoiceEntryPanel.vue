<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCheck, PhMicrophone, PhX } from '@phosphor-icons/vue'
import BpmControl from '@/components/controls/BpmControl.vue'
import PitchRoll from '@/components/pitch/PitchRoll.vue'
import type { BuilderDraft, PitchSpan } from '@/composables/useBuilderDraft'
import { useExerciseSession } from '@/composables/useExerciseSession'
import { useSungTake } from '@/composables/useSungTake'
import { isNote, type BarElement } from '@/training/builder'
import { barsFromSung, sixteenthBeats } from '@/training/sungBars'

const props = defineProps<{
  builder: BuilderDraft
  span: PitchSpan
}>()

const emit = defineEmits<{
  /** Full bars read from what was sung, in order. */
  sung: [bars: BarElement[][]]
}>()

/** Seconds of the voice shown while singing. */
const TRACE_SECONDS = 4

/** The tempo to sing at; it starts where the training is previewed and is the singer's to change. */
const bpm = ref(props.builder.bpm.value)
// The take runs on its own copies, so nothing changed mid-take can move the grid under it.
const takeBpm = ref(bpm.value)
const takeBeats = ref(props.builder.beats.value)
const session = useExerciseSession({ bpm: takeBpm, beats: takeBeats, listen: true })
const take = useSungTake(session, { stepBeats: () => sixteenthBeats(takeBeats.value) })
const { state, position } = take
const { pitch, error } = session

const active = computed(() => state.value !== 'idle')
/** What the last take came to, shown until the next one starts. */
const outcome = ref<string | null>(null)

const status = computed(() => {
  switch (state.value) {
    case 'starting':
      return 'Включаю микрофон…'
    case 'counting':
      return `Отсчёт · ${position.value?.beat ?? 1}`
    case 'singing':
      return `Запись · такт ${position.value?.bar ?? 1}, доля ${position.value?.beat ?? 1}`
    case 'reading':
      return 'Разбираю…'
    default:
      return ''
  }
})

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100
  const ones = count % 10
  if (ones === 1 && tens !== 11) return one
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return few
  return many
}

function start() {
  outcome.value = null
  takeBpm.value = bpm.value
  takeBeats.value = props.builder.beats.value
  take.start()
}

async function finish() {
  const sung = await take.finish()
  if (sung === null) return
  if (sung.beatsPerBar !== props.builder.beats.value) {
    outcome.value = 'Размер сменился во время записи — спой ещё раз.'
    return
  }
  const bars = barsFromSung(sung.notes, sung.beatsPerBar, sung.firstStep)
  if (bars.length === 0) {
    outcome.value = 'Нот не слышно. Проверь микрофон и спой ещё раз.'
    return
  }
  const notes = bars.flat().filter(isNote).length
  const parts = [
    `${plural(bars.length, 'Добавлен', 'Добавлено', 'Добавлено')} ${bars.length} ${plural(bars.length, 'такт', 'такта', 'тактов')}`,
    `${notes} ${plural(notes, 'нота', 'ноты', 'нот')}`,
  ]
  if (sung.dropped > 0) {
    parts.push(
      `${sung.dropped} ${plural(sung.dropped, 'нота', 'ноты', 'нот')} быстрее шестнадцатой не ${plural(sung.dropped, 'поместилась', 'поместились', 'поместились')}`,
    )
  }
  outcome.value = `${parts.join(', ')}.`
  emit('sung', bars)
}
</script>

<template>
  <section class="panel" aria-labelledby="voice-title">
    <div class="panel__row">
      <h2 id="voice-title" class="panel__title">Напеть</h2>
      <span class="voice__status" aria-live="polite">{{ status }}</span>
    </div>
    <p class="voice__lead">
      Спой ноты под метроном вместо того, чтобы набирать их: такт отсчёта, дальше запись. Ноты
      встанут по шестнадцатым и уедут в таймлайн целыми тактами.
    </p>

    <div class="voice">
      <div class="voice__tempo" :inert="active">
        <BpmControl v-model="bpm" compact />
      </div>

      <div class="voice__actions">
        <button v-if="!active" type="button" class="btn btn--primary" @click="start">
          <PhMicrophone :size="16" weight="light" aria-hidden="true" />
          Напеть
        </button>
        <template v-else>
          <button
            type="button"
            class="btn btn--primary"
            :disabled="state === 'starting' || state === 'reading'"
            @click="finish"
          >
            <PhCheck :size="16" weight="bold" aria-hidden="true" />
            Готово
          </button>
          <button type="button" class="btn" :disabled="state === 'reading'" @click="take.cancel">
            <PhX :size="16" weight="light" aria-hidden="true" />
            Отмена
          </button>
        </template>
      </div>
    </div>

    <PitchRoll
      v-if="active"
      class="voice__roll"
      :trace="pitch"
      :low="span.low"
      :high="span.high"
      :seconds="TRACE_SECONDS"
      label="Голос по высоте и времени"
    />

    <p v-if="error" class="voice__error" role="alert">Микрофон или звук недоступны: {{ error }}</p>
    <p v-else-if="outcome" class="voice__outcome" aria-live="polite">{{ outcome }}</p>
  </section>
</template>

<style scoped>
.voice__status {
  color: var(--muted);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.voice__lead {
  margin: 0;
  max-width: 44rem;
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.45;
}

.voice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem 1.5rem;
}

.voice__tempo {
  transition: opacity 280ms var(--ease);
}

.voice__tempo[inert] {
  opacity: 0.45;
}

.voice__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.voice__roll {
  height: 9rem;
}

.voice__outcome {
  margin: 0;
  font-size: 0.9rem;
}

.voice__error {
  margin: 0;
  padding: 0.8rem 1rem;
  border: 1px solid color-mix(in srgb, var(--tonic) 55%, var(--line));
  border-radius: var(--radius-core);
  background: color-mix(in srgb, var(--tonic) 14%, transparent);
}
</style>
