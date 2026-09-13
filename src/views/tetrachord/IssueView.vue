<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhArrowUpRight, PhGuitar, PhTextT } from '@phosphor-icons/vue'
import IntervalScheme, { type IntervalKind as StepKind } from '@/components/IntervalScheme.vue'
import ModeScheme from '@/components/ModeScheme.vue'
import {
  namedModeTitle,
  PRACTICABLE_MODES,
  SCHEME_STT,
  SCHEME_TST,
  SCHEME_TTS,
} from '@/training/modes'
import {
  CHANGE_EVERY_DEFAULT,
  modeSchemeCombo,
  schemeId,
  type SchemePattern,
} from '@/training/patterns'
import { BEATS_DEFAULT, BPM_DEFAULT, secondsPerBeat } from '@/training/tempo'

type PracticeScheme = readonly [StepKind, StepKind, StepKind]

const positions: { title: string; pattern: PracticeScheme }[] = [
  { title: 'Тон — тон — полутон', pattern: SCHEME_TTS },
  { title: 'Тон — полутон — тон', pattern: SCHEME_TST },
  { title: 'Полутон — тон — тон', pattern: SCHEME_STT },
]

const ionian = PRACTICABLE_MODES.find((entry) => entry.id === 'ionian')!
const dorian = PRACTICABLE_MODES.find((entry) => entry.id === 'dorian')!

const goingUp = ref(true)
const demoPattern = computed((): StepKind[] => {
  const steps = [...positions[0]!.pattern]
  return goingUp.value ? steps : [...steps].reverse()
})

function schemeName(pattern: SchemePattern): string {
  return pattern.map((kind) => (kind === 'semitone' ? 'полутон' : 'тон')).join(' — ')
}

const demoCountdown = `${(secondsPerBeat(BPM_DEFAULT) * BEATS_DEFAULT * CHANGE_EVERY_DEFAULT).toFixed(1)} с`
</script>

<template>
  <main id="main" class="home">
    <section class="hero">
      <div class="hero__copy">
        <p class="kicker">Как устроена тренировка</p>
        <h1 class="hero__title">Две схемы, связующий тон, лад под пульс</h1>
        <p class="hero__lead">
          Слева играешь то, что сейчас. Справа видишь, что будет дальше. Карточка сама переезжает —
          ты не останавливаешься.
        </p>
        <RouterLink to="/tetrachord-training/resolve" class="cta">
          Играть
          <span class="cta__icon" aria-hidden="true">
            <PhArrowUpRight :size="16" weight="light" />
          </span>
        </RouterLink>
      </div>

      <div class="hero__stage">
        <div class="bezel">
          <div class="bezel__core bezel__core--preview">
            <div class="preview" aria-label="Так выглядит экран игры">
              <ModeScheme
                :mode="ionian.mode"
                caption="Сейчас"
                :motion="false"
                tab-instrument="off"
              />
              <div class="preview__split" aria-hidden="true" />
              <ModeScheme
                :mode="dorian.mode"
                :caption="demoCountdown"
                caption-count
                quiet
                :motion="false"
                tab-instrument="off"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="session">
      <h2>Как тренироваться</h2>
      <ol class="steps">
        <li>
          <span class="steps__n">1</span>
          <div>
            <h3>Открой тренировку</h3>
            <p>
              Слева карточка «Сейчас», справа следующий лад и секунды до смены. Это один лад и
              следующий.
            </p>
          </div>
        </li>
        <li>
          <span class="steps__n">2</span>
          <div>
            <h3>Задай темп и нажми Play</h3>
            <p>
              Темп и размер такта держат пульс. Вместе с частотой смены они и решают, сколько секунд
              живёт карточка.
            </p>
          </div>
        </li>
        <li>
          <span class="steps__n">3</span>
          <div>
            <h3>Играй левую карточку от тоники</h3>
            <p>
              Зелёный — тон (два лада). Жёлтый — полутон (соседний лад). Серый ТС — тон между двумя
              схемами. Над карточкой — пара схем, например S1 + S3. Схему можно вести вверх и вниз.
            </p>
          </div>
        </li>
        <li>
          <span class="steps__n">4</span>
          <div>
            <h3>Не стой, когда карточка уезжает</h3>
            <p>
              Правая карточка переезжает налево. Смену можно разредить: раз в такт или раз в несколько
              тактов — таймер справа пересчитается. Если гриф не читается — включи табы гитары
              (лады 1–4) или пианино.
            </p>
          </div>
        </li>
      </ol>
    </section>

    <section class="define">
      <h2>Что ты видишь на карточке</h2>
      <p>
        Тетрахорд — четыре ступени в пределах чистой кварты. Лад в игре — две такие схемы, склеенные
        серым тоном связующим. Получается восемь нот, октава. Над карточкой стоит пара вроде S1 + S1.
      </p>
      <div class="lad">
        <ModeScheme :mode="ionian.mode" :motion="false" tab-instrument="off" />
      </div>
      <aside class="hint">
        <div class="hint__core">
          <div class="hint__sw" aria-hidden="true">
            <span class="hint__btn">
              <PhGuitar :size="18" weight="light" />
            </span>
            <span class="hint__cap">Табы</span>
          </div>
          <p>
            Схема на грифе не складывается? Включи табы в настройках: гитара в первой позиции или
            пианино. Под карточкой появится раскладка.
          </p>
        </div>
      </aside>
    </section>

    <section class="legend">
      <h2>Цвета</h2>
      <dl class="legend__row">
        <div>
          <dt><span class="swatch swatch--tone" /> Тон</dt>
          <dd>Зелёный · два полутона, на гитаре через лад</dd>
        </div>
        <div>
          <dt><span class="swatch swatch--semi" /> Полутон</dt>
          <dd>Жёлтый · соседний лад</dd>
        </div>
        <div>
          <dt><span class="swatch swatch--tc" /> Тон связующий</dt>
          <dd>Серый · стык двух схем, тоже тон</dd>
        </div>
      </dl>
    </section>

    <section id="positions" class="positions">
      <h2>Три схемы</h2>
      <p class="positions__lead">
        В тренировке только эти три: S1, S2, S3. Их пары через ТС и есть случайная выдача.
      </p>
      <ol class="positions__list">
        <li v-for="pos in positions" :key="pos.title" class="pos">
          <span class="pos__n">{{ schemeId(pos.pattern) }}</span>
          <div class="pos__body">
            <h3>{{ pos.title }}</h3>
            <IntervalScheme :pattern="pos.pattern" />
          </div>
        </li>
      </ol>
    </section>

    <section class="names">
      <h2>Когда у лада есть имя</h2>
      <p>
        Если пара схем совпадает с диатоническим ладом, под карточкой пишется название. Над карточкой
        всегда комбинация схем, например S1 + S1. Остальные комбинации безымянные — их всё равно
        играют.
      </p>
      <ul class="names__list">
        <li v-for="entry in PRACTICABLE_MODES" :key="entry.id">
          <strong>{{ namedModeTitle(entry) }}</strong>
          <span>
            {{ modeSchemeCombo(entry.mode) }}
            ·
            {{ schemeName(entry.mode.first) }}
            · ТС ·
            {{ schemeName(entry.mode.second) }}
          </span>
        </li>
      </ul>
      <p class="names__note">
        Лидийский и локрийский сюда не попадают: им нужна схема тон–тон–тон, её в выдаче нет.
      </p>
      <aside class="hint">
        <div class="hint__core">
          <div class="hint__sw" aria-hidden="true">
            <span class="hint__btn">
              <PhTextT :size="18" weight="light" />
            </span>
            <span class="hint__cap">Отображение лада</span>
          </div>
          <p>
            Названия уже знаешь и хочешь играть вслепую? Выключи эту кнопку в настройках игры.
            Под карточкой останется схема, без подписи.
          </p>
        </div>
      </aside>
    </section>

    <section class="mirror">
      <div class="bezel bezel--wide">
        <div class="bezel__core bezel__core--mirror">
          <h2>Вверх и вниз — одна схема</h2>
          <p>
            Карточка показывает интервалы вверх. Вниз — тот же ряд задом наперёд. Переключи, чтобы
            увидеть.
          </p>
          <div class="hero__toggle">
            <button type="button" class="dir" :aria-pressed="goingUp" @click="goingUp = true">
              Вверх
            </button>
            <button type="button" class="dir" :aria-pressed="!goingUp" @click="goingUp = false">
              Вниз
            </button>
          </div>
          <div class="mirror__live">
            <p class="mirror__kicker">Схема 1, {{ goingUp ? 'вверх' : 'вниз' }}</p>
            <IntervalScheme :pattern="demoPattern" />
          </div>
        </div>
      </div>
    </section>

    <section class="gear">
      <h2>Что крутить в игре</h2>
      <dl class="gear__list">
        <div>
          <dt>Ритм</dt>
          <dd>Темп и размер такта. Из них складывается пульс, по которому уезжает карточка.</dd>
        </div>
        <div>
          <dt>Упражнение</dt>
          <dd>
            Как часто менять лад. Табы: нет, гитара в первой позиции, пианино. Кнопка «Отображение
            лада» прячет название под карточкой.
          </dd>
        </div>
      </dl>
    </section>

    <section class="closer">
      <p class="closer__line">Дальше только гриф.</p>
      <RouterLink to="/tetrachord-training/resolve" class="cta">
        Играть
        <span class="cta__icon" aria-hidden="true">
          <PhArrowUpRight :size="16" weight="light" />
        </span>
      </RouterLink>
    </section>
  </main>
</template>

<style scoped>
.home {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 1rem 5rem;
}

.hero {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2.5rem;
  min-height: calc(100dvh - 4.5rem);
  padding-top: 2.5rem;
  padding-bottom: 3rem;
  align-items: center;
}

@media (min-width: 768px) {
  .hero {
    grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
    gap: 3.5rem;
    padding-top: 3rem;
  }
}

.kicker {
  margin: 0 0 0.75rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

.hero__title {
  margin: 0 0 0.85rem;
  font-size: clamp(2.1rem, 5.4vw, 3.7rem);
  font-weight: 600;
  letter-spacing: -0.045em;
  line-height: 1.08;
  text-wrap: balance;
}

.hero__lead {
  margin: 0 0 1.75rem;
  max-width: 38ch;
  color: var(--muted);
  font-size: 1.05rem;
  line-height: 1.55;
  text-wrap: pretty;
}

.cta {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.35rem 0.35rem 0.35rem 1.25rem;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 1rem;
  font-weight: 600;
  text-decoration: none;
  transition:
    transform 420ms var(--ease),
    filter 420ms var(--ease);
}

.cta:hover {
  filter: brightness(1.06);
}

.cta:hover .cta__icon {
  transform: translate(2px, -1px) scale(1.05);
}

.cta:active {
  transform: scale(0.98);
}

.cta:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.cta__icon {
  display: grid;
  place-items: center;
  width: 2.15rem;
  height: 2.15rem;
  border-radius: 50%;
  background: rgb(26 29 20 / 12%);
  transition: transform 420ms var(--ease);
}

.bezel {
  padding: 0.4rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-shell);
  background: color-mix(in srgb, var(--bg-inset) 70%, transparent);
}

.bezel__core {
  padding: 1.5rem 1.35rem 1.4rem;
  border-radius: var(--radius-core);
  background: var(--bg-raised);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 12%);
}

.bezel__core--preview {
  padding: 2.15rem 0.55rem 2.4rem;
}

.preview {
  display: grid;
  grid-template-columns: 1fr 1px 1fr;
  align-items: center;
  gap: 0.15rem;
}

.preview :deep(.mode) {
  width: 100%;
}

.preview__split {
  align-self: stretch;
  margin: 12% 0;
  background: color-mix(in srgb, var(--ink) 28%, transparent);
}

.session,
.define,
.positions,
.legend,
.names,
.gear {
  padding: 4.5rem 0 1rem;
}

@media (min-width: 768px) {
  .session,
  .define,
  .positions,
  .legend,
  .names,
  .mirror,
  .gear {
    padding-top: 6.5rem;
  }
}

.session h2,
.define h2,
.positions h2,
.legend h2,
.mirror h2,
.names h2,
.gear h2 {
  margin: 0 0 0.9rem;
  font-size: clamp(1.7rem, 3vw, 2.35rem);
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1.15;
  text-wrap: balance;
}

.define p,
.positions__lead,
.mirror p,
.names p,
.names__note {
  margin: 0;
  max-width: 62ch;
  color: var(--muted);
  font-size: 1.05rem;
  line-height: 1.65;
  text-wrap: pretty;
}

.steps {
  display: grid;
  gap: 0;
  margin: 1.75rem 0 0;
  padding: 0;
  list-style: none;
  max-width: 46rem;
}

.steps li {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1rem;
  padding: 1.15rem 0;
  border-top: 1px solid var(--line);
}

.steps li:last-child {
  border-bottom: 1px solid var(--line);
}

.steps h3 {
  margin: 0 0 0.35rem;
  font-size: 1.05rem;
  font-weight: 600;
}

.steps p {
  margin: 0;
  color: var(--muted);
  font-size: 1rem;
  line-height: 1.6;
  text-wrap: pretty;
}

.steps__n {
  display: grid;
  place-items: center;
  width: 2.1rem;
  height: 2.1rem;
  margin-top: 0.05rem;
  border-radius: 0.65rem;
  background: var(--bg-raised);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 0.88rem;
}

.lad {
  display: flex;
  justify-content: flex-start;
  margin-top: 2rem;
  padding-top: 1.8rem;
  padding-bottom: 2.4rem;
  max-width: 32rem;
}

.lad :deep(.mode) {
  width: 100%;
}

.legend__row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
  margin: 1.5rem 0 0;
}

@media (min-width: 768px) {
  .legend__row {
    grid-template-columns: auto auto auto;
    justify-content: start;
    gap: 3rem;
  }
}

.legend__row dt {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-weight: 600;
}

.legend__row dd {
  margin: 0.25rem 0 0 1.7rem;
  color: var(--muted);
  max-width: 22ch;
}

.swatch {
  display: inline-block;
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 50%;
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 28%);
}

.swatch--tone {
  background: var(--tone);
}

.swatch--semi {
  background: var(--semitone);
}

.swatch--tc {
  background: var(--tc);
}

.positions__lead {
  margin-bottom: 2.25rem;
}

.positions__list {
  display: grid;
  gap: 0.85rem;
  margin: 0;
  padding: 0;
  list-style: none;
  max-width: 34rem;
}

.pos {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1rem;
  align-items: center;
  padding: 1.1rem 1rem;
  border-radius: var(--radius-core);
}

.pos:nth-child(1) {
  background: color-mix(in srgb, var(--tone) 16%, var(--bg-raised));
}

.pos:nth-child(2) {
  background: var(--bg-raised);
}

.pos:nth-child(3) {
  background: color-mix(in srgb, var(--semitone) 16%, var(--bg-raised));
}

.pos__n {
  display: grid;
  place-items: center;
  min-width: 2.6rem;
  height: 2.4rem;
  padding: 0 0.4rem;
  border-radius: 0.7rem;
  background: var(--bg-inset);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.pos h3 {
  margin: 0 0 0.55rem;
  font-size: 1.05rem;
  font-weight: 600;
}

.names__list {
  display: grid;
  gap: 0;
  margin: 1.75rem 0 1.25rem;
  padding: 0;
  list-style: none;
  max-width: 42rem;
}

.names__list li {
  display: grid;
  gap: 0.2rem;
  padding: 0.95rem 0;
  border-top: 1px solid var(--line);
}

.names__list li:last-child {
  border-bottom: 1px solid var(--line);
}

.names__list strong {
  font-weight: 600;
}

.names__list span {
  color: var(--muted);
  font-size: 0.95rem;
}

.names__note {
  font-size: 0.95rem;
}

.hint {
  margin-top: 1.75rem;
  max-width: 42rem;
  padding: 0.4rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-shell);
  background: color-mix(in srgb, var(--bg-inset) 70%, transparent);
}

.lad + .hint {
  margin-top: 0.35rem;
}

.hint__core {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1.15rem 1.35rem;
  align-items: center;
  padding: 1.05rem 1.2rem 1.15rem 1rem;
  border-radius: var(--radius-core);
  background: var(--bg-raised);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 12%);
}

.hint__sw {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.28rem;
  width: 6.6rem;
}

.hint__btn {
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-ink);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 28%);
}

.hint__cap {
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  text-align: center;
  line-height: 1.2;
}

.hint p {
  margin: 0;
  max-width: 36ch;
  color: var(--ink);
  font-size: 1.02rem;
  line-height: 1.55;
  text-wrap: pretty;
}

@media (max-width: 767px) {
  .hint__core {
    grid-template-columns: 1fr;
    justify-items: start;
    padding: 1rem 1rem 1.1rem;
  }
}

.bezel--wide .bezel__core--mirror {
  padding: 2rem 1.5rem 2.2rem;
}

@media (min-width: 768px) {
  .bezel--wide .bezel__core--mirror {
    padding: 2.75rem 2.4rem 3rem;
  }
}

.hero__toggle {
  display: flex;
  gap: 0.5rem;
  margin-top: 1.4rem;
}

.dir {
  padding: 0.4rem 0.85rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition:
    background 420ms var(--ease),
    color 420ms var(--ease),
    transform 280ms var(--ease);
}

.dir:hover {
  color: var(--ink);
}

.dir:active {
  transform: scale(0.98);
}

.dir[aria-pressed='true'] {
  background: var(--ink);
  border-color: transparent;
  color: var(--bg);
}

.dir:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.mirror__live {
  margin-top: 1.6rem;
}

.mirror__kicker {
  margin: 0 0 0.85rem;
  color: var(--muted);
  font-size: 0.9rem;
}

.gear__list {
  display: grid;
  gap: 0;
  margin: 1.75rem 0 0;
  padding: 0;
  max-width: 46rem;
}

.gear__list > div {
  padding: 1.1rem 0;
  border-top: 1px solid var(--line);
}

.gear__list > div:last-child {
  border-bottom: 1px solid var(--line);
}

.gear__list dt {
  margin: 0 0 0.3rem;
  font-weight: 600;
}

.gear__list dd {
  margin: 0;
  color: var(--muted);
  line-height: 1.6;
  text-wrap: pretty;
}

.closer {
  padding: 5rem 0 1rem;
}

.closer__line {
  margin: 0 0 1.25rem;
  font-size: clamp(1.7rem, 3vw, 2.35rem);
  font-weight: 600;
  letter-spacing: -0.035em;
}

@media (prefers-reduced-motion: no-preference) {
  .hero__copy,
  .hero__stage,
  .session,
  .define,
  .legend,
  .positions,
  .names,
  .mirror,
  .gear,
  .closer {
    animation: rise 900ms var(--ease) both;
    animation-timeline: view();
    animation-range: entry 0% entry 35%;
  }

  .hero__copy,
  .hero__stage {
    animation-timeline: auto;
  }

  .hero__stage {
    animation-delay: 90ms;
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(1.4rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 767px) {
  .preview {
    gap: 0;
  }

  .preview :deep(.mode__caption) {
    font-size: 0.62rem;
  }
}
</style>
