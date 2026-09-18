<script setup lang="ts">
import { PhArrowUpRight } from '@phosphor-icons/vue'
</script>

<template>
  <main id="main" class="issue">
    <section class="head">
      <p class="kicker">Открываем рот</p>
      <h1 class="head__title">Учимся открывать рот</h1>
    </section>

    <RouterLink to="/mouth-opening/resolve" class="start">
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
  margin: 0;
  font-size: clamp(2rem, 4.6vw, 3.2rem);
  font-weight: 600;
  letter-spacing: -0.045em;
  line-height: 1.1;
  text-wrap: balance;
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
