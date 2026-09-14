<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import { PhMusicNotes, PhTextT } from '@phosphor-icons/vue'
import ExerciseConsole from '@/components/exercise/ExerciseConsole.vue'
import ExerciseScreen from '@/components/exercise/ExerciseScreen.vue'
import IconSwitch from '@/components/controls/IconSwitch.vue'
import ModeBackdrop from '@/components/ModeBackdrop.vue'
import SchemeChangeControl from '@/components/controls/SchemeChangeControl.vue'
import TabInstrumentControl from '@/components/controls/TabInstrumentControl.vue'
import TrainingStage from '@/components/TrainingStage.vue'
import { useExercise } from '@/composables/useExercise'
import { TETRACHORDS } from '@/training/exercises'
import { planMelody, type CyclePlan } from '@/training/melody'
import { CHANGE_EVERY_DEFAULT, type ChangeEvery, type ModePattern } from '@/training/patterns'
import { TAB_INSTRUMENT_DEFAULT, type TabInstrument } from '@/training/tabs'

const exercise = useExercise(TETRACHORDS)
const { settings, session, tonic, tonicMidi } = exercise
const { bpm, beats } = settings
const { playing } = session

const melodyOn = ref(false)
const changeEvery = ref<ChangeEvery>(CHANGE_EVERY_DEFAULT)
const tabInstrument = ref<TabInstrument>(TAB_INSTRUMENT_DEFAULT)
const showModeNames = ref(true)
const currentMode = ref<ModePattern | null>(null)
const plan = shallowRef<CyclePlan | null>(null)

// One tonal centre for everything: the pad, the melody and the tab or keys on the cards.
watch([plan, melodyOn, tonicMidi], ([cycles, on, root]) => {
  const notes = on && cycles !== null ? planMelody(cycles, root) : []
  session.setNotes(notes, cycles?.epoch ?? 0)
})
</script>

<template>
  <ExerciseScreen title="Тренировка">
    <template #backdrop>
      <ModeBackdrop :mode="currentMode" />
    </template>

    <TrainingStage
      :playing="playing"
      :change-every="changeEvery"
      :tab-instrument="tabInstrument"
      :show-mode-name="showModeNames"
      :bpm="bpm"
      :beats-per-measure="beats"
      :clock="session.clock"
      :tonic="tonic"
      @update:mode="currentMode = $event"
      @update:plan="plan = $event"
    />

    <template #dock>
      <ExerciseConsole
        :exercise="exercise"
        metronome-hint="Щелчки метронома. Схемы всё равно меняются по тактам."
      >
        <template #exercise>
          <SchemeChangeControl v-model="changeEvery" />
          <TabInstrumentControl v-model="tabInstrument" />
          <IconSwitch
            v-model="showModeNames"
            label="Отображение лада"
            hint="Название лада под карточкой. Схемы не скрываются."
            wide
          >
            <PhTextT :size="18" weight="light" aria-hidden="true" />
          </IconSwitch>
        </template>

        <template #voices>
          <IconSwitch
            v-model="melodyOn"
            label="Мелодия"
            hint="Гамма текущего лада восьмыми, вверх и вниз, от тонального центра."
          >
            <PhMusicNotes :size="18" weight="light" aria-hidden="true" />
          </IconSwitch>
        </template>
      </ExerciseConsole>
    </template>
  </ExerciseScreen>
</template>
