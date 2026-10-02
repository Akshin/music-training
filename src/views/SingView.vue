<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { PhMicrophone, PhStop } from '@phosphor-icons/vue'
import SegmentedChoice, { type SegmentedOption } from '@/components/builder/SegmentedChoice.vue'
import TakeRoll, { type TakeNote } from '@/components/pitch/TakeRoll.vue'
import VolumeStrip from '@/components/volume/VolumeStrip.vue'
import { loudnessColor } from '@/components/loudness'
import { useExerciseSession } from '@/composables/useExerciseSession'
import { LOUDNESS_ZONES, type LoudnessZone } from '@/training/builder'

// A page to open from a link in a lesson: the voice on the Architect's chart, and the notes found
// in it as boxes. Nothing is recorded or kept; stopping clears the chart.
const session = useExerciseSession({})
const { micState, error, take, rawLevel, averageLevel } = session
const listening = computed(() => micState.value === 'running')
const starting = computed(() => micState.value === 'starting')

/** Seconds back from now in which notes are looked for. */
const NOTES_BACK = 40
/** How often the notes are looked for again, ms. */
const NOTES_EVERY = 300

const notes = shallowRef<TakeNote[]>([])
let timer = 0

function findNotes(): void {
  const count = take.length()
  if (count === 0) return
  const now = take.timeOf(count - 1)
  notes.value = take.notes(Math.max(take.timeOf(0), now - NOTES_BACK), now)
}

watch(listening, (on) => {
  window.clearInterval(timer)
  notes.value = []
  if (on) timer = window.setInterval(findNotes, NOTES_EVERY)
})

onBeforeUnmount(() => {
  window.clearInterval(timer)
  void session.stopListening()
})

// Loudness beside the notes: the strip against a chosen zone, as in the sandbox.
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

async function toggle(): Promise<void> {
  if (listening.value) await session.stopListening()
  else await session.startListening().catch(() => {})
}
</script>

<template>
  <main id="main" class="sing">
    <header class="top">
      <h1 class="title">Пой и смотри</h1>
    </header>

    <div class="stage">
      <TakeRoll
        class="roll"
        :source="take"
        :recording="listening"
        :playing="false"
        :auto-zoom="true"
        :follow-pitch="true"
        :notes="notes"
        :ahead="0.15"
        label="Голос и ноты во времени"
      />
      <VolumeStrip
        class="volume"
        :level="rawLevel"
        :average="averageLevel"
        :success="inZone"
        :low="zone.low"
        :high="zone.high"
      />
    </div>
    <SegmentedChoice v-model="zoneId" :options="zoneOptions" label="Зона громкости" />

    <footer class="bottom">
      <button
        type="button"
        class="mic"
        :class="{ 'mic--on': listening }"
        :disabled="starting"
        :aria-label="listening ? 'Остановить' : 'Слушать голос'"
        @click="toggle"
      >
        <PhStop v-if="listening" :size="22" weight="fill" aria-hidden="true" />
        <PhMicrophone v-else :size="24" weight="regular" aria-hidden="true" />
      </button>
      <p class="hint">
        <template v-if="error">{{ error }}</template>
        <template v-else-if="starting">Включаю микрофон…</template>
        <template v-else-if="listening"
          >Ноты появляются, когда допета нота. Стоп — всё стирается.</template
        >
        <template v-else>Нажми и пой. Лучше в наушниках или в тишине.</template>
      </p>
    </footer>
  </main>
</template>

<style scoped>
.sing {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  max-width: 64rem;
  margin: 0 auto;
  padding: 0.6rem 1rem max(0.8rem, env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.4rem;
}

.volume {
  height: auto;
  padding: 0.5rem 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-core);
  background: var(--bg);
}

.roll {
  /* Room left for the note above and the button below, also under the site's own bar. */
  --take-height: clamp(14rem, calc(100dvh - 24rem), 40rem);
}

.bottom {
  display: grid;
  justify-items: center;
  gap: 0.4rem;
}

.mic {
  display: inline-grid;
  place-items: center;
  width: 4rem;
  height: 4rem;
  border: 2px solid color-mix(in srgb, var(--accent) 60%, var(--line));
  border-radius: 50%;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition:
    background 200ms var(--ease),
    color 200ms var(--ease);
}

.mic--on {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-ink);
}

.mic:disabled {
  opacity: 0.5;
}

.hint {
  min-height: 1.2em;
  margin: 0;
  color: var(--muted);
  font-size: 0.8rem;
  text-align: center;
}
</style>
