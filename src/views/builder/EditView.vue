<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  PhArrowCounterClockwise,
  PhCheck,
  PhCloud,
  PhFloppyDisk,
  PhGauge,
  PhLink,
  PhMinus,
  PhPause,
  PhPlus,
  PhRepeat,
  PhSpeakerHigh,
  PhTimer,
  PhTrash,
  PhWind,
  PhX,
} from '@phosphor-icons/vue'
import BarRoll from '@/components/builder/BarRoll.vue'
import BpmRangeControl from '@/components/builder/BpmRangeControl.vue'
import NotePad from '@/components/builder/NotePad.vue'
import SegmentedChoice, { type SegmentedOption } from '@/components/builder/SegmentedChoice.vue'
import TimeSignatureControl from '@/components/controls/TimeSignatureControl.vue'
import PitchRoll from '@/components/pitch/PitchRoll.vue'
import { EMPTY_PITCH_TRACE } from '@/components/pitch/trace'
import type { BreathKind } from '@/components/pitch/breath'
import { loudnessColor } from '@/components/loudness'
import { noteName } from '@/training/keys'
import { copyText, trainingLink, useCustomTrainings } from '@/composables/useCustomTrainings'
import {
  BPM_RANGE_DEFAULT,
  LOUDNESS_ZONES,
  NOTE_KINDS,
  NOTE_LENGTHS,
  NOTE_LENGTH_DEFAULT,
  OCTAVE_DEFAULT,
  OCTAVE_MAX,
  OCTAVE_MIN,
  ONSETS,
  PAD_KEYS,
  barCapacity,
  barFill,
  addRepeat,
  barsSeconds,
  expandBars,
  repeatAt,
  withoutBar,
  REPEAT_TIMES_MAX,
  REPEAT_TIMES_MIN,
  elementLabel,
  lastPitch,
  toBreaths,
  fits,
  longestFitting,
  pitchSpan,
  previewBpm,
  sixteenthsPerBeat,
  toTargets,
  type BpmRange,
  type BuilderBar,
  type BuilderNote,
  type LoudnessZone,
  type NoteKind,
  type Onset,
  type Repeat,
  type TrainingDraft,
} from '@/training/builder'

/** The key of the note just added stays lit this long, ms. */
const FLASH_MS = 180
/** A full bar flies from the block into the timeline over this long, ms. */
const SEAL_MS = 560
/**
 * The preview puts now a moment before the first note, seconds: the chart fades what is left of
 * now, so it needs some room there.
 */
const PREVIEW_LEAD = 0.25

const route = useRoute()
const router = useRouter()
const store = useCustomTrainings()

/**
 * `?id=` edits a saved training; without it the builder starts a new one, kept as a draft until
 * it is saved. The page is remounted when the id changes, so this is read once.
 */
const savedId = ref(typeof route.query.id === 'string' ? route.query.id : undefined)
const saved = savedId.value === undefined ? undefined : store.find(savedId.value)
if (savedId.value !== undefined && saved === undefined) {
  savedId.value = undefined
  void router.replace({ query: {} })
}
const initial = saved?.draft ?? store.loadNewDraft()
/** The draft as last saved, to tell unsaved changes; null for a new training. */
const savedSnapshot = ref(saved ? JSON.stringify(saved.draft) : null)

const title = ref(initial.title)
const bpmRange = ref<BpmRange | null>(initial.bpmRange)
/** The last range chosen, kept while the range is off so switching it back restores it. */
const lastBpmRange = ref<BpmRange>(initial.bpmRange ?? BPM_RANGE_DEFAULT)
const loudness = ref<LoudnessZone | null>(initial.loudness)
const beats = ref(initial.beats)
const onset = ref<Onset>(initial.onset)
const bars = ref<BuilderBar[]>([...initial.bars])
const repeats = ref<Repeat[]>([...initial.repeats])
const current = ref<BuilderNote[]>([...initial.current])

const length = ref(NOTE_LENGTH_DEFAULT)
const kind = ref<NoteKind>('hold')
const octave = ref(OCTAVE_DEFAULT)
const flash = ref<number | null>(null)
const sealing = ref(false)

let nextBarId = bars.value.reduce((max, bar) => Math.max(max, bar.id), 0) + 1
let flashTimer = 0

const draft = computed<TrainingDraft>(() => ({
  title: title.value,
  bpmRange: bpmRange.value,
  loudness: loudness.value,
  beats: beats.value,
  onset: onset.value,
  bars: bars.value,
  repeats: repeats.value,
  current: current.value,
}))

watch(draft, (value) => {
  if (savedId.value === undefined) store.storeNewDraft(value)
})

// ---- Saving and sharing ----

const hasNotes = computed(() => bars.value.length > 0 || current.value.length > 0)
const dirty = computed(() => savedSnapshot.value !== JSON.stringify(draft.value))
const saveState = computed(() => {
  if (savedSnapshot.value === null) return hasNotes.value ? 'Не сохранена' : ''
  return dirty.value ? 'Есть несохранённые изменения' : 'Сохранена'
})

async function save() {
  const value: TrainingDraft = { ...draft.value, title: title.value.trim() }
  const id = store.save(value, savedId.value)
  savedSnapshot.value = JSON.stringify(draft.value)
  if (savedId.value === undefined) {
    savedId.value = id
    store.storeNewDraft(null)
    await router.replace({ query: { id } })
  }
}

const link = ref('')
const linkCopied = ref(false)

async function shareLink() {
  link.value = await trainingLink(router, draft.value)
  linkCopied.value = await copyText(link.value)
}

// A link shows the training as it was; once it changes the link is stale.
watch(draft, () => {
  link.value = ''
  linkCopied.value = false
})

// ---- Conditions ----

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

/** The meter holds while there are notes: bars of different lengths would not line up. */
const meterLocked = computed(() => bars.value.length > 0 || current.value.length > 0)

// ---- The bar being filled ----

const capacity = computed(() => barCapacity(beats.value))
const filled = computed(() => barFill(current.value))

const lengthOptions = computed<SegmentedOption<number>[]>(() =>
  NOTE_LENGTHS.map((option) => ({
    value: option.sixteenths,
    label: option.label,
    disabled: !fits(current.value, option.sixteenths, beats.value),
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

// After a note, the chosen length may no longer fit: fall back to the longest that does.
watch([current, beats], () => {
  if (fits(current.value, length.value, beats.value)) return
  length.value = longestFitting(current.value, beats.value) ?? NOTE_LENGTH_DEFAULT
})

const blockRoll = ref<HTMLElement | null>(null)
const timeline = ref<HTMLElement | null>(null)

/** Adds a note, or a rest when `midi` is null, or a breath. */
function add(midi: number | null, breath?: BreathKind) {
  if (sealing.value || !fits(current.value, length.value, beats.value)) return
  const note: BuilderNote =
    breath !== undefined
      ? { midi: null, sixteenths: length.value, kind: 'hold', breath }
      : { midi, sixteenths: length.value, kind: midi === null ? 'hold' : kind.value }
  current.value = [...current.value, note]
  if (midi !== null) {
    flash.value = midi
    window.clearTimeout(flashTimer)
    flashTimer = window.setTimeout(() => (flash.value = null), FLASH_MS)
  }
  if (barFill(current.value) === capacity.value) void seal()
}

function undo() {
  if (sealing.value) return
  current.value = current.value.slice(0, -1)
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/**
 * The full bar becomes a card: after a short flash of the block it lands at the end of the timeline
 * and is animated from where the block was, so it flies from the block into its slot.
 */
async function seal() {
  sealing.value = true
  const from = blockRoll.value?.getBoundingClientRect()
  await new Promise((resolve) => window.setTimeout(resolve, reducedMotion.matches ? 0 : 140))

  const bar: BuilderBar = { id: nextBarId++, notes: current.value }
  bars.value = [...bars.value, bar]
  current.value = []
  // The block is free again at once: the next bar can be typed while the card flies.
  sealing.value = false
  await nextTick()

  const scroller = timeline.value
  const card = scroller?.querySelector<HTMLElement>(`[data-bar="${bar.id}"]`)
  // Scroll to the end at once, so the card is measured where it comes to rest.
  scroller?.scrollTo({ left: scroller.scrollWidth })
  if (card && from && !reducedMotion.matches) {
    const to = card.getBoundingClientRect()
    const accent = getComputedStyle(card).getPropertyValue('--accent').trim() || 'currentColor'
    card.animate(
      [
        {
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
          opacity: 0.4,
          boxShadow: `0 0 0 0 ${accent}`,
        },
        { offset: 0.7, opacity: 1, boxShadow: `0 0 0 3px ${accent}` },
        { transform: 'none', opacity: 1, boxShadow: `0 0 0 0 ${accent}` },
      ],
      { duration: SEAL_MS, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
    )
  }
}

function removeBar(id: number) {
  const index = bars.value.findIndex((bar) => bar.id === id)
  if (index < 0) return
  bars.value = bars.value.filter((bar) => bar.id !== id)
  repeats.value = withoutBar(repeats.value, index)
  cancelPick()
}

function clearAll() {
  if (!window.confirm('Удалить все такты и ноты?')) return
  bars.value = []
  repeats.value = []
  current.value = []
  cancelPick()
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

/** Whether the block from the first pick to `to` is free of other reprises. */
function pickFits(to: number): boolean {
  const from = pickFrom.value ?? to
  return addRepeat(repeats.value, from, to).length > repeats.value.length
}

function pickBar(index: number) {
  if (!picking.value || !pickFits(index)) return
  if (pickFrom.value === null) {
    pickFrom.value = index
    return
  }
  repeats.value = addRepeat(repeats.value, pickFrom.value, index)
  cancelPick()
}

/** Bars lit while picking: the first pick alone, or the block up to the bar under the pointer. */
function inPick(index: number): boolean {
  const from = pickFrom.value
  if (!picking.value || from === null) return false
  const to = pickHover.value !== null && pickFits(pickHover.value) ? pickHover.value : from
  return Math.min(from, to) <= index && index <= Math.max(from, to)
}

function setTimes(repeat: Repeat, by: number) {
  const times = Math.min(REPEAT_TIMES_MAX, Math.max(REPEAT_TIMES_MIN, repeat.times + by))
  repeats.value = repeats.value.map((item) => (item === repeat ? { ...item, times } : item))
}

function removeRepeat(repeat: Repeat) {
  repeats.value = repeats.value.filter((item) => item !== repeat)
}

// ---- Drawing ----

/** One pitch range for every bar, so bars compare at a glance; at least an octave. */
const span = computed(() => {
  const found = pitchSpan([...bars.value.flatMap((bar) => bar.notes), ...current.value])
  const middle = found ? Math.round((found.low + found.high) / 2) : (octave.value + 1) * 12 + 6
  const low = Math.min(found?.low ?? middle, middle - 6) - 1
  const high = Math.max(found?.high ?? middle, middle + 6) + 1
  return { low, high }
})

/** The pitch after each bar, which a slide at its end glides into. */
function nextMidiAfter(index: number): number | null {
  const later = [...bars.value.slice(index + 1).flatMap((bar) => bar.notes), ...current.value]
  return later[0]?.midi ?? null
}

/** The last pitch before bar `index` (the bar being filled when past the end). */
function prevMidiBefore(index: number): number | null {
  const earlier = bars.value.slice(0, index).flatMap((bar) => bar.notes)
  return lastPitch(earlier)
}

function barNames(notes: readonly BuilderNote[]): string {
  return notes
    .map((note) =>
      note.breath
        ? elementLabel(note, noteName).toLowerCase()
        : note.midi === null
          ? '·'
          : noteName(note.midi),
    )
    .join(' ')
}

const bpm = computed(() => previewBpm(draft.value))
/** The bars in the order they are sung, reprises unrolled. */
const playedBars = computed(() =>
  expandBars(
    bars.value.map((bar) => bar.notes),
    repeats.value,
  ),
)
const previewBars = computed(() => [...playedBars.value, current.value])
const targets = computed(() => toTargets(previewBars.value, beats.value, bpm.value))
const breaths = computed(() => toBreaths(previewBars.value, beats.value, bpm.value))
const previewSeconds = computed(() =>
  Math.max(
    1,
    barsSeconds(
      playedBars.value.length + (current.value.length > 0 ? 1 : 0),
      beats.value,
      bpm.value,
    ),
  ),
)
const totalLabel = computed(() => {
  const seconds = Math.round(barsSeconds(playedBars.value.length, beats.value, bpm.value))
  return seconds >= 60 ? `${Math.floor(seconds / 60)} мин ${seconds % 60} с` : `${seconds} с`
})

// ---- Keyboard: a piano on the home row ----

const PAD_CODES = PAD_KEYS.map((key) => `Key${key.toUpperCase()}`)

function onKeydown(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
  // Letters go to text fields; switches and sliders keep the piano.
  const target = event.target
  if (
    target instanceof Element &&
    target.closest('input[type="text"], textarea, select, [contenteditable="true"]')
  ) {
    return
  }
  const pitchClass = PAD_CODES.indexOf(event.code)
  if (pitchClass >= 0) {
    add((octave.value + 1) * 12 + pitchClass)
  } else if (event.code === 'KeyZ') {
    octave.value = Math.max(OCTAVE_MIN, octave.value - 1)
  } else if (event.code === 'KeyX') {
    octave.value = Math.min(OCTAVE_MAX, octave.value + 1)
  } else if (event.code === 'KeyR') {
    add(null)
  } else if (event.code === 'KeyV') {
    add(null, 'inhale')
  } else if (event.code === 'KeyB') {
    add(null, 'exhale')
  } else if (event.code === 'Escape' && picking.value) {
    cancelPick()
  } else if (event.code === 'Backspace') {
    undo()
  } else if (/^Digit[1-5]$/.test(event.code)) {
    const option = NOTE_LENGTHS[Number(event.code.slice(5)) - 1]
    if (option && fits(current.value, option.sixteenths, beats.value))
      length.value = option.sixteenths
  } else {
    return
  }
  event.preventDefault()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.clearTimeout(flashTimer)
})
</script>

<template>
  <main id="main" class="builder">
    <section class="head">
      <p class="kicker">Конструктор</p>
      <input
        v-model="title"
        class="head__title"
        type="text"
        placeholder="Новая тренировка"
        aria-label="Название тренировки"
        maxlength="80"
      />
      <p class="head__lead">
        Задай условия, набери ноты по тактам — заполненный такт уезжает в таймлайн.
      </p>
      <div class="save">
        <button
          type="button"
          class="action action--primary"
          :disabled="!hasNotes || (savedSnapshot !== null && !dirty)"
          @click="save"
        >
          <PhFloppyDisk :size="16" weight="light" aria-hidden="true" />
          Сохранить
        </button>
        <button
          type="button"
          class="action"
          :disabled="bars.length === 0"
          :title="bars.length === 0 ? 'В ссылку идут только заполненные такты' : undefined"
          @click="shareLink"
        >
          <PhLink :size="16" weight="light" aria-hidden="true" />
          Получить ссылку
        </button>
        <span class="save__state" aria-live="polite">{{ saveState }}</span>
      </div>
      <div v-if="link" class="share">
        <input
          class="share__field"
          type="text"
          readonly
          :value="link"
          aria-label="Ссылка на тренировку"
          @focus="($event.target as HTMLInputElement).select()"
        />
        <span class="share__note" aria-live="polite">
          <template v-if="linkCopied">
            <PhCheck :size="14" weight="bold" aria-hidden="true" />
            Скопировано
          </template>
          <template v-else>Скопируй ссылку из поля</template>
        </span>
        <span v-if="current.length" class="share__note">
          Незаполненный такт в ссылку не попал.
        </span>
      </div>
    </section>

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
          <p v-else class="cond__note">Пользователь выберет темп сам, от 40 до 208 BPM.</p>
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

    <section class="panel" aria-labelledby="bar-title">
      <div class="panel__row">
        <h2 id="bar-title" class="panel__title">Такт {{ bars.length + 1 }}</h2>
        <span class="bar__fill" aria-live="polite">{{ filledLabel }}</span>
      </div>

      <div class="block" :class="{ 'block--sealing': sealing }">
        <div ref="blockRoll" class="block__roll">
          <BarRoll
            :notes="current"
            :beats="beats"
            :low="span.low"
            :high="span.high"
            :prev-midi="prevMidiBefore(bars.length)"
            :bpm="bpm"
            show-rest
          />
        </div>
        <ol v-if="current.length" class="block__notes" aria-label="Ноты такта">
          <li v-for="(note, index) in current" :key="index" class="chip">
            {{ elementLabel(note, noteName) }}
            <span class="chip__meta">
              {{ NOTE_LENGTHS.find((option) => option.sixteenths === note.sixteenths)?.label }}
              <template v-if="note.midi !== null && note.kind !== 'hold'">
                · {{ NOTE_KINDS.find((option) => option.kind === note.kind)?.label }}
              </template>
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
            <p class="cond__note">{{ kindHint }}</p>
          </div>
        </div>

        <NotePad v-model:octave="octave" :flash="flash" :disabled="sealing" @note="add" />

        <div class="entry__actions">
          <button
            type="button"
            class="action"
            :disabled="sealing"
            title="Пауза (R)"
            @click="add(null)"
          >
            <PhPause :size="16" weight="light" aria-hidden="true" />
            Пауза
          </button>
          <button
            type="button"
            class="action"
            :disabled="sealing"
            title="Вдох (V): дымка собирается в точку"
            @click="add(null, 'inhale')"
          >
            <PhCloud :size="16" weight="light" aria-hidden="true" />
            Вдох
          </button>
          <button
            type="button"
            class="action"
            :disabled="sealing"
            title="Выдох (B): дымка выходит из точки"
            @click="add(null, 'exhale')"
          >
            <PhCloud :size="16" weight="light" aria-hidden="true" />
            Выдох
          </button>
          <button
            type="button"
            class="action"
            :disabled="sealing || current.length === 0"
            title="Убрать последнюю ноту (Backspace)"
            @click="undo"
          >
            <PhArrowCounterClockwise :size="16" weight="light" aria-hidden="true" />
            Отменить
          </button>
        </div>
      </div>
    </section>

    <section class="panel" aria-labelledby="timeline-title">
      <div class="panel__row">
        <h2 id="timeline-title" class="panel__title">Таймлайн</h2>
        <span v-if="bars.length" class="bar__fill">
          {{ bars.length }}
          {{ bars.length === 1 ? 'такт' : bars.length < 5 ? 'такта' : 'тактов' }}
          <template v-if="playedBars.length !== bars.length">
            ({{ playedBars.length }} с повторами)
          </template>
          · {{ totalLabel }} при {{ bpm }} BPM
        </span>
        <button
          v-if="bars.length && !picking"
          type="button"
          class="action action--quiet action--push"
          title="Выбери первый и последний такт блока, который надо повторить"
          @click="startPick"
        >
          <PhRepeat :size="14" weight="light" aria-hidden="true" />
          Реприза
        </button>
        <button
          v-if="bars.length || current.length"
          type="button"
          class="action action--quiet"
          :class="{ 'action--push': !bars.length || picking }"
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
        <button type="button" class="action action--quiet" @click="cancelPick">Отмена</button>
      </p>

      <div v-show="bars.length" ref="timeline" class="timeline">
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
                  @click.stop="setTimes(repeatAt(repeats, index)!, -1)"
                >
                  <PhMinus :size="10" weight="bold" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="repeat__btn"
                  aria-label="Играть чаще"
                  :disabled="repeatAt(repeats, index)!.times >= REPEAT_TIMES_MAX"
                  @click.stop="setTimes(repeatAt(repeats, index)!, 1)"
                >
                  <PhPlus :size="10" weight="bold" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="repeat__btn"
                  aria-label="Убрать репризу"
                  @click.stop="removeRepeat(repeatAt(repeats, index)!)"
                >
                  <PhX :size="10" weight="bold" aria-hidden="true" />
                </button>
              </div>
            </template>
            <span class="card__index">{{ index + 1 }}</span>
            <div class="card__roll">
              <BarRoll
                :notes="bar.notes"
                :beats="beats"
                :low="span.low"
                :high="span.high"
                :next-midi="nextMidiAfter(index)"
                :prev-midi="prevMidiBefore(index)"
                :bpm="bpm"
              />
            </div>
            <span class="card__names">{{ barNames(bar.notes) }}</span>
            <button
              type="button"
              class="card__remove"
              :aria-label="`Удалить такт ${index + 1}`"
              @click.stop="removeBar(bar.id)"
            >
              <PhX :size="12" weight="bold" aria-hidden="true" />
            </button>
          </li>
        </TransitionGroup>
      </div>
      <p v-if="bars.length === 0" class="timeline__empty">Здесь появятся заполненные такты.</p>
    </section>

    <section class="panel" aria-labelledby="preview-title">
      <div class="panel__row">
        <h2 id="preview-title" class="panel__title">Как это увидит ученик</h2>
      </div>
      <PitchRoll
        class="preview"
        :trace="EMPTY_PITCH_TRACE"
        :low="span.low"
        :high="span.high"
        :seconds="PREVIEW_LEAD"
        :ahead="previewSeconds"
        :now="0"
        :targets="targets"
        :breaths="breaths"
        breath-loop
        label="Ноты тренировки по высоте и времени"
      />
    </section>
  </main>
</template>

<style scoped>
.builder {
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
  display: block;
  width: 100%;
  margin: 0 0 0.85rem;
  padding: 0;
  border: none;
  border-bottom: 1px dashed transparent;
  background: transparent;
  color: var(--ink);
  font-size: clamp(2rem, 4.6vw, 3.2rem);
  font-weight: 600;
  letter-spacing: -0.045em;
  line-height: 1.15;
  outline: none;
}

.head__title::placeholder {
  color: color-mix(in srgb, var(--muted) 70%, transparent);
}

.head__title:hover,
.head__title:focus {
  border-bottom-color: var(--line);
}

.head__lead {
  margin: 0;
  max-width: 50ch;
  color: var(--muted);
  font-size: 1.05rem;
  line-height: 1.55;
  text-wrap: pretty;
}

.save {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin-top: 1.5rem;
}

.save__state {
  color: var(--muted);
  font-size: 0.85rem;
}

.share {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin-top: 0.85rem;
}

.share__field {
  flex: 1 1 18rem;
  min-width: 0;
  height: 2.3rem;
  padding: 0 0.85rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--bg-inset);
  color: var(--ink);
  font-size: 0.8rem;
  outline: none;
}

.share__field:focus {
  border-color: var(--accent);
}

.share__note {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--muted);
  font-size: 0.82rem;
}

.panel {
  display: grid;
  gap: 1rem;
  margin-top: 1.25rem;
  padding: 1.35rem 1.4rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-core);
  background: var(--bg-raised);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 12%);
}

.panel__row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem 1rem;
}

.panel__title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

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

.bar__fill {
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

.block__notes {
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

.entry__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
}

.action {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 2.3rem;
  padding: 0 1rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--bg-inset);
  color: var(--ink);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 280ms var(--ease);
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

.action--push {
  margin-left: auto;
}

.action--primary {
  border-color: transparent;
  background: var(--accent);
  color: var(--accent-ink);
}

.action--quiet {
  height: 1.9rem;
  padding: 0 0.75rem;
  color: var(--muted);
  font-size: 0.78rem;
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

.pick .action--quiet {
  margin-left: auto;
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

.preview {
  height: 14rem;
}

@media (max-width: 600px) {
  .panel {
    padding: 1.1rem 1rem;
  }

  .cond {
    padding: 0.85rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .card-move,
  .card-leave-active {
    transition: none;
  }
}
</style>
