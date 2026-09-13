<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import {
  PhCaretUp,
  PhMetronome,
  PhMusicNotes,
  PhRepeat,
  PhSpeakerHigh,
  PhTextT,
  PhWaveform,
  PhX,
} from '@phosphor-icons/vue'
import BpmControl from '@/components/BpmControl.vue'
import IconSwitch from '@/components/IconSwitch.vue'
import KeyControl from '@/components/KeyControl.vue'
import ModeBackdrop from '@/components/ModeBackdrop.vue'
import PlayTransport from '@/components/PlayTransport.vue'
import SchemeChangeControl from '@/components/SchemeChangeControl.vue'
import TabInstrumentControl from '@/components/TabInstrumentControl.vue'
import TimeSignatureControl from '@/components/TimeSignatureControl.vue'
import TrainingStage from '@/components/TrainingStage.vue'
import { useTrainingSound } from '@/composables/useTrainingSound'
import { backingTrackUrl } from '@/training/backing'
import { TONAL_KEY_DEFAULT, keyPitchClass, keyTonicMidi, type TonalKey } from '@/training/keys'
import { planMelody, type CyclePlan } from '@/training/melody'
import { CHANGE_EVERY_DEFAULT, type ChangeEvery, type ModePattern } from '@/training/patterns'
import { TAB_INSTRUMENT_DEFAULT, type TabInstrument } from '@/training/tabs'
import { BEATS_DEFAULT, BPM_DEFAULT } from '@/training/tempo'

const bpm = ref(BPM_DEFAULT)
const beatsPerMeasure = ref(BEATS_DEFAULT)
const playing = ref(false)
const metronomeOn = ref(true)
const tonalKey = ref<TonalKey>(TONAL_KEY_DEFAULT)
const melodyOn = ref(false)
const backingOn = ref(false)
const changeEvery = ref<ChangeEvery>(CHANGE_EVERY_DEFAULT)
const tabInstrument = ref<TabInstrument>(TAB_INSTRUMENT_DEFAULT)
const showModeNames = ref(true)
const currentMode = ref<ModePattern | null>(null)
const plan = shallowRef<CyclePlan | null>(null)
const consoleOpen = ref(true)
const hideBtn = ref<HTMLButtonElement | null>(null)
const revealBtn = ref<HTMLButtonElement | null>(null)
const tonic = computed(() => keyPitchClass(tonalKey.value))
const backingUrl = computed(() => (backingOn.value ? backingTrackUrl(tonalKey.value) : null))
const sound = useTrainingSound({
  playing,
  bpm,
  beats: beatsPerMeasure,
  clicks: metronomeOn,
  backing: backingUrl,
})

// One tonal centre for everything: the pad, the melody and the tab or keys on the cards.
watch([plan, melodyOn, tonalKey], ([cycles, on, key]) => {
  const notes = on && cycles !== null ? planMelody(cycles, keyTonicMidi(key)) : []
  sound.setNotes(notes, cycles?.epoch ?? 0)
})

function hideConsole() {
  consoleOpen.value = false
  void nextTick(() => revealBtn.value?.focus())
}

function showConsole() {
  consoleOpen.value = true
  void nextTick(() => hideBtn.value?.focus())
}
</script>

<template>
  <main id="main" class="play">
    <ModeBackdrop :mode="currentMode" />
    <div class="play__chrome">
      <h1 class="play__title">Тренировка</h1>
      <TrainingStage
        :playing="playing"
        :change-every="changeEvery"
        :tab-instrument="tabInstrument"
        :show-mode-name="showModeNames"
        :bpm="bpm"
        :beats-per-measure="beatsPerMeasure"
        :clock="sound.clock"
        :tonic="tonic"
        @update:mode="currentMode = $event"
        @update:plan="plan = $event"
      />

      <footer class="dock">
        <div class="dock-slot" :class="{ 'dock-slot--stowed': !consoleOpen }">
          <div class="dock-slot__clip">
            <div class="console" :inert="!consoleOpen" :aria-hidden="!consoleOpen">
              <button
                ref="hideBtn"
                type="button"
                class="console__hide"
                aria-label="Скрыть настройки"
                @click="hideConsole"
              >
                <PhX :size="16" weight="light" aria-hidden="true" />
              </button>

              <section class="bay bay--rhythm" aria-label="Ритм">
                <h2 class="bay__title">
                  <span class="bay__mark">
                    <PhMetronome :size="14" weight="light" aria-hidden="true" />
                  </span>
                  Ритм
                </h2>
                <div class="bay__body bay__body--rhythm">
                  <BpmControl v-model="bpm" compact />
                  <div class="bay__side">
                    <TimeSignatureControl v-model="beatsPerMeasure" />
                    <IconSwitch
                      v-model="metronomeOn"
                      label="Метроном"
                      hint="Щелчки метронома. Схемы всё равно меняются по тактам."
                    >
                      <PhMetronome :size="18" weight="light" aria-hidden="true" />
                    </IconSwitch>
                  </div>
                </div>
              </section>

              <div class="console__split" aria-hidden="true" />

              <section class="bay bay--exercise" aria-label="Упражнение">
                <h2 class="bay__title">
                  <span class="bay__mark">
                    <PhRepeat :size="14" weight="light" aria-hidden="true" />
                  </span>
                  Упражнение
                </h2>
                <div class="bay__body bay__body--stack">
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
                </div>
              </section>

              <div class="console__split" aria-hidden="true" />

              <section class="bay bay--sound" aria-label="Звук">
                <h2 class="bay__title">
                  <span class="bay__mark">
                    <PhSpeakerHigh :size="14" weight="light" aria-hidden="true" />
                  </span>
                  Звук
                </h2>
                <div class="bay__body bay__body--stack">
                  <KeyControl v-model="tonalKey" />
                  <div class="bay__switches" role="group" aria-label="Голоса">
                    <IconSwitch
                      v-model="melodyOn"
                      label="Мелодия"
                      hint="Гамма текущего лада восьмыми, вверх и вниз, от тонального центра."
                    >
                      <PhMusicNotes :size="18" weight="light" aria-hidden="true" />
                    </IconSwitch>
                    <IconSwitch
                      v-model="backingOn"
                      label="Бэк-трек"
                      hint="Струнная педаль в тональном центре."
                    >
                      <PhWaveform :size="18" weight="light" aria-hidden="true" />
                    </IconSwitch>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>

        <div class="dock__pedal">
          <PlayTransport v-model="playing" :bpm="bpm" />
        </div>

        <button
          v-if="!consoleOpen"
          ref="revealBtn"
          type="button"
          class="dock-reveal"
          aria-label="Показать настройки"
          @click="showConsole"
        >
          <PhCaretUp :size="18" weight="light" aria-hidden="true" />
        </button>
      </footer>
    </div>
  </main>
</template>

<style scoped>
.play {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - 4.5rem);
}

.play__chrome {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.play__title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.dock {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.85rem;
  padding: 0.25rem 1rem 1.9rem;
}

.dock-slot {
  display: grid;
  grid-template-rows: 1fr;
  width: min(100%, 64rem);
  transition: grid-template-rows 620ms var(--ease);
}

.dock-slot--stowed {
  grid-template-rows: 0fr;
}

.dock-slot__clip {
  overflow: visible;
}

.dock-slot--stowed .dock-slot__clip {
  min-height: 0;
  overflow: hidden;
}

.console {
  position: relative;
  overflow: visible;
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) 1px minmax(12.5rem, 0.82fr) 1px minmax(0, 1.08fr);
  align-items: stretch;
  width: 100%;
  padding: 0.95rem 2.55rem 1.1rem 0.85rem;
  border: 1px solid var(--line);
  border-radius: 2rem;
  background: color-mix(in srgb, var(--bg-raised) 82%, var(--bg-inset));
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 10%),
    0 18px 48px var(--shadow);
  transition: transform 620ms var(--ease);
}

.dock-slot--stowed .console {
  transform: translateY(28%);
}

.console__hide {
  position: absolute;
  top: 0.7rem;
  right: 0.7rem;
  z-index: 4;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: color-mix(in srgb, var(--bg-inset) 55%, transparent);
  color: var(--muted);
  cursor: pointer;
  transition:
    color 280ms var(--ease),
    background 280ms var(--ease),
    transform 220ms var(--ease);
}

.console__hide:hover {
  color: var(--ink);
  background: color-mix(in srgb, var(--bg-inset) 80%, transparent);
}

.console__hide:active {
  transform: scale(0.96);
}

.console__hide:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.console__split {
  width: 1px;
  margin: 0.55rem 0;
  background: color-mix(in srgb, var(--ink) 14%, transparent);
}

.bay {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
  padding: 0.15rem 0.85rem 0.2rem;
}

.bay__title {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0 auto;
  font-size: 0.64rem;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
}

.bay__mark {
  display: grid;
  place-items: center;
  width: 1.55rem;
  height: 1.55rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.bay__body {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
}

.bay__body--stack {
  flex-direction: column;
  gap: 0.7rem;
}

.bay__body--rhythm {
  flex-wrap: wrap;
  gap: 0.85rem 1.15rem;
}

.bay__side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
}

.bay__switches {
  display: flex;
  justify-content: center;
  gap: 0.15rem;
}

.dock-reveal {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--bg-raised) 82%, var(--bg-inset));
  color: var(--ink);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 10%),
    0 10px 28px var(--shadow);
  cursor: pointer;
  transition:
    color 280ms var(--ease),
    transform 220ms var(--ease);
}

.dock-reveal:hover {
  color: var(--accent);
}

.dock-reveal:active {
  transform: scale(0.96);
}

.dock-reveal:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.bay--exercise {
  position: relative;
  z-index: 16;
}

.bay--exercise :deep(.change),
.bay--exercise :deep(.tabs) {
  width: 100%;
}

.bay--exercise :deep(.change__trigger),
.bay--exercise :deep(.tabs__trigger) {
  width: 100%;
  min-width: 0;
}

.dock__pedal {
  display: flex;
  justify-content: center;
}

@media (max-width: 860px) {
  .dock-slot {
    width: min(100%, 24.75rem);
  }

  .console {
    display: flex;
    flex-direction: column;
    padding: 2.35rem 0.7rem 1rem;
    border-radius: 1.75rem;
  }

  .console__split {
    display: none;
  }

  .dock__pedal {
    order: -1;
  }

  .bay--rhythm {
    order: 1;
  }

  .bay--exercise {
    order: 2;
  }

  .bay--sound {
    order: 3;
  }

  .bay__body--rhythm {
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dock-slot,
  .console {
    transition: none;
  }

  .dock-slot--stowed .console {
    transform: none;
  }
}
</style>
