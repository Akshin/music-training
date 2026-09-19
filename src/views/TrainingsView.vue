<script setup lang="ts">
import {
  PhArrowUpRight,
  PhGuitar,
  PhPencilSimpleLine,
  PhSmiley,
  PhWaveform,
} from '@phosphor-icons/vue'
</script>

<template>
  <main id="main" class="page">
    <section class="page-head">
      <p class="kicker">Тренировки</p>
      <h1 class="page-title">Слух и руки, по одной тренировке за раз</h1>
      <p class="page-lead">
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
        <RouterLink to="/mouth-opening/issue" class="card">
          <span class="card__mark" aria-hidden="true">
            <PhSmiley :size="20" weight="light" />
          </span>
          <span class="card__body">
            <span class="card__title">Открываем рот</span>
            <span class="card__text">Учимся открывать рот.</span>
          </span>
          <span class="card__icon" aria-hidden="true">
            <PhArrowUpRight :size="16" weight="light" />
          </span>
        </RouterLink>
      </li>
      <li>
        <RouterLink to="/builder" class="card">
          <span class="card__mark" aria-hidden="true">
            <PhPencilSimpleLine :size="20" weight="light" />
          </span>
          <span class="card__body">
            <span class="card__title">Конструктор</span>
            <span class="card__text">
              Собери свою тренировку: темп, громкость, смык и ноты по тактам.
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
              Песочница: компоненты интерфейса на живом звуке с микрофона.
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
