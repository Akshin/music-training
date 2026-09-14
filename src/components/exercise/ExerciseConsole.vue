<script setup lang="ts">
import { PhMetronome, PhRepeat, PhSpeakerHigh, PhWaveform } from '@phosphor-icons/vue'
import BpmControl from '@/components/controls/BpmControl.vue'
import ControlSheet from '@/components/exercise/ControlSheet.vue'
import IconSwitch from '@/components/controls/IconSwitch.vue'
import KeyControl from '@/components/controls/KeyControl.vue'
import PlayTransport from '@/components/controls/PlayTransport.vue'
import TimeSignatureControl from '@/components/controls/TimeSignatureControl.vue'
import type { Exercise } from '@/composables/useExercise'

const props = withDefaults(
  defineProps<{
    exercise: Exercise
    /** Title of the bay filled by the `exercise` slot. */
    exerciseTitle?: string
    metronomeHint?: string
  }>(),
  {
    exerciseTitle: 'Упражнение',
    metronomeHint: 'Щелчки метронома. Упражнение идёт по тактам и без них.',
  },
)

defineSlots<{
  /** Controls of this exercise, in their own bay between Rhythm and Sound. */
  exercise?: () => unknown
  /** Extra voice switches next to the backing track. */
  voices?: () => unknown
}>()

// The exercise object is created once per screen; bind its refs directly.
const { bpm, beats, metronome, key, backing } = props.exercise.settings
const { playing } = props.exercise.session
</script>

<template>
  <ControlSheet label="Настройки упражнения">
    <div class="console" :class="{ 'console--three': !!$slots.exercise }">
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
            <TimeSignatureControl v-model="beats" />
            <IconSwitch v-model="metronome" label="Метроном" :hint="metronomeHint">
              <PhMetronome :size="18" weight="light" aria-hidden="true" />
            </IconSwitch>
          </div>
        </div>
      </section>

      <template v-if="$slots.exercise">
        <div class="console__split" aria-hidden="true" />

        <section class="bay bay--exercise" :aria-label="exerciseTitle">
          <h2 class="bay__title">
            <span class="bay__mark">
              <PhRepeat :size="14" weight="light" aria-hidden="true" />
            </span>
            {{ exerciseTitle }}
          </h2>
          <div class="bay__body bay__body--stack">
            <slot name="exercise" />
          </div>
        </section>
      </template>

      <div class="console__split" aria-hidden="true" />

      <section class="bay bay--sound" aria-label="Звук">
        <h2 class="bay__title">
          <span class="bay__mark">
            <PhSpeakerHigh :size="14" weight="light" aria-hidden="true" />
          </span>
          Звук
        </h2>
        <div class="bay__body bay__body--stack">
          <KeyControl v-model="key" />
          <div class="bay__switches" role="group" aria-label="Голоса">
            <slot name="voices" />
            <IconSwitch
              v-model="backing"
              label="Бэк-трек"
              hint="Струнная педаль в тональном центре."
            >
              <PhWaveform :size="18" weight="light" aria-hidden="true" />
            </IconSwitch>
          </div>
        </div>
      </section>
    </div>

    <template #pedal>
      <PlayTransport v-model="playing" :bpm="bpm" />
    </template>
  </ControlSheet>
</template>

<style scoped>
.console {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) 1px minmax(0, 1.08fr);
  align-items: stretch;
  width: 100%;
}

.console--three {
  grid-template-columns: minmax(0, 1.2fr) 1px minmax(12.5rem, 0.82fr) 1px minmax(0, 1.08fr);
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

@media (max-width: 860px) {
  .console {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }

  .console__split {
    display: none;
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
</style>
