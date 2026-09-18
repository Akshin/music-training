<script setup lang="ts">
import { computed } from 'vue'
import { PhVideoCamera, PhVideoCameraSlash } from '@phosphor-icons/vue'
import ExerciseScreen from '@/components/exercise/ExerciseScreen.vue'
import MouthFigure from '@/components/face/MouthFigure.vue'
import { useMouthTracker } from '@/composables/useMouthTracker'
import { MOUTH_OPENING } from '@/training/exercises'

const { status, error, mouth, start, stop } = useMouthTracker()

const running = computed(() => status.value === 'running')

const hint = computed(() => {
  switch (status.value) {
    case 'loading':
      return 'Загружаю модель и камеру…'
    case 'running':
      return mouth.value ? 'Открывай и сужай рот' : 'Не вижу лица — посмотри в камеру'
    default:
      return 'Включи камеру'
  }
})

const readout = computed(() => {
  const shape = mouth.value
  if (!shape) return []
  return [
    { label: 'Открыт', value: shape.open },
    { label: 'Сужен', value: shape.narrow },
    { label: 'Зазор', value: shape.aperture },
    { label: 'Ширина', value: shape.width },
  ]
})

function toggle(): void {
  if (running.value) stop()
  else void start()
}
</script>

<template>
  <ExerciseScreen :title="MOUTH_OPENING.title">
    <section class="stage" aria-label="Открываем рот">
      <p class="hint" aria-live="polite">{{ hint }}</p>

      <MouthFigure
        class="figure"
        :class="{ 'figure--idle': !mouth }"
        :open="mouth?.open ?? 0"
        :narrow="mouth?.narrow ?? 0"
        :aperture="mouth?.aperture ?? 0"
        :width="mouth?.width ?? 0.5"
      />

      <dl class="readout">
        <div v-for="item in readout" :key="item.label" class="readout__item">
          <dt>{{ item.label }}</dt>
          <dd>{{ Math.round(item.value * 100) }}</dd>
        </div>
      </dl>

      <button
        type="button"
        class="camera"
        :class="{ 'camera--on': running }"
        :aria-pressed="running"
        :disabled="status === 'loading'"
        @click="toggle"
      >
        <PhVideoCameraSlash v-if="running" :size="16" weight="light" aria-hidden="true" />
        <PhVideoCamera v-else :size="16" weight="light" aria-hidden="true" />
        {{ running ? 'Выключить камеру' : status === 'loading' ? 'Подключаю…' : 'Включить камеру' }}
      </button>

      <p v-if="error" class="error" role="alert">{{ error.message }}</p>
    </section>
  </ExerciseScreen>
</template>

<style scoped>
.stage {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 1.5rem;
  width: min(100%, 40rem);
  flex: 1 1 auto;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}

.hint {
  margin: 0;
  font-size: clamp(1.4rem, 3.4vw, 2rem);
  font-weight: 600;
  letter-spacing: -0.04em;
  text-align: center;
}

.figure {
  width: min(100%, 24rem);
  transition: opacity 280ms var(--ease);
}

.figure--idle {
  opacity: 0.45;
}

.readout {
  display: flex;
  gap: 1.5rem;
  min-height: 2.6rem;
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.readout__item {
  display: grid;
  justify-items: center;
  gap: 0.15rem;
}

.readout dt {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}

.readout dd {
  margin: 0;
  font-weight: 600;
}

.camera {
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

.camera:hover {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
}

.camera:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.camera:disabled {
  opacity: 0.6;
  cursor: progress;
}

.camera--on {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-ink);
}

.error {
  margin: 0;
  padding: 0.8rem 1rem;
  border: 1px solid color-mix(in srgb, var(--tonic) 55%, var(--line));
  border-radius: var(--radius-core);
  background: color-mix(in srgb, var(--tonic) 14%, transparent);
}
</style>
