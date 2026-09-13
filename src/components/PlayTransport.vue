<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhPlay, PhStop } from '@phosphor-icons/vue'
import { BPM_DEFAULT, secondsPerBeat } from '@/training/tempo'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    bpm?: number
  }>(),
  {
    modelValue: false,
    bpm: BPM_DEFAULT,
  },
)

const emit = defineEmits<{
  'update:modelValue': [playing: boolean]
}>()

const playing = ref(props.modelValue)

watch(
  () => props.modelValue,
  (next) => {
    if (next !== playing.value) playing.value = next
  },
)

const pulseDuration = computed(() => `${secondsPerBeat(props.bpm)}s`)
const caption = computed(() => (playing.value ? 'Остановить тренировку' : 'Начать тренировку'))
const captionShort = computed(() => (playing.value ? 'Стоп' : 'Начать'))

function toggle() {
  playing.value = !playing.value
  emit('update:modelValue', playing.value)
}
</script>

<template>
  <div
    class="player"
    :class="{ 'player--playing': playing }"
  >
    <span class="player__pulse" aria-hidden="true" />
    <button
      type="button"
      class="player__btn"
      :aria-pressed="playing"
      :aria-label="caption"
      @click="toggle"
    >
      <span class="player__icon" aria-hidden="true">
        <PhStop v-if="playing" :size="18" weight="fill" />
        <PhPlay v-else :size="18" weight="fill" />
      </span>
      <span class="player__caption">
        <span class="player__caption-full">{{ caption }}</span>
        <span class="player__caption-short">{{ captionShort }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
.player {
  --pulse-duration: v-bind(pulseDuration);

  position: relative;
  display: inline-flex;
  padding: 0.38rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--bg-raised) 74%, transparent);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 10%),
    0 14px 36px var(--shadow);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
}

.player__pulse {
  position: absolute;
  inset: -2px;
  border-radius: inherit;
  border: 1.5px solid transparent;
  pointer-events: none;
}

.player--playing .player__pulse {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  animation: player-pulse var(--pulse-duration) ease-out infinite;
}

.player__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.7rem;
  min-width: 17.25rem;
  height: 3.05rem;
  padding: 0 0.45rem 0 0.45rem;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-ink);
  cursor: pointer;
  transition:
    background 420ms var(--ease),
    color 420ms var(--ease),
    transform 220ms var(--ease);
}

.player__icon {
  display: grid;
  place-items: center;
  width: 2.15rem;
  height: 2.15rem;
  border-radius: 50%;
  background: rgb(26 29 20 / 14%);
  transition: transform 420ms var(--ease);
}

.player__btn:hover .player__icon {
  transform: translateX(1px) scale(1.04);
}

.player__caption {
  flex: 1;
  padding-right: 0.85rem;
  font-size: 0.88rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-align: left;
}

.player__btn:hover {
  filter: brightness(1.06);
}

.player--playing .player__btn {
  background: var(--ink);
  color: var(--bg);
  filter: none;
}

.player--playing .player__icon {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
}

.player--playing .player__btn:hover {
  filter: brightness(1.08);
}

.player__btn:active {
  transform: scale(0.97);
}

.player__btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.player__caption-short {
  display: none;
}

@media (max-width: 520px) {
  .player {
    width: min(100%, 22rem);
  }

  .player__btn {
    width: 100%;
    min-width: 0;
  }

  .player__caption-full {
    display: none;
  }

  .player__caption-short {
    display: inline;
  }
}

@keyframes player-pulse {
  0% {
    transform: scale(0.98);
    opacity: 1;
  }
  100% {
    transform: scale(1.04);
    opacity: 0;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .player {
    background: var(--bg-raised);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .player--playing .player__pulse {
    animation: none;
    opacity: 0.55;
  }

  .player__btn:hover .player__icon {
    transform: none;
  }
}
</style>
