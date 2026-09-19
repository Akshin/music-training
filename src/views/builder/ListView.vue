<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhCheck, PhLink, PhPencilSimple, PhPlus, PhTrash } from '@phosphor-icons/vue'
import BarRoll from '@/components/builder/BarRoll.vue'
import {
  copyText,
  trainingLink,
  useCustomTrainings,
  type SavedTraining,
} from '@/composables/useCustomTrainings'
import {
  LOUDNESS_ZONES,
  ONSETS,
  lastPitch,
  pitchSpan,
  previewBpm,
  type TrainingDraft,
} from '@/training/builder'
import { TIME_SIGNATURES } from '@/training/tempo'

/** Bars shown on a card; the rest is counted. */
const PREVIEW_BARS = 4
/** How long «Скопировано» stays on a card, ms. */
const COPIED_MS = 2000

const router = useRouter()
const { trainings, remove } = useCustomTrainings()

function summary(draft: TrainingDraft): string[] {
  const bars = draft.bars.length
  const barWord =
    bars % 10 === 1 && bars % 100 !== 11
      ? 'такт'
      : [2, 3, 4].includes(bars % 10) && ![12, 13, 14].includes(bars % 100)
        ? 'такта'
        : 'тактов'
  return [
    `${bars} ${barWord}`,
    TIME_SIGNATURES.find((option) => option.beats === draft.beats)?.label ?? '',
    draft.bpmRange ? `${draft.bpmRange.min}–${draft.bpmRange.max} BPM` : 'любой темп',
    ONSETS.find((option) => option.onset === draft.onset)?.label.toLowerCase() ?? '',
    draft.loudness
      ? (LOUDNESS_ZONES.find((option) => option.zone === draft.loudness)?.label.toLowerCase() ?? '')
      : '',
  ].filter(Boolean)
}

function spanOf(draft: TrainingDraft) {
  const found = pitchSpan(draft.bars.slice(0, PREVIEW_BARS).flatMap((bar) => bar.notes))
  return found ? { low: found.low - 1, high: found.high + 1 } : { low: 59, high: 73 }
}

/** The first note after bar `index` (`side` 1) or the last pitch before it (`side` −1). */
function midiAround(draft: TrainingDraft, index: number, side: 1 | -1): number | null {
  if (side === 1) return draft.bars[index + 1]?.notes[0]?.midi ?? null
  const earlier = draft.bars.slice(0, index).flatMap((bar) => bar.notes)
  return lastPitch(earlier)
}

function savedAt(training: SavedTraining): string {
  return new Date(training.savedAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const copied = ref<string | null>(null)
/** A link the browser would not copy, shown on its card to copy by hand. */
const shown = ref<{ id: string; link: string } | null>(null)
let copiedTimer = 0

async function share(training: SavedTraining) {
  const link = await trainingLink(router, training.draft)
  if (await copyText(link)) {
    shown.value = null
    copied.value = training.id
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => (copied.value = null), COPIED_MS)
  } else {
    shown.value = { id: training.id, link }
  }
}

function confirmRemove(training: SavedTraining) {
  const name = training.draft.title || 'Без названия'
  if (window.confirm(`Удалить тренировку «${name}»?`)) remove(training.id)
}
</script>

<template>
  <main id="main" class="list-page">
    <section class="head">
      <p class="kicker">Конструктор</p>
      <h1 class="head__title">Мои тренировки</h1>
      <p class="head__lead">
        Тренировки, собранные в конструкторе. Хранятся в этом браузере; чтобы поделиться — возьми
        ссылку.
      </p>
      <RouterLink to="/builder/edit" class="start">
        <PhPlus :size="16" weight="bold" aria-hidden="true" />
        Новая тренировка
      </RouterLink>
    </section>

    <TransitionGroup v-if="trainings.length" tag="ul" name="item" class="list">
      <li v-for="training in trainings" :key="training.id" class="item">
        <div class="item__head">
          <RouterLink
            :to="{ path: '/builder/edit', query: { id: training.id } }"
            class="item__title"
          >
            {{ training.draft.title || 'Без названия' }}
          </RouterLink>
          <span class="item__date">{{ savedAt(training) }}</span>
        </div>
        <p class="item__meta">{{ summary(training.draft).join(' · ') }}</p>

        <div v-if="training.draft.bars.length" class="item__bars" aria-hidden="true">
          <div
            v-for="(bar, index) in training.draft.bars.slice(0, PREVIEW_BARS)"
            :key="bar.id"
            class="item__bar"
          >
            <BarRoll
              :notes="bar.notes"
              :beats="training.draft.beats"
              :bpm="previewBpm(training.draft)"
              :prev-midi="midiAround(training.draft, index, -1)"
              :next-midi="midiAround(training.draft, index, 1)"
              :low="spanOf(training.draft).low"
              :high="spanOf(training.draft).high"
            />
          </div>
          <span v-if="training.draft.bars.length > PREVIEW_BARS" class="item__more">
            +{{ training.draft.bars.length - PREVIEW_BARS }}
          </span>
        </div>
        <p v-else class="item__empty">Тактов пока нет.</p>

        <div class="item__actions">
          <RouterLink :to="{ path: '/builder/edit', query: { id: training.id } }" class="action">
            <PhPencilSimple :size="15" weight="light" aria-hidden="true" />
            Редактировать
          </RouterLink>
          <button
            type="button"
            class="action"
            :disabled="training.draft.bars.length === 0"
            @click="share(training)"
          >
            <component
              :is="copied === training.id ? PhCheck : PhLink"
              :size="15"
              weight="light"
              aria-hidden="true"
            />
            {{ copied === training.id ? 'Скопировано' : 'Ссылка' }}
          </button>
          <button type="button" class="action action--danger" @click="confirmRemove(training)">
            <PhTrash :size="15" weight="light" aria-hidden="true" />
            Удалить
          </button>
        </div>
        <input
          v-if="shown?.id === training.id"
          class="item__link"
          type="text"
          readonly
          :value="shown.link"
          aria-label="Ссылка на тренировку — скопируй вручную"
          @focus="($event.target as HTMLInputElement).select()"
        />
      </li>
    </TransitionGroup>

    <p v-else class="empty">
      Пока ни одной тренировки. Собери первую в конструкторе и нажми «Сохранить».
    </p>
  </main>
</template>

<style scoped>
.list-page {
  max-width: 56rem;
  margin: 0 auto;
  padding: 0 1rem 5rem;
}

.head {
  padding: 4rem 0 2rem;
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
  margin: 0 0 0.85rem;
  font-size: clamp(2rem, 4.6vw, 3.2rem);
  font-weight: 600;
  letter-spacing: -0.045em;
  line-height: 1.1;
}

.head__lead {
  margin: 0 0 1.5rem;
  max-width: 50ch;
  color: var(--muted);
  font-size: 1.05rem;
  line-height: 1.55;
  text-wrap: pretty;
}

.start {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
  text-decoration: none;
  transition: transform 420ms var(--ease);
}

.start:hover {
  transform: translateY(-2px);
}

.start:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.list {
  position: relative;
  display: grid;
  gap: 0.85rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: grid;
  gap: 0.75rem;
  padding: 1.25rem 1.4rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-core);
  background: var(--bg-raised);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 12%);
}

.item__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 1rem;
}

.item__title {
  font-size: 1.15rem;
  font-weight: 600;
  text-decoration: none;
}

.item__title:hover {
  color: var(--accent);
}

.item__title:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.item__date,
.item__meta,
.item__empty {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
}

.item__bars {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  overflow: hidden;
}

.item__bar {
  flex: 0 1 9rem;
  min-width: 4rem;
  height: 3rem;
  padding: 0.4rem 0.5rem;
  border-radius: 0.7rem;
  background: var(--bg-inset);
}

.item__more {
  color: var(--muted);
  font-size: 0.85rem;
  font-weight: 600;
}

.item__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.item__link {
  width: 100%;
  height: 2.2rem;
  padding: 0 0.85rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--bg-inset);
  color: var(--ink);
  font-size: 0.8rem;
  outline: none;
}

.item__link:focus {
  border-color: var(--accent);
}

.action {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 2.2rem;
  padding: 0 0.95rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--bg-inset);
  color: var(--ink);
  font-size: 0.83rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition:
    border-color 280ms var(--ease),
    background 280ms var(--ease);
}

.action:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
}

.action:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.action:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.action--danger {
  margin-left: auto;
  color: var(--muted);
}

.action--danger:hover:not(:disabled) {
  border-color: var(--tonic);
  background: color-mix(in srgb, var(--tonic) 25%, var(--bg-inset));
  color: var(--ink);
}

.empty {
  margin: 0;
  padding: 2.5rem 1.5rem;
  border: 1px dashed var(--line);
  border-radius: var(--radius-core);
  color: var(--muted);
  text-align: center;
}

.item-move {
  transition: transform 360ms var(--ease);
}

.item-leave-active {
  position: absolute;
  width: 100%;
  transition:
    opacity 240ms var(--ease),
    transform 240ms var(--ease);
}

.item-leave-to {
  opacity: 0;
  transform: translateX(1rem);
}

@media (max-width: 600px) {
  .item {
    padding: 1.1rem 1rem;
  }

  .action--danger {
    margin-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .item-move,
  .item-leave-active {
    transition: none;
  }
}
</style>
