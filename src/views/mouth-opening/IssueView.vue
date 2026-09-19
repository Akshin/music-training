<script setup lang="ts">
import { PhArrowUpRight } from '@phosphor-icons/vue'
</script>

<template>
  <main id="main" class="page">
    <section class="page-head">
      <p class="kicker">Открываем рот</p>
      <h1 class="page-title">Учимся открывать рот</h1>
    </section>

    <RouterLink to="/mouth-opening/resolve" class="start">
      Начать тренировку
      <PhArrowUpRight :size="16" weight="light" aria-hidden="true" />
    </RouterLink>
  </main>
</template>

<style scoped>
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
