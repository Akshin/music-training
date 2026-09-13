<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const onHome = computed(() => route.path === '/')
const links = computed(() => route.meta.nav ?? [])
</script>

<template>
  <header class="nav-wrap">
    <nav class="nav" aria-label="Основное">
      <RouterLink to="/" class="nav__brand" :aria-current="onHome ? 'page' : undefined">
        Тренировки
      </RouterLink>
      <RouterLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="nav__link"
        :aria-current="route.path === link.to ? 'page' : undefined"
      >
        {{ link.label }}
      </RouterLink>
    </nav>
  </header>
</template>

<style scoped>
.nav-wrap {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  justify-content: center;
  padding: 0.85rem 1rem 0;
  pointer-events: none;
}

.nav {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 1.35rem;
  height: 3.5rem;
  max-height: 80px;
  padding: 0 1.2rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--bg-raised) 78%, transparent);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 10%),
    0 10px 32px var(--shadow);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
}

@media (prefers-reduced-transparency: reduce) {
  .nav {
    background: var(--bg-raised);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

.nav__brand {
  font-size: 0.95rem;
  font-weight: 600;
  letter-spacing: -0.03em;
  text-decoration: none;
}

.nav__link {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--muted);
  text-decoration: none;
  transition: color 420ms var(--ease);
}

.nav__link:hover,
.nav__link[aria-current='page'] {
  color: var(--ink);
}

.nav__link:focus-visible,
.nav__brand:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
</style>
