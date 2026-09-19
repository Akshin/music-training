<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhArrowLeft, PhGoogleLogo, PhSignOut } from '@phosphor-icons/vue'
import SegmentedChoice, { type SegmentedOption } from '@/components/builder/SegmentedChoice.vue'
import PasswordField from '@/components/PasswordField.vue'
import { PASSWORD_MIN, useAuth } from '@/composables/useAuth'
import { ROLE_DEFAULT, ROLE_OPTIONS, type UserRole } from '@/training/profile'

type Mode = 'signin' | 'signup'

const MODES: SegmentedOption<Mode>[] = [
  { value: 'signin', label: 'Вход' },
  { value: 'signup', label: 'Регистрация' },
]

/** Where to go after Google: the page is left for it, so the target waits in the session. */
const NEXT_KEY = 'music-training:auth-next'

const route = useRoute()
const router = useRouter()
const {
  user,
  available,
  recovering,
  signIn,
  signUp,
  signInWithGoogle,
  requestPasswordReset,
  setPassword,
  signOut,
} = useAuth()

const mode = ref<Mode>(route.query.mode === 'signup' ? 'signup' : 'signin')
/** The "forgot the password" form is up instead of the sign-in one. */
const resetting = ref(false)
const email = ref('')
const password = ref('')
const role = ref<UserRole>(ROLE_DEFAULT)
const busy = ref(false)
const error = ref(route.query.error ? 'Не удалось войти через Google' : '')
const notice = ref('')

/** Only a path inside the app; anything else goes home. */
function nextPath(): string {
  const value = route.query.next
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

function stashNext(path: string | null): void {
  try {
    if (path === null) sessionStorage.removeItem(NEXT_KEY)
    else sessionStorage.setItem(NEXT_KEY, path)
  } catch {
    // Storage off: after Google the user lands here, signed in, and goes on from the account card.
  }
}

function takeNext(): string | null {
  try {
    const path = sessionStorage.getItem(NEXT_KEY)
    sessionStorage.removeItem(NEXT_KEY)
    return path?.startsWith('/') && !path.startsWith('//') ? path : null
  } catch {
    return null
  }
}

/** This page's full URL: where Google and the letters' links bring the user back. */
function returnUrl(): string {
  return new URL(router.resolve('/auth').href, location.origin).href
}

// Back from Google the session arrives a moment after the page: go on to where the user was.
watch(
  user,
  (current) => {
    const path = current ? takeNext() : null
    if (path !== null) void router.replace(path)
  },
  { immediate: true },
)

function clearMessages(): void {
  error.value = ''
  notice.value = ''
}

function setMode(next: Mode): void {
  mode.value = next
  clearMessages()
}

function startReset(): void {
  resetting.value = true
  clearMessages()
}

function stopReset(): void {
  resetting.value = false
  clearMessages()
}

async function submit(): Promise<void> {
  if (busy.value) return
  busy.value = true
  clearMessages()
  stashNext(null)
  try {
    const address = email.value.trim()
    if (resetting.value) {
      const result = await requestPasswordReset(address, returnUrl())
      if (result.error) error.value = result.error
      else
        notice.value =
          'Если эта почта зарегистрирована, мы отправили на неё ссылку для нового пароля.'
    } else if (mode.value === 'signin') {
      const result = await signIn(address, password.value)
      if (result.error) error.value = result.error
      else await router.replace(nextPath())
    } else {
      const result = await signUp(address, password.value, returnUrl(), role.value)
      if (result.error) error.value = result.error
      else if (result.confirm) {
        notice.value = `Письмо отправлено на ${address}. Откройте ссылку в нём и войдите.`
        password.value = ''
      } else await router.replace(nextPath())
    }
  } finally {
    busy.value = false
  }
}

/** The form after a reset letter: the user is in with the letter's session and picks a new password. */
async function savePassword(): Promise<void> {
  if (busy.value) return
  busy.value = true
  clearMessages()
  try {
    const result = await setPassword(password.value)
    if (result.error) error.value = result.error
    else {
      password.value = ''
      await router.replace(nextPath())
    }
  } finally {
    busy.value = false
  }
}

async function google(): Promise<void> {
  if (busy.value) return
  busy.value = true
  clearMessages()
  stashNext(nextPath())
  const result = await signInWithGoogle(returnUrl())
  // On success the browser is already on its way to Google.
  if (result.error) {
    error.value = result.error
    busy.value = false
  }
}
</script>

<template>
  <main id="main" class="page auth">
    <section v-if="user && recovering" class="panel" aria-labelledby="recover-title">
      <h2 id="recover-title" class="panel__title">Новый пароль</h2>
      <p class="auth__hint">Придумайте пароль, с которым будете входить.</p>
      <form class="auth__form" @submit.prevent="savePassword">
        <PasswordField
          id="auth-new-password"
          v-model="password"
          autocomplete="new-password"
          :minlength="PASSWORD_MIN"
          :hint="`от ${PASSWORD_MIN} символов`"
        />
        <p v-if="error" class="auth__note auth__note--error" role="alert">{{ error }}</p>
        <button type="submit" class="btn btn--primary auth__wide" :disabled="busy">
          Сохранить пароль
        </button>
      </form>
    </section>

    <section v-else-if="user" class="panel" aria-labelledby="account-title">
      <h2 id="account-title" class="panel__title">{{ user.email ?? 'Аккаунт' }}</h2>
      <div class="auth__actions">
        <RouterLink to="/" class="btn btn--primary">К тренировкам</RouterLink>
        <RouterLink to="/profile" class="btn">Профиль</RouterLink>
        <button type="button" class="btn" @click="signOut">
          <PhSignOut :size="16" weight="light" aria-hidden="true" />
          Выйти
        </button>
      </div>
    </section>

    <section v-else-if="!available" class="panel">
      <p class="auth__note auth__note--error" role="alert">
        Вход недоступен: в этой сборке нет ключей Supabase.
      </p>
    </section>

    <section v-else class="panel" aria-label="Вход и регистрация">
      <template v-if="!resetting">
        <SegmentedChoice
          :model-value="mode"
          :options="MODES"
          label="Что сделать"
          :disabled="busy"
          @update:model-value="setMode"
        />

        <button type="button" class="btn auth__wide" :disabled="busy" @click="google">
          <PhGoogleLogo :size="18" weight="bold" aria-hidden="true" />
          Продолжить с Google
        </button>

        <p class="auth__or" aria-hidden="true">или по почте</p>
      </template>
      <template v-else>
        <h2 class="panel__title">Восстановление пароля</h2>
        <p class="auth__hint">
          Укажите почту аккаунта: пришлём ссылку, по которой можно выбрать новый пароль.
        </p>
      </template>

      <form class="auth__form" @submit.prevent="submit">
        <div class="field">
          <div class="field__head">
            <label class="ctrl-title" for="auth-email">Почта</label>
          </div>
          <input
            id="auth-email"
            v-model="email"
            class="field__input"
            type="email"
            name="email"
            autocomplete="email"
            inputmode="email"
            placeholder="name@example.com"
            required
          />
        </div>

        <div v-if="mode === 'signup' && !resetting" class="field">
          <div class="field__head">
            <span class="ctrl-title">Вы</span>
          </div>
          <SegmentedChoice v-model="role" :options="ROLE_OPTIONS" label="Кто вы" :disabled="busy" />
        </div>

        <template v-if="!resetting">
          <PasswordField
            id="auth-password"
            v-model="password"
            :autocomplete="mode === 'signin' ? 'current-password' : 'new-password'"
            :minlength="mode === 'signup' ? PASSWORD_MIN : undefined"
            :hint="mode === 'signup' ? `от ${PASSWORD_MIN} символов` : undefined"
          />
          <button v-if="mode === 'signin'" type="button" class="auth__forgot" @click="startReset">
            Забыли пароль?
          </button>
        </template>

        <p v-if="error" class="auth__note auth__note--error" role="alert">{{ error }}</p>
        <p v-if="notice" class="auth__note auth__note--ok" role="status">{{ notice }}</p>

        <button type="submit" class="btn btn--primary auth__wide" :disabled="busy">
          {{ resetting ? 'Отправить ссылку' : mode === 'signin' ? 'Войти' : 'Создать аккаунт' }}
        </button>
        <button v-if="resetting" type="button" class="btn btn--quiet auth__back" @click="stopReset">
          <PhArrowLeft :size="14" weight="bold" aria-hidden="true" />
          Ко входу
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.auth {
  max-width: 30rem;
  /* Clears the sticky nav pill; the form is the whole page. */
  padding-top: 3.5rem;
}

.auth__form {
  display: grid;
  gap: 1rem;
}

.auth__wide {
  width: 100%;
  height: 2.6rem;
  justify-content: center;
}

.auth__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.auth__hint {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.45;
}

.auth__or {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0;
  color: var(--muted);
  font-size: 0.75rem;
}

.auth__or::before,
.auth__or::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}

.auth__forgot {
  justify-self: start;
  margin-top: -0.35rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  font-size: 0.8rem;
  text-decoration: underline;
  text-underline-offset: 0.2em;
  cursor: pointer;
  transition: color 280ms var(--ease);
}

.auth__forgot:hover {
  color: var(--ink);
}

.auth__forgot:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.auth__back {
  justify-self: center;
}

.auth__note {
  margin: 0;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--line);
  border-radius: 0.8rem;
  font-size: 0.88rem;
  line-height: 1.45;
}

.auth__note--error {
  border-color: var(--tonic);
  background: color-mix(in srgb, var(--tonic) 22%, var(--bg-inset));
}

.auth__note--ok {
  border-color: var(--tone);
  background: color-mix(in srgb, var(--tone) 18%, var(--bg-inset));
}
</style>
