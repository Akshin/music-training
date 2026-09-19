<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PhMinus, PhPlus, PhRepeat, PhTrash, PhX } from '@phosphor-icons/vue'
import BarRoll from '@/components/builder/BarRoll.vue'
import type { BuilderDraft, PitchSpan } from '@/composables/useBuilderDraft'
import {
  ELEMENT_LABELS,
  REPEAT_TIMES_MAX,
  REPEAT_TIMES_MIN,
  isNote,
  repeatAt,
  type BarElement,
} from '@/training/builder'
import { noteName } from '@/training/keys'

const props = defineProps<{
  builder: BuilderDraft
  span: PitchSpan
}>()

// The draft is made once per page; bind its refs directly.
const { bars, repeats, current, beats, bpm, playedBars, playedSeconds } = props.builder

const scroller = ref<HTMLElement | null>(null)

defineExpose({
  /** The card of bar `id`, once it is in the timeline. */
  cardOf: (id: number) => scroller.value?.querySelector<HTMLElement>(`[data-bar="${id}"]`) ?? null,
  /** Scrolls to the newest bar at once, so a card can be measured where it comes to rest. */
  scrollToEnd: () => scroller.value?.scrollTo({ left: scroller.value.scrollWidth }),
})

function barWord(count: number): string {
  const tens = count % 100
  const ones = count % 10
  if (ones === 1 && tens !== 11) return 'такт'
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return 'такта'
  return 'тактов'
}

const totalLabel = () => {
  const seconds = Math.round(playedSeconds.value)
  return seconds >= 60 ? `${Math.floor(seconds / 60)} мин ${seconds % 60} с` : `${seconds} с`
}

/** A bar in a word: its notes by name, a dot for a rest, breaths by name. */
function barNames(elements: readonly BarElement[]): string {
  return elements
    .map((element) =>
      isNote(element)
        ? noteName(element.midi)
        : element.type === 'rest'
          ? '·'
          : ELEMENT_LABELS[element.type].toLowerCase(),
    )
    .join(' ')
}

function clearAll() {
  if (!window.confirm('Удалить все такты и ноты?')) return
  props.builder.clear()
}

// ---- Reprises: pick the first and the last bar of a block, then set how many times it plays ----

const picking = ref(false)
/** The first bar picked, waiting for the last one. */
const pickFrom = ref<number | null>(null)
/** The bar under the pointer while picking, to show the block before it is made. */
const pickHover = ref<number | null>(null)

function startPick() {
  picking.value = true
  pickFrom.value = null
}

function cancelPick() {
  picking.value = false
  pickFrom.value = null
  pickHover.value = null
}

// Bars moving under a half-made pick would make it point at other bars.
watch(() => bars.value.length, cancelPick)

/** Whether the block from the first pick to `to` is free of other reprises. */
function pickFits(to: number): boolean {
  return props.builder.repeatFits(pickFrom.value ?? to, to)
}

function pickBar(index: number) {
  if (!picking.value || !pickFits(index)) return
  if (pickFrom.value === null) {
    pickFrom.value = index
    return
  }
  props.builder.makeRepeat(pickFrom.value, index)
  cancelPick()
}

/** Bars lit while picking: the first pick alone, or the block up to the bar under the pointer. */
function inPick(index: number): boolean {
  const from = pickFrom.value
  if (!picking.value || from === null) return false
  const to = pickHover.value !== null && pickFits(pickHover.value) ? pickHover.value : from
  return Math.min(from, to) <= index && index <= Math.max(from, to)
}

function onKeydown(event: KeyboardEvent) {
  if (event.code === 'Escape' && picking.value) cancelPick()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <section class="panel" aria-labelledby="timeline-title">
    <div class="panel__row">
      <h2 id="timeline-title" class="panel__title">Таймлайн</h2>
      <span v-if="bars.length" class="summary">
        {{ bars.length }} {{ barWord(bars.length) }}
        <template v-if="playedBars.length !== bars.length">
          ({{ playedBars.length }} с повторами)
        </template>
        · {{ totalLabel() }} при {{ bpm }} BPM
      </span>
      <button
        v-if="bars.length && !picking"
        type="button"
        class="btn btn--quiet push"
        title="Выбери первый и последний такт блока, который надо повторить"
        @click="startPick"
      >
        <PhRepeat :size="14" weight="light" aria-hidden="true" />
        Реприза
      </button>
      <button
        v-if="bars.length || current.length"
        type="button"
        class="btn btn--quiet"
        :class="{ push: !bars.length || picking }"
        @click="clearAll"
      >
        <PhTrash :size="14" weight="light" aria-hidden="true" />
        Очистить
      </button>
    </div>

    <p v-if="picking" class="pick" aria-live="polite">
      {{
        pickFrom === null
          ? 'Нажми на первый такт репризы'
          : 'Теперь на последний — или на тот же, чтобы повторить один такт'
      }}
      <button type="button" class="btn btn--quiet push" @click="cancelPick">Отмена</button>
    </p>

    <div v-show="bars.length" ref="scroller" class="timeline">
      <TransitionGroup tag="ol" name="card" class="timeline__list" aria-label="Такты тренировки">
        <li
          v-for="(bar, index) in bars"
          :key="bar.id"
          :data-bar="bar.id"
          class="card"
          :class="{
            'card--repeat-start': repeatAt(repeats, index)?.from === index,
            'card--repeat-end': repeatAt(repeats, index)?.to === index,
            'card--pickable': picking && pickFits(index),
            'card--picked': inPick(index),
          }"
          :role="picking ? 'button' : undefined"
          :tabindex="picking && pickFits(index) ? 0 : undefined"
          :aria-label="picking ? `Такт ${index + 1}` : undefined"
          @click="pickBar(index)"
          @keydown.enter="pickBar(index)"
          @mouseenter="pickHover = index"
          @mouseleave="pickHover = null"
        >
          <template v-if="repeatAt(repeats, index)">
            <span
              class="card__bracket"
              :class="{
                'card__bracket--first': repeatAt(repeats, index)?.from === index,
                'card__bracket--last': repeatAt(repeats, index)?.to === index,
              }"
              aria-hidden="true"
            />
            <div
              v-if="repeatAt(repeats, index)?.from === index"
              class="repeat"
              role="group"
              :aria-label="`Реприза, тактов ${repeatAt(repeats, index)!.to - index + 1}`"
            >
              <span class="repeat__times">×{{ repeatAt(repeats, index)!.times }}</span>
              <button
                type="button"
                class="repeat__btn"
                aria-label="Играть реже"
                :disabled="repeatAt(repeats, index)!.times <= REPEAT_TIMES_MIN"
                @click.stop="
                  builder.setRepeatTimes(
                    repeatAt(repeats, index)!,
                    repeatAt(repeats, index)!.times - 1,
                  )
                "
              >
                <PhMinus :size="10" weight="bold" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="repeat__btn"
                aria-label="Играть чаще"
                :disabled="repeatAt(repeats, index)!.times >= REPEAT_TIMES_MAX"
                @click.stop="
                  builder.setRepeatTimes(
                    repeatAt(repeats, index)!,
                    repeatAt(repeats, index)!.times + 1,
                  )
                "
              >
                <PhPlus :size="10" weight="bold" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="repeat__btn"
                aria-label="Убрать репризу"
                @click.stop="builder.removeRepeat(repeatAt(repeats, index)!)"
              >
                <PhX :size="10" weight="bold" aria-hidden="true" />
              </button>
            </div>
          </template>
          <span class="card__index">{{ index + 1 }}</span>
          <div class="card__roll">
            <BarRoll
              :elements="bar.elements"
              :beats="beats"
              :low="span.low"
              :high="span.high"
              :next-midi="builder.pitchAfter(index)"
              :prev-midi="builder.pitchBefore(index)"
              :bpm="bpm"
            />
          </div>
          <span class="card__names">{{ barNames(bar.elements) }}</span>
          <button
            type="button"
            class="card__remove"
            :aria-label="`Удалить такт ${index + 1}`"
            @click.stop="builder.removeBar(bar.id)"
          >
            <PhX :size="12" weight="bold" aria-hidden="true" />
          </button>
        </li>
      </TransitionGroup>
    </div>
    <p v-if="bars.length === 0" class="timeline__empty">Здесь появятся заполненные такты.</p>
  </section>
</template>

<style scoped>
.summary {
  color: var(--muted);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.push {
  margin-left: auto;
}

.pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  margin: 0;
  padding: 0.6rem 0.9rem;
  border-radius: 0.8rem;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  font-size: 0.88rem;
}

.timeline {
  overflow-x: auto;
  scroll-snap-type: x proximity;
}

.timeline__list {
  --card-gap: 0.75rem;

  position: relative;
  display: flex;
  gap: var(--card-gap);
  width: max-content;
  margin: 0;
  padding: 2.4rem 0.5rem 0.8rem 0.2rem;
  list-style: none;
}

.timeline__empty {
  margin: 0;
  padding: 1.5rem;
  border: 1px dashed var(--line);
  border-radius: 1rem;
  color: var(--muted);
  font-size: 0.9rem;
  text-align: center;
}

.card {
  position: relative;
  flex: 0 0 10rem;
  display: grid;
  gap: 0.4rem;
  padding: 0.6rem 0.7rem 0.55rem;
  border: 1px solid var(--line);
  border-radius: 0.9rem;
  background: var(--bg-inset);
  scroll-snap-align: end;
  transform-origin: top left;
}

.card--pickable {
  cursor: pointer;
}

.card--pickable:hover,
.card--pickable:focus-visible {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
  outline: none;
}

.card--picked {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-inset));
}

/* Repeat signs: a thick bar and two dots inside the block's first and last card. */
.card--repeat-start {
  box-shadow: inset 3px 0 0 var(--accent);
}

.card--repeat-end {
  box-shadow: inset -3px 0 0 var(--accent);
}

.card--repeat-start.card--repeat-end {
  box-shadow:
    inset 3px 0 0 var(--accent),
    inset -3px 0 0 var(--accent);
}

.card--repeat-start::before,
.card--repeat-end::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 4px;
  height: 12px;
  background: radial-gradient(circle, var(--accent) 1.6px, transparent 2px) 0 0 / 4px 6px repeat-y;
  transform: translateY(-50%);
  pointer-events: none;
}

.card--repeat-start::before {
  left: 7px;
}

.card--repeat-end::after {
  right: 7px;
}

/* The bracket over a reprise runs across the gaps to the next card of the block. */
.card__bracket {
  position: absolute;
  top: -0.7rem;
  left: 0;
  right: calc(-1 * var(--card-gap));
  height: 0.45rem;
  border-top: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
  pointer-events: none;
}

.card__bracket--first {
  left: 0.3rem;
  border-left: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
  border-top-left-radius: 0.35rem;
}

.card__bracket--last {
  right: 0.3rem;
  border-right: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
  border-top-right-radius: 0.35rem;
}

.repeat {
  position: absolute;
  top: -2.3rem;
  left: 0.3rem;
  display: flex;
  align-items: center;
  gap: 0.2rem;
}

.repeat__times {
  min-width: 1.9rem;
  color: var(--accent);
  font-size: 0.82rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.repeat__btn {
  display: grid;
  place-items: center;
  width: 1.3rem;
  height: 1.3rem;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--bg-raised);
  color: var(--muted);
  cursor: pointer;
}

.repeat__btn:hover:not(:disabled) {
  color: var(--ink);
}

.repeat__btn:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.repeat__btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.card__index {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.card__roll {
  height: 3.6rem;
}

.card__names {
  overflow: hidden;
  color: var(--muted);
  font-size: 0.7rem;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.card__remove {
  position: absolute;
  top: -0.45rem;
  right: -0.45rem;
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--bg-raised);
  color: var(--muted);
  cursor: pointer;
  transition:
    color 200ms var(--ease),
    background 200ms var(--ease);
}

.card__remove:hover {
  background: var(--tonic);
  color: var(--ink);
}

.card__remove:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.card-move {
  transition: transform 360ms var(--ease);
}

.card-leave-active {
  position: absolute;
  transition:
    opacity 240ms var(--ease),
    transform 240ms var(--ease);
}

.card-leave-to {
  opacity: 0;
  transform: scale(0.85) translateY(-0.5rem);
}

@media (prefers-reduced-motion: reduce) {
  .card-move,
  .card-leave-active {
    transition: none;
  }
}
</style>
