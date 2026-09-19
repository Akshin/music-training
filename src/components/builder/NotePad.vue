<script setup lang="ts">
import { computed } from 'vue'
import { PhMinus, PhPlus } from '@phosphor-icons/vue'
import { TONAL_KEYS } from '@/training/keys'
import { OCTAVE_MAX, OCTAVE_MIN, PAD_KEYS } from '@/training/builder'

const props = defineProps<{
  /** Octave the keys play in, scientific: 4 is C4–B4. */
  octave: number
  /** Key the last note came from, lit for a moment. */
  flash?: number | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  note: [midi: number]
  'update:octave': [octave: number]
}>()

const WHITE = [0, 2, 4, 5, 7, 9, 11]
/** Black keys by the white key they sit after: C#, D#, F#, G#, A#. */
const BLACK = [
  { pitchClass: 1, after: 1 },
  { pitchClass: 3, after: 2 },
  { pitchClass: 6, after: 4 },
  { pitchClass: 8, after: 5 },
  { pitchClass: 10, after: 6 },
]

const base = computed(() => (props.octave + 1) * 12)

const whites = computed(() =>
  WHITE.map((pitchClass) => ({
    midi: base.value + pitchClass,
    name: TONAL_KEYS[pitchClass]!,
    shortcut: PAD_KEYS[pitchClass]!,
  })),
)

const blacks = computed(() =>
  BLACK.map(({ pitchClass, after }) => ({
    midi: base.value + pitchClass,
    name: TONAL_KEYS[pitchClass]!,
    shortcut: PAD_KEYS[pitchClass]!,
    after,
  })),
)

function shift(by: number) {
  emit('update:octave', Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, props.octave + by)))
}
</script>

<template>
  <div class="pad">
    <div class="pad__octave" role="group" aria-label="Октава">
      <button
        type="button"
        class="pad__step"
        :disabled="octave <= OCTAVE_MIN"
        aria-label="Октава ниже (Z)"
        title="Октава ниже (Z)"
        @click="shift(-1)"
      >
        <PhMinus :size="14" weight="bold" aria-hidden="true" />
      </button>
      <span class="pad__octave-value" aria-live="polite">Октава {{ octave }}</span>
      <button
        type="button"
        class="pad__step"
        :disabled="octave >= OCTAVE_MAX"
        aria-label="Октава выше (X)"
        title="Октава выше (X)"
        @click="shift(1)"
      >
        <PhPlus :size="14" weight="bold" aria-hidden="true" />
      </button>
    </div>

    <div class="pad__keys" role="group" aria-label="Ноты">
      <button
        v-for="key in whites"
        :key="key.midi"
        type="button"
        class="pad__white"
        :class="{ 'pad__key--flash': flash === key.midi }"
        :disabled="disabled"
        :aria-label="`${key.name}${octave}`"
        :title="`${key.name}${octave} (${key.shortcut.toUpperCase()})`"
        @click="emit('note', key.midi)"
      >
        <span class="pad__name">{{ key.name }}</span>
        <span class="pad__shortcut" aria-hidden="true">{{ key.shortcut }}</span>
      </button>
      <button
        v-for="key in blacks"
        :key="key.midi"
        type="button"
        class="pad__black"
        :class="{ 'pad__key--flash': flash === key.midi }"
        :style="{ '--after': key.after }"
        :disabled="disabled"
        :aria-label="`${key.name}${octave}`"
        :title="`${key.name}${octave} (${key.shortcut.toUpperCase()})`"
        @click="emit('note', key.midi)"
      >
        <span class="pad__name">{{ key.name }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.pad {
  display: grid;
  gap: 0.7rem;
  width: 100%;
}

.pad__octave {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
}

.pad__octave-value {
  min-width: 5.5rem;
  font-size: 0.82rem;
  font-weight: 600;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.pad__step {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--bg-inset);
  color: var(--ink);
  cursor: pointer;
}

.pad__step:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.pad__step:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.pad__keys {
  --white: calc(100% / 7);

  position: relative;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  height: 9rem;
  max-width: 30rem;
  width: 100%;
  margin: 0 auto;
  user-select: none;
}

.pad__white,
.pad__black {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 0.15rem;
  padding: 0 0 0.55rem;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    background 220ms var(--ease),
    transform 120ms var(--ease);
}

.pad__white {
  margin: 0 1px;
  border: 1px solid var(--line);
  border-radius: 0 0 0.7rem 0.7rem;
  background: linear-gradient(to bottom, color-mix(in srgb, var(--ink) 80%, var(--bg)), var(--ink));
  color: var(--bg);
  font-size: 0.8rem;
}

.pad__black {
  position: absolute;
  top: 0;
  left: calc(var(--white) * var(--after) - var(--white) * 0.3);
  z-index: 1;
  width: calc(var(--white) * 0.6);
  height: 58%;
  border: 1px solid var(--line);
  border-radius: 0 0 0.5rem 0.5rem;
  background: linear-gradient(to bottom, var(--bg-inset), var(--bg-raised));
  color: var(--muted);
  font-size: 0.62rem;
}

.pad__white:active:not(:disabled),
.pad__black:active:not(:disabled) {
  transform: translateY(2px);
}

.pad__white:hover:not(:disabled) {
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--ink) 70%, var(--accent)),
    var(--ink)
  );
}

.pad__black:hover:not(:disabled) {
  background: linear-gradient(
    to bottom,
    var(--bg-inset),
    color-mix(in srgb, var(--accent) 30%, var(--bg-raised))
  );
}

.pad__key--flash.pad__white,
.pad__key--flash.pad__black {
  background: var(--accent);
  color: var(--accent-ink);
}

.pad__white:disabled,
.pad__black:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.pad__white:focus-visible,
.pad__black:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -3px;
}

.pad__shortcut {
  font-size: 0.6rem;
  font-weight: 500;
  text-transform: uppercase;
  opacity: 0.55;
}

@media (hover: none) {
  .pad__shortcut {
    display: none;
  }
}
</style>
