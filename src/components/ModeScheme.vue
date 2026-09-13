<script setup lang="ts">
import { computed } from 'vue'
import SchemeCircle from '@/components/SchemeCircle.vue'
import PianoHelper from '@/components/PianoHelper.vue'
import TabHelper from '@/components/TabHelper.vue'
import { findNamedMode, namedModeTitle } from '@/training/modes'
import { modeLabel, modeSchemeCombo, type ModePattern, type SchemePattern } from '@/training/patterns'
import { TAB_INSTRUMENT_DEFAULT, type TabInstrument } from '@/training/tabs'

const props = withDefaults(
  defineProps<{
    mode: ModePattern
    caption?: string
    /** Timer captions skip uppercase so «3.4 с» stays readable. */
    captionCount?: boolean
    quiet?: boolean
    lifted?: boolean
    /** When false, transform/opacity are driven by the parent stage only. */
    motion?: boolean
    /** Show diatonic mode name under the card when the pair matches. */
    showModeName?: boolean
    tabInstrument?: TabInstrument
    /** Tonic pitch class (C = 0) the tab or keys are drawn from; each helper has its own default. */
    tonic?: number
  }>(),
  {
    motion: true,
    showModeName: true,
    tabInstrument: TAB_INSTRUMENT_DEFAULT,
  },
)

const named = computed(() => findNamedMode(props.mode))
const namedTitle = computed(() => (named.value ? namedModeTitle(named.value) : null))
const combo = computed(() => modeSchemeCombo(props.mode))
const cardLabel = computed(() => {
  const bits = [
    combo.value,
    props.captionCount && props.caption ? `через ${props.caption}` : props.caption,
    modeLabel(props.mode),
    props.showModeName ? namedTitle.value : null,
  ].filter((bit): bit is string => Boolean(bit))
  return bits.join('. ')
})

function schemeKey(pattern: SchemePattern, side: string): string {
  return `${side}-${pattern.join('-')}`
}
</script>

<template>
  <article
    class="mode"
    :class="{
      'mode--quiet': quiet,
      'mode--lifted': lifted,
      'mode--static': !motion,
    }"
    :aria-label="cardLabel"
  >
    <div class="mode__face">
    <p v-if="combo" class="mode__combo">{{ combo }}</p>
    <div class="mode__shell">
      <div class="mode__core">
        <p v-if="caption" class="mode__caption" :class="{ 'mode__caption--count': captionCount }">
          {{ caption }}
        </p>
        <div class="mode__lad" aria-hidden="true">
          <div class="mode__scheme" :key="schemeKey(mode.first, 'a')">
            <span v-for="(kind, i) in mode.first" :key="`a-${kind}-${i}`" class="mode__cell">
              <SchemeCircle :kind="kind" />
            </span>
          </div>

          <span class="mode__tc" title="Тон связующий">
            <SchemeCircle kind="tc" />
          </span>

          <div class="mode__scheme" :key="schemeKey(mode.second, 'b')">
            <span v-for="(kind, i) in mode.second" :key="`b-${kind}-${i}`" class="mode__cell">
              <SchemeCircle :kind="kind" />
            </span>
          </div>
        </div>
      </div>
    </div>
    </div>

    <PianoHelper v-if="tabInstrument === 'piano'" class="mode__tab" :mode="mode" :tonic="tonic" />
    <TabHelper
      v-else-if="tabInstrument === 'guitar'"
      class="mode__tab"
      :mode="mode"
      :tonic="tonic"
    />

    <p v-if="showModeName && namedTitle" class="mode__name">{{ namedTitle }}</p>
  </article>
</template>

<style scoped>
.mode {
  position: relative;
  width: min(30rem, 100%);
  flex: none;
  transform-origin: center center;
  transition:
    transform 520ms cubic-bezier(0.33, 0.08, 0.18, 1),
    opacity 520ms cubic-bezier(0.33, 0.08, 0.18, 1);
}

.mode--static {
  transition: none;
}

.mode--static .mode__shell {
  transition: none;
}

.mode--quiet {
  opacity: 0.62;
  transform: scale(0.92);
}

.mode--lifted {
  opacity: 1;
  transform: translateY(-7px) scale(1.06);
}

.mode--lifted .mode__shell {
  border-color: #0b0d11;
  box-shadow:
    0 0 0 2px #0b0d11,
    0 18px 38px rgb(8 10 14 / 58%),
    inset 0 1px 0 rgb(255 255 255 / 8%);
}

.mode__face {
  position: relative;
}

.mode__combo {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin: 0 0 0.4rem;
  color: var(--ink);
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1.2;
  text-align: center;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.mode--quiet .mode__combo {
  color: var(--muted);
}

.mode__shell {
  padding: 0.35rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-shell);
  background: color-mix(in srgb, var(--bg-inset) 65%, transparent);
  transition:
    border-color 520ms cubic-bezier(0.33, 0.08, 0.18, 1),
    box-shadow 520ms cubic-bezier(0.33, 0.08, 0.18, 1);
}

.mode__core {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 0.85rem 0.85rem 1.05rem;
  border-radius: var(--radius-core);
  background: var(--bg-raised);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 12%);
}

.mode__caption {
  margin: 0;
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mode__caption--count {
  letter-spacing: 0.06em;
  text-transform: none;
  font-variant-numeric: tabular-nums;
}

.mode__lad {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.mode__scheme {
  display: grid;
  flex: 1 1 0;
  grid-template-columns: repeat(3, 1fr);
  align-items: center;
  min-width: 0;
  border-left: 1px solid color-mix(in srgb, var(--ink) 22%, transparent);
}

.mode__cell {
  display: grid;
  place-items: center;
  height: 3.1rem;
  border-right: 1px solid color-mix(in srgb, var(--ink) 22%, transparent);
}

.mode__cell :deep(.scheme-circle),
.mode__tc :deep(.scheme-circle) {
  width: 1.35rem;
  height: 1.35rem;
}

.mode__tc {
  display: grid;
  flex: none;
  place-items: center;
  width: 1.7rem;
}

.mode__tab {
  margin-top: 0.55rem;
  opacity: 0.62;
}

.mode--quiet .mode__tab {
  opacity: 1;
}

.mode__name {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin: 0.45rem 0 0;
  color: var(--ink);
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.25;
  text-align: center;
  text-wrap: balance;
  pointer-events: none;
}

.mode--quiet .mode__name {
  color: var(--muted);
}

@media (max-width: 767px) {
  .mode {
    width: min(100%, calc(100vw / 2 - 0.75rem));
  }

  .mode__lad {
    flex-direction: column;
    gap: 0.4rem;
  }

  .mode__scheme {
    width: 100%;
  }

  .mode__cell {
    height: 2.55rem;
  }

  .mode__cell :deep(.scheme-circle),
  .mode__tc :deep(.scheme-circle) {
    width: 1.15rem;
    height: 1.15rem;
  }

  .mode--quiet {
    transform: none;
  }

  .mode--lifted {
    transform: translateY(-4px) scale(1.03);
  }
}
</style>
