<script setup lang="ts">
import { PhArrowUpRight } from '@phosphor-icons/vue'
</script>

<template>
  <main id="main" class="issue">
    <section class="head">
      <p class="kicker">Нота на долю</p>
      <h1 class="head__title">Услышь ноту и спой её точно на долю</h1>
      <p class="head__lead">
        Упражнение идёт циклами по два такта. В первом звучит нота, во втором её нужно спеть с
        сильной доли и держать две доли.
      </p>
    </section>

    <ol class="steps">
      <li class="step">
        <h2 class="step__title">Задай темп и тональный центр</h2>
        <p class="step__text">
          Ноты берутся из мажорной гаммы тонального центра. Октава не важна — пой там, где удобно.
        </p>
      </li>
      <li class="step">
        <h2 class="step__title">Нажми Play и разреши микрофон</h2>
        <p class="step__text">
          Лучше в наушниках: тогда метроном и нота-подсказка не попадают в микрофон.
        </p>
      </li>
      <li class="step">
        <h2 class="step__title">Слушай, потом пой</h2>
        <p class="step__text">
          На графике справа видны ноты, которые придут. Подсвеченная — та, что поёшь: вступи на её
          начало и держи до конца.
        </p>
      </li>
      <li class="step">
        <h2 class="step__title">Смотри результат</h2>
        <p class="step__text">
          После каждой попытки — отклонение в центах и во времени. Зелёная точка — в ноту и вовремя,
          жёлтая — что-то одно, бордовая — мимо.
        </p>
      </li>
    </ol>

    <RouterLink to="/note-on-beat/resolve" class="start">
      Начать тренировку
      <PhArrowUpRight :size="16" weight="light" aria-hidden="true" />
    </RouterLink>
  </main>
</template>

<style scoped>
.issue {
  max-width: 56rem;
  margin: 0 auto;
  padding: 0 1rem 5rem;
}

.head {
  padding: 4rem 0 2.5rem;
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
  text-wrap: balance;
}

.head__lead {
  margin: 0;
  max-width: 52ch;
  color: var(--muted);
  font-size: 1.05rem;
  line-height: 1.55;
  text-wrap: pretty;
}

.steps {
  display: grid;
  gap: 0.85rem;
  margin: 0 0 2rem;
  padding: 0;
  list-style: none;
  counter-reset: step;
}

.step {
  position: relative;
  padding: 1.2rem 1.4rem 1.2rem 3.6rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-core);
  background: var(--bg-raised);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 12%);
  counter-increment: step;
}

.step::before {
  content: counter(step);
  position: absolute;
  top: 1.15rem;
  left: 1.2rem;
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
  font-size: 0.8rem;
  font-weight: 600;
}

.step__title {
  margin: 0 0 0.35rem;
  font-size: 1.05rem;
  font-weight: 600;
}

.step__text {
  margin: 0;
  color: var(--muted);
  line-height: 1.55;
  text-wrap: pretty;
}

.start {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.8rem 1.3rem;
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
</style>
