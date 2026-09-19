<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhArrowCounterClockwise, PhCloud, PhPause } from '@phosphor-icons/vue'
import BarRoll from '@/components/builder/BarRoll.vue'
import NotePad from '@/components/builder/NotePad.vue'
import SegmentedChoice, { type SegmentedOption } from '@/components/builder/SegmentedChoice.vue'
import type { BuilderDraft, PitchSpan } from '@/composables/useBuilderDraft'
import type { NoteEntry } from '@/composables/useNoteEntry'
import {
  NOTE_KINDS,
  NOTE_LENGTHS,
  elementLabel,
  isNote,
  sixteenthsPerBeat,
  type BarElement,
  type NoteKind,
} from '@/training/builder'
import { noteName } from '@/training/keys'

const props = defineProps<{
  builder: BuilderDraft
  entry: NoteEntry
  span: PitchSpan
  /** The full bar is on its way to the timeline; nothing can be added meanwhile. */
  sealing: boolean
}>()

const emit = defineEmits<{
  add: [element: BarElement]
  undo: []
}>()

// The draft and the pen are made once per page; bind their refs directly.
const { bars, beats, current, filled, bpm } = props.builder
const { length, kind, octave, flash } = props.entry

const roll = ref<HTMLElement | null>(null)
/** Where the bar being filled is drawn, for the card to fly from once it is full. */
defineExpose({ roll })

const lengthOptions = computed<SegmentedOption<number>[]>(() =>
  NOTE_LENGTHS.map((option) => ({
    value: option.sixteenths,
    label: option.label,
    disabled: !props.builder.canAdd(option.sixteenths),
  })),
)

const kindOptions: SegmentedOption<NoteKind>[] = NOTE_KINDS.map((option) => ({
  value: option.kind,
  label: option.label,
  hint: option.hint,
}))

const kindHint = computed(() => NOTE_KINDS.find((option) => option.kind === kind.value)?.hint)

/** Beats filled, as the singer counts them: «2½ из 4». */
const filledLabel = computed(() => {
  const perBeat = sixteenthsPerBeat(beats.value)
  const whole = Math.floor(filled.value / perBeat)
  const part = (filled.value % perBeat) / perBeat
  const fraction = part === 0 ? '' : part === 0.5 ? '½' : part === 0.25 ? '¼' : '¾'
  return `${whole === 0 && fraction ? '' : whole}${fraction} из ${beats.value}`
})

function lengthLabel(element: BarElement): string {
  return NOTE_LENGTHS.find((option) => option.sixteenths === element.sixteenths)?.label ?? ''
}

function kindLabel(element: BarElement): string | null {
  if (!isNote(element) || element.kind === 'hold') return null
  return NOTE_KINDS.find((option) => option.kind === element.kind)?.label ?? null
}
</script>

<template>
  <section class="panel" aria-labelledby="bar-title">
    <div class="panel__row">
      <h2 id="bar-title" class="panel__title">Такт {{ bars.length + 1 }}</h2>
      <span class="fill" aria-live="polite">{{ filledLabel }}</span>
    </div>

    <div class="block" :class="{ 'block--sealing': sealing }">
      <div ref="roll" class="block__roll">
        <BarRoll
          :elements="current"
          :beats="beats"
          :low="span.low"
          :high="span.high"
          :prev-midi="builder.pitchBefore(bars.length)"
          :bpm="bpm"
          show-rest
        />
      </div>
      <ol v-if="current.length" class="block__elements" aria-label="Такт">
        <li v-for="(element, index) in current" :key="index" class="chip">
          {{ elementLabel(element, noteName) }}
          <span class="chip__meta">
            {{ lengthLabel(element) }}
            <template v-if="kindLabel(element)">· {{ kindLabel(element) }}</template>
          </span>
        </li>
      </ol>
      <p v-else class="block__empty">Нажимай ноты — они встанут в такт.</p>
    </div>

    <div class="entry">
      <div class="entry__opts">
        <div class="entry__opt">
          <span class="ctrl-title">Длительность</span>
          <SegmentedChoice v-model="length" :options="lengthOptions" label="Длительность" />
        </div>
        <div class="entry__opt">
          <span class="ctrl-title">Тип ноты</span>
          <SegmentedChoice v-model="kind" :options="kindOptions" label="Тип ноты" />
          <p class="entry__hint">{{ kindHint }}</p>
        </div>
      </div>

      <NotePad
        v-model:octave="octave"
        :flash="flash"
        :disabled="sealing"
        @note="(midi) => emit('add', entry.element('note', midi))"
      />

      <div class="entry__actions">
        <button
          type="button"
          class="btn"
          :disabled="sealing"
          title="Пауза (R)"
          @click="emit('add', entry.element('rest'))"
        >
          <PhPause :size="16" weight="light" aria-hidden="true" />
          Пауза
        </button>
        <button
          type="button"
          class="btn"
          :disabled="sealing"
          title="Вдох (V): дымка собирается в точку"
          @click="emit('add', entry.element('inhale'))"
        >
          <PhCloud :size="16" weight="light" aria-hidden="true" />
          Вдох
        </button>
        <button
          type="button"
          class="btn"
          :disabled="sealing"
          title="Выдох (B): дымка выходит из точки"
          @click="emit('add', entry.element('exhale'))"
        >
          <PhCloud :size="16" weight="light" aria-hidden="true" />
          Выдох
        </button>
        <button
          type="button"
          class="btn"
          :disabled="sealing || current.length === 0"
          title="Убрать последний элемент (Backspace)"
          @click="emit('undo')"
        >
          <PhArrowCounterClockwise :size="16" weight="light" aria-hidden="true" />
          Отменить
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.fill {
  color: var(--muted);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.block {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 1rem;
  background: var(--bg-inset);
  transition:
    transform 180ms var(--ease),
    border-color 180ms var(--ease),
    box-shadow 180ms var(--ease);
}

.block--sealing {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent);
  transform: scale(0.985);
}

.block__roll {
  height: 7.5rem;
}

.block--sealing .block__roll {
  animation: fade-out 140ms var(--ease) forwards;
}

@keyframes fade-out {
  to {
    opacity: 0.25;
  }
}

.block__elements {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chip {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  padding: 0.25rem 0.6rem;
  border-radius: var(--radius-pill);
  background: var(--bg-raised);
  font-size: 0.82rem;
  font-weight: 600;
}

.chip__meta {
  color: var(--muted);
  font-weight: 500;
  font-size: 0.75rem;
}

.block__empty {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}

.entry {
  display: grid;
  gap: 1.1rem;
}

.entry__opts {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 1.5rem;
}

.entry__opt {
  display: grid;
  align-content: start;
  gap: 0.5rem;
  min-width: 0;
}

.entry__hint {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
  line-height: 1.45;
}

.entry__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
}
</style>
