import { shallowRef } from 'vue'
import type { AuthError, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { UserRole } from '@/training/profile'

/** Shortest password the forms accept. Supabase itself stops at 6. */
export const PASSWORD_MIN = 8

/** What an auth call came to: a message to show, or null; `confirm` after a sign-up that waits for mail. */
export interface AuthResult {
  readonly error: string | null
  /** Signed up, but the address has to be confirmed from the letter before signing in. */
  readonly confirm?: boolean
}

/** The signed-in user; null when signed out, and until the stored session is read. */
const user = shallowRef<User | null>(null)
/** False until the stored session, or the return from Google, is read, so a signed-in user never sees "Войти" flash. */
const ready = shallowRef(supabase === null)
/** The user came from a password-reset letter and has to choose a new password before anything else. */
const recovering = shallowRef(false)

const client = supabase
/** Settles once the stored session, or the one that just came back from Google, is read. */
const sessionRead: Promise<void> = client
  ? new Promise((resolve) => {
      // The first event carries that session. The callback only sets refs: it must not call the
      // client, which would wait on itself.
      client.auth.onAuthStateChange((event, session) => {
        user.value = session?.user ?? null
        if (event === 'PASSWORD_RECOVERY') recovering.value = true
        if (event === 'SIGNED_OUT') recovering.value = false
        ready.value = true
        resolve()
      })
    })
  : Promise.resolve()

/** Longest the router waits for the session before treating the visitor as signed out. */
const READ_TIMEOUT_MS = 4000

const UNAVAILABLE = 'Вход недоступен: сборка без Supabase'
const ALREADY_REGISTERED = 'Эта почта уже зарегистрирована: войдите'

function describe(error: AuthError): string {
  if (error.name === 'AuthRetryableFetchError') return 'Нет связи с сервером'
  switch (error.code) {
    case 'invalid_credentials':
      return 'Неверная почта или пароль'
    case 'email_not_confirmed':
      return 'Почта не подтверждена: откройте ссылку из письма'
    case 'user_already_exists':
    case 'email_exists':
      return ALREADY_REGISTERED
    case 'weak_password':
      return 'Пароль слишком простой'
    case 'same_password':
      return 'Новый пароль совпадает со старым'
    case 'signup_disabled':
      return 'Регистрация выключена'
    case 'provider_disabled':
      return 'Вход через Google не включён'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Слишком много попыток, подождите немного'
    default:
      return 'Не получилось, попробуйте ещё раз'
  }
}

export function useAuth() {
  async function signIn(email: string, password: string): Promise<AuthResult> {
    if (!supabase) return { error: UNAVAILABLE }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error && describe(error) }
  }

  /**
   * `redirectTo` is where the confirmation link in the letter leads. The kind of user goes in the
   * metadata and only seeds the profile the database makes; it is not what decides anything.
   */
  async function signUp(
    email: string,
    password: string,
    redirectTo: string,
    role: UserRole,
  ): Promise<AuthResult> {
    if (!supabase) return { error: UNAVAILABLE }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo, data: { role } },
    })
    if (error) return { error: describe(error) }
    // With confirmation on, an address that is taken comes back as a user with no identities, not
    // as an error, so the form cannot be used to find out who is registered.
    if (data.user?.identities?.length === 0) return { error: ALREADY_REGISTERED }
    return { error: null, confirm: data.session === null }
  }

  /** Leaves for Google; the page is gone on success, and comes back to `redirectTo` signed in. */
  async function signInWithGoogle(redirectTo: string): Promise<AuthResult> {
    if (!supabase) return { error: UNAVAILABLE }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    return { error: error && describe(error) }
  }

  /**
   * Sends a letter with a link to choose a new password; `redirectTo` is where the link leads. The
   * same answer comes back for an address nobody registered, so the form does not tell them apart.
   */
  async function requestPasswordReset(email: string, redirectTo: string): Promise<AuthResult> {
    if (!supabase) return { error: UNAVAILABLE }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    return { error: error && describe(error) }
  }

  /** Sets the password of the signed-in user, the one from a reset letter included. */
  async function setPassword(password: string): Promise<AuthResult> {
    if (!supabase) return { error: UNAVAILABLE }
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return { error: describe(error) }
    recovering.value = false
    return { error: null }
  }

  async function signOut(): Promise<void> {
    await supabase?.auth.signOut()
  }

  /** Resolves when `user` can be trusted; a session that does not load in time counts as none. */
  function whenReady(): Promise<void> {
    return Promise.race([
      sessionRead,
      new Promise<void>((resolve) => setTimeout(resolve, READ_TIMEOUT_MS)),
    ])
  }

  return {
    user,
    ready,
    recovering,
    available: supabase !== null,
    whenReady,
    signIn,
    signUp,
    signInWithGoogle,
    requestPasswordReset,
    setPassword,
    signOut,
  }
}
