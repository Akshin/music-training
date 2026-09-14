<script setup lang="ts">
import { PhMicrophone, PhMicrophoneSlash } from '@phosphor-icons/vue'
import PitchRoll from '@/components/pitch/PitchRoll.vue'
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

/** C4–C5: one octave. */
const PITCH_LOW = 60
const PITCH_HIGH = 72

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
          <PitchRoll :trace="pitch" :low="PITCH_LOW" :high="PITCH_HIGH" />
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
