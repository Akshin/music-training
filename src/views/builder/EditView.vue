<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCheck, PhFloppyDisk, PhLink } from '@phosphor-icons/vue'
import AboutPanel from '@/components/builder/AboutPanel.vue'
import BarEntryPanel from '@/components/builder/BarEntryPanel.vue'
import ConditionsPanel from '@/components/builder/ConditionsPanel.vue'
import TimelinePanel from '@/components/builder/TimelinePanel.vue'
import PitchRoll from '@/components/pitch/PitchRoll.vue'
import { EMPTY_PITCH_TRACE } from '@/components/pitch/trace'
import { useBuilderDraft } from '@/composables/useBuilderDraft'
import { useBuilderKeys } from '@/composables/useBuilderKeys'
import { useCustomTrainings } from '@/composables/useCustomTrainings'
import { useDraftSaving } from '@/composables/useDraftSaving'
import { useNoteEntry } from '@/composables/useNoteEntry'
import { isNote, type BarElement } from '@/training/builder'

/** The block flashes this long before its bar leaves for the timeline, ms. */
const SEAL_PAUSE_MS = 140
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

const builder = useBuilderDraft(initial)
const entry = useNoteEntry(builder)
const saving = useDraftSaving(builder.draft, builder.hasElements, savedId, initial)
const { title, description, bpmRange, loudness, onset, beats, bars, current } = builder
const { link, linkCopied } = saving

/** Empty bars are drawn around the octave the keys play in. */
const span = builder.spanAround(computed(() => (entry.octave.value + 1) * 12 + 6))

// ---- Adding elements; a full bar flies into the timeline ----

const sealing = ref(false)
const entryPanel = ref<InstanceType<typeof BarEntryPanel> | null>(null)
const timelinePanel = ref<InstanceType<typeof TimelinePanel> | null>(null)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

function add(element: BarElement) {
  if (sealing.value || !builder.add(element)) return
  if (isNote(element)) entry.lightKey(element.midi)
  if (builder.isFull.value) void seal()
}

function undo() {
  if (!sealing.value) builder.undo()
}

/**
 * The full bar becomes a card: after a short flash of the block it lands at the end of the timeline
 * and is animated from where the block was, so it flies from the block into its slot.
 */
async function seal() {
  sealing.value = true
  const from = entryPanel.value?.roll?.getBoundingClientRect()
  await new Promise((resolve) =>
    window.setTimeout(resolve, reducedMotion.matches ? 0 : SEAL_PAUSE_MS),
  )
  const bar = builder.seal()
  // The block is free again at once: the next bar can be typed while the card flies.
  sealing.value = false
  await nextTick()

  const timeline = timelinePanel.value
  const card = timeline?.cardOf(bar.id)
  timeline?.scrollToEnd()
  if (!card || !from || reducedMotion.matches) return
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

useBuilderKeys({
  note: (pitchClass) => add(entry.noteAt(pitchClass)),
  rest: () => add(entry.element('rest')),
  inhale: () => add(entry.element('inhale')),
  exhale: () => add(entry.element('exhale')),
  undo,
  octave: entry.shiftOctave,
  length: entry.pickLength,
})
</script>

<template>
  <main id="main" class="page">
    <section class="page-head">
      <p class="kicker">Конструктор</p>
      <h1 class="page-title" :class="{ 'page-title--empty': !title.trim() }">
        {{ title.trim() || 'Новая тренировка' }}
      </h1>
      <p class="page-lead">
        Задай условия, набери ноты по тактам — заполненный такт уезжает в таймлайн.
      </p>
      <div class="save">
        <button
          type="button"
          class="btn btn--primary"
          :disabled="!saving.canSave.value"
          @click="saving.save"
        >
          <PhFloppyDisk :size="16" weight="light" aria-hidden="true" />
          Сохранить
        </button>
        <button
          type="button"
          class="btn"
          :disabled="bars.length === 0"
          :title="bars.length === 0 ? 'В ссылку идут только заполненные такты' : undefined"
          @click="saving.share"
        >
          <PhLink :size="16" weight="light" aria-hidden="true" />
          Получить ссылку
        </button>
        <span class="save__state" aria-live="polite">{{ saving.state.value }}</span>
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

    <AboutPanel v-model:title="title" v-model:description="description" />

    <ConditionsPanel
      v-model:bpm-range="bpmRange"
      v-model:loudness="loudness"
      v-model:onset="onset"
      v-model:beats="beats"
      :meter-locked="builder.meterLocked.value"
    />

    <BarEntryPanel
      ref="entryPanel"
      :builder="builder"
      :entry="entry"
      :span="span"
      :sealing="sealing"
      @add="add"
      @undo="undo"
    />

    <TimelinePanel ref="timelinePanel" :builder="builder" :span="span" />

    <section class="panel" aria-labelledby="preview-title">
      <h2 id="preview-title" class="panel__title">Как это увидит ученик</h2>
      <PitchRoll
        class="preview"
        :trace="EMPTY_PITCH_TRACE"
        :low="span.low"
        :high="span.high"
        :seconds="PREVIEW_LEAD"
        :ahead="builder.preview.value.seconds"
        :now="0"
        :targets="builder.preview.value.targets"
        :breaths="builder.preview.value.breaths"
        breath-loop
        label="Ноты тренировки по высоте и времени"
      />
    </section>
  </main>
</template>

<style scoped>
.page-title--empty {
  color: color-mix(in srgb, var(--muted) 70%, transparent);
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

.preview {
  height: 14rem;
}
</style>
