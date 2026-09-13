<script setup lang="ts">
import { PhArrowUpRight, PhGuitar, PhWaveform } from '@phosphor-icons/vue'
</script>

<template>
  <main id="main" class="trainings">
    <section class="head">
      <p class="kicker">Тренировки</p>
      <h1 class="head__title">Слух и руки, по одной тренировке за раз</h1>
      <p class="head__lead">
        Каждая тренировка — своя страница: сначала описание, потом сам прогон под пульс.
      </p>
    </section>

    <ul class="list">
      <li>
        <RouterLink to="/tetrachord-training/issue" class="card">
          <span class="card__mark" aria-hidden="true">
            <PhGuitar :size="20" weight="light" />
          </span>
          <span class="card__body">
            <span class="card__title">Тетрахорды</span>
            <span class="card__text">
              Две схемы и связующий тон складываются в лад. Карточка сама уезжает — играешь дальше.
            </span>
          </span>
          <span class="card__icon" aria-hidden="true">
            <PhArrowUpRight :size="16" weight="light" />
          </span>
        </RouterLink>
      </li>
      <li>
        <RouterLink to="/lab" class="card">
          <span class="card__mark" aria-hidden="true">
            <PhWaveform :size="20" weight="light" />
          </span>
          <span class="card__body">
            <span class="card__title">Лаборатория</span>
            <span class="card__text">
              Живой разбор звука с микрофона: высота, громкость, спектр, ноты. Стенд движка.
            </span>
          </span>
          <span class="card__icon" aria-hidden="true">
            <PhArrowUpRight :size="16" weight="light" />
          </span>
        </RouterLink>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.trainings {
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
  max-width: 46ch;
  color: var(--muted);
  font-size: 1.05rem;
  line-height: 1.55;
  text-wrap: pretty;
}

.list {
  display: grid;
  gap: 0.85rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 1.15rem;
  align-items: center;
  padding: 1.35rem 1.4rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-core);
  background: var(--bg-raised);
  box-shadow: inset 0 1px 1px rgb(255 255 255 / 12%);
  color: inherit;
  text-decoration: none;
  transition:
    transform 420ms var(--ease),
    border-color 420ms var(--ease);
}

.card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
}

.card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.card__mark {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.card__body {
  display: grid;
  gap: 0.3rem;
  min-width: 0;
}

.card__title {
  font-size: 1.1rem;
  font-weight: 600;
}

.card__text {
  color: var(--muted);
  line-height: 1.55;
  text-wrap: pretty;
}

.card__icon {
  display: grid;
  place-items: center;
  width: 2.15rem;
  height: 2.15rem;
  border-radius: 50%;
  background: var(--bg-inset);
  color: var(--muted);
  transition:
    transform 420ms var(--ease),
    color 420ms var(--ease);
}

.card:hover .card__icon {
  transform: translate(2px, -1px);
  color: var(--ink);
}

@media (max-width: 600px) {
  .card {
    grid-template-columns: auto 1fr;
    gap: 0.9rem;
  }

  .card__icon {
    display: none;
  }
}
</style>
