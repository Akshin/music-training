<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhGauge, PhSpeakerHigh, PhTimer, PhWind } from '@phosphor-icons/vue'
import BpmRangeControl from '@/components/builder/BpmRangeControl.vue'
import SegmentedChoice, { type SegmentedOption } from '@/components/builder/SegmentedChoice.vue'
import TimeSignatureControl from '@/components/controls/TimeSignatureControl.vue'
import { loudnessColor } from '@/components/loudness'
import {
  BPM_RANGE_DEFAULT,
  LOUDNESS_ZONES,
  ONSETS,
  type BpmRange,
  type LoudnessZone,
  type Onset,
} from '@/training/builder'
import { BPM_MAX, BPM_MIN } from '@/training/tempo'

defineProps<{
  /** The meter cannot change: there are bars already. */
  meterLocked: boolean
}>()

const bpmRange = defineModel<BpmRange | null>('bpmRange', { required: true })
const loudness = defineModel<LoudnessZone | null>('loudness', { required: true })
const onset = defineModel<Onset>('onset', { required: true })
const beats = defineModel<number>('beats', { required: true })

/** The last range chosen, kept while the range is off so switching it back restores it. */
const lastBpmRange = ref<BpmRange>(bpmRange.value ?? BPM_RANGE_DEFAULT)

const bpmOn = computed({
  get: () => bpmRange.value !== null,
  set: (on: boolean) => {
    bpmRange.value = on ? lastBpmRange.value : null
  },
})

function setBpmRange(range: BpmRange) {
  bpmRange.value = range
  lastBpmRange.value = range
}

const loudnessOn = computed({
  get: () => loudness.value !== null,
  set: (on: boolean) => {
    loudness.value = on ? 'good' : null
  },
})

const loudnessOptions: SegmentedOption<LoudnessZone>[] = LOUDNESS_ZONES.map((option) => ({
  value: option.zone,
  label: option.label,
  color: loudnessColor((option.low + option.high) / 2),
}))

const onsetOptions: SegmentedOption<Onset>[] = ONSETS.map((option) => ({
  value: option.onset,
  label: option.label,
  hint: option.hint,
}))

const onsetHint = computed(() => ONSETS.find((option) => option.onset === onset.value)?.hint)
</script>

<template>
  <section class="panel" aria-labelledby="conditions-title">
    <h2 id="conditions-title" class="panel__title">Условия</h2>
    <div class="conditions">
      <div class="cond">
        <div class="cond__head">
          <span class="ctrl-title">
            <PhGauge :size="14" weight="light" aria-hidden="true" />
            Темп
          </span>
          <label class="toggle">
            <input v-model="bpmOn" type="checkbox" class="toggle__input" />
            <span class="toggle__track" aria-hidden="true" />
            <span class="toggle__label">{{ bpmOn ? 'Диапазон' : 'Любой' }}</span>
          </label>
        </div>
        <BpmRangeControl
          v-if="bpmRange"
          :model-value="bpmRange"
          @update:model-value="setBpmRange"
        />
        <p v-else class="cond__note">
          Пользователь выберет темп сам, от {{ BPM_MIN }} до {{ BPM_MAX }} BPM.
        </p>
      </div>

      <div class="cond">
        <div class="cond__head">
          <span class="ctrl-title">
            <PhSpeakerHigh :size="14" weight="light" aria-hidden="true" />
            Громкость
          </span>
          <label class="toggle">
            <input v-model="loudnessOn" type="checkbox" class="toggle__input" />
            <span class="toggle__track" aria-hidden="true" />
            <span class="toggle__label">{{ loudnessOn ? 'Задана' : 'Любая' }}</span>
          </label>
        </div>
        <SegmentedChoice
          v-if="loudness"
          v-model="loudness"
          :options="loudnessOptions"
          label="Громкость"
        />
        <p v-else class="cond__note">Громкость не оценивается.</p>
      </div>

      <div class="cond">
        <div class="cond__head">
          <span class="ctrl-title">
            <PhWind :size="14" weight="light" aria-hidden="true" />
            Смык
          </span>
        </div>
        <SegmentedChoice v-model="onset" :options="onsetOptions" label="Смык" />
        <p class="cond__note">{{ onsetHint }}</p>
      </div>

      <div class="cond">
        <div class="cond__head">
          <span class="ctrl-title">
            <PhTimer :size="14" weight="light" aria-hidden="true" />
            Размер
          </span>
        </div>
        <fieldset class="cond__meter" :disabled="meterLocked">
          <TimeSignatureControl v-model="beats" hide-label />
        </fieldset>
        <p v-if="meterLocked" class="cond__note">Размер меняется, пока тактов нет.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.conditions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
  gap: 1rem;
}

.cond {
  display: grid;
  align-content: start;
  gap: 0.7rem;
  min-width: 0;
  padding: 1rem;
  border-radius: 1rem;
  background: color-mix(in srgb, var(--bg-inset) 55%, transparent);
}

.cond__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 1.6rem;
}

.cond__note {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
  line-height: 1.45;
}

.cond__meter {
  margin: 0;
  padding: 0;
  border: none;
  min-width: 0;
}

.cond__meter:disabled {
  opacity: 0.45;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.8rem;
  color: var(--muted);
  cursor: pointer;
}

.toggle__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.toggle__track {
  position: relative;
  width: 2.1rem;
  height: 1.2rem;
  border-radius: var(--radius-pill);
  background: var(--line);
  transition: background 280ms var(--ease);
}

.toggle__track::after {
  content: '';
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 50%;
  background: var(--ink);
  transition: transform 280ms var(--ease);
}

.toggle__input:checked + .toggle__track {
  background: var(--accent);
}

.toggle__input:checked + .toggle__track::after {
  background: var(--accent-ink);
  transform: translateX(0.9rem);
}

.toggle__input:focus-visible + .toggle__track {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.toggle__label {
  min-width: 4.5rem;
}

@media (max-width: 600px) {
  .cond {
    padding: 0.85rem;
  }
}
</style>
