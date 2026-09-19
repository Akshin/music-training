<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { PhHouse, PhSignOut, PhUserCircle } from '@phosphor-icons/vue'
import { useAuth } from '@/composables/useAuth'
import { useProfile } from '@/composables/useProfile'

const route = useRoute()
const { user, ready, available, signOut } = useAuth()
const { avatarUrl } = useProfile()
const onHome = computed(() => route.path === '/')
const links = computed(() => route.meta.nav ?? [])
</script>

<template>
  <header class="nav-wrap">
    <nav class="nav" aria-label="Основное">
      <RouterLink to="/" class="nav__brand" :aria-current="onHome ? 'page' : undefined">
        <PhHouse class="nav__brand-icon" :size="18" weight="light" aria-hidden="true" />
        <span class="nav__brand-label">Тренировки</span>
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
      <template v-if="available && ready">
        <!-- Every other page needs an account, so only the home page has a visitor to invite. -->
        <RouterLink v-if="!user && onHome" to="/auth" class="nav__link nav__account">
          <PhUserCircle :size="18" weight="light" aria-hidden="true" />
          <span class="nav__account-label">Войти</span>
        </RouterLink>
        <div v-else-if="user" class="nav__user">
          <RouterLink
            to="/profile"
            class="nav__link nav__account"
            :aria-current="route.path === '/profile' ? 'page' : undefined"
          >
            <img v-if="avatarUrl" :src="avatarUrl" alt="" class="nav__avatar" />
            <PhUserCircle v-else :size="18" weight="light" aria-hidden="true" />
            <span class="nav__account-label nav__email">{{ user.email ?? 'Аккаунт' }}</span>
          </RouterLink>
          <button type="button" class="nav__out" aria-label="Выйти" @click="signOut">
            <PhSignOut :size="18" weight="light" aria-hidden="true" />
          </button>
        </div>
      </template>
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
.nav__brand:focus-visible,
.nav__out:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.nav__account {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.nav__avatar {
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 50%;
  object-fit: cover;
}

.nav__user {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.nav__email {
  max-width: 11rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav__out {
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: color 420ms var(--ease);
}

.nav__out:hover {
  color: var(--ink);
}

.nav__brand-icon {
  display: none;
}

/* The pill is tight on a phone: the home and account links show as icons, the words stay for screen readers. */
@media (max-width: 600px) {
  .nav {
    gap: 1rem;
  }

  .nav__brand-icon {
    display: block;
  }

  /* Signing out stays one tap away on the profile page. */
  .nav__out {
    display: none;
  }

  .nav__brand-label,
  .nav__account-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
