import { computed, shallowRef, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { squareAvatar } from '@/lib/avatar'
import { supabase } from '@/lib/supabase'
import {
  AVATAR_SOURCE_MAX,
  AVATAR_TYPES,
  BIO_MAX,
  ROLE_DEFAULT,
  type UserRole,
} from '@/training/profile'

/** The signed-in user's profile as the app holds it. */
export interface Profile {
  readonly role: UserRole
  readonly bio: string
  /** Path of the photo in the bucket, or null without one. */
  readonly avatarPath: string | null
}

const BUCKET = 'avatars'

const FAILED_LOAD = 'Не удалось загрузить профиль'
const FAILED_SAVE = 'Не удалось сохранить'
const FAILED_PHOTO = 'Не удалось загрузить фото'
const NOT_SIGNED_IN = 'Нужно войти'

const { user } = useAuth()

/** The profile of the signed-in user; null when signed out, and until it is read. */
const profile = shallowRef<Profile | null>(null)
/** Why the profile could not be read, or ''. */
const loadError = shallowRef('')

const avatarUrl = computed(() => {
  const path = profile.value?.avatarPath
  if (!supabase || !path) return null
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
})

async function load(id: string): Promise<void> {
  if (!supabase) return
  loadError.value = ''
  const { data, error } = await supabase
    .from('profiles')
    .select('role, bio, avatar_path')
    .eq('id', id)
    .maybeSingle()
  // Someone else may have signed in while this was on its way.
  if (user.value?.id !== id) return
  if (error) {
    loadError.value = FAILED_LOAD
    return
  }
  if (data) {
    profile.value = { role: data.role, bio: data.bio, avatarPath: data.avatar_path }
    return
  }
  // An account older than the sign-up trigger has no row yet: start it with the defaults.
  const created = await supabase.from('profiles').insert({ id, role: ROLE_DEFAULT })
  if (user.value?.id !== id) return
  if (created.error) loadError.value = FAILED_LOAD
  else profile.value = { role: ROLE_DEFAULT, bio: '', avatarPath: null }
}

watch(
  user,
  (current, before) => {
    if (!current) {
      profile.value = null
      loadError.value = ''
    } else if (current.id !== before?.id) {
      profile.value = null
      void load(current.id)
    }
  },
  { immediate: true },
)

export function useProfile() {
  /** Saves the kind of user and the description; returns a message to show, or null. */
  async function save(role: UserRole, bio: string): Promise<string | null> {
    const id = user.value?.id
    if (!supabase || !id) return NOT_SIGNED_IN
    const text = bio.trim().slice(0, BIO_MAX)
    const { error } = await supabase.from('profiles').update({ role, bio: text }).eq('id', id)
    if (error) return FAILED_SAVE
    if (profile.value) profile.value = { ...profile.value, role, bio: text }
    return null
  }

  /**
   * Sets the photo: the file is cropped to a square and shrunk here, uploaded under a fresh name in
   * the user's own folder, and only then the profile points at it and the old file goes.
   */
  async function setAvatar(file: File): Promise<string | null> {
    const id = user.value?.id
    if (!supabase || !id) return NOT_SIGNED_IN
    if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) {
      return 'Нужна картинка JPEG, PNG или WebP'
    }
    if (file.size > AVATAR_SOURCE_MAX) return 'Файл слишком большой'
    let photo: Blob
    try {
      photo = await squareAvatar(file)
    } catch {
      return 'Не удалось прочитать картинку'
    }
    const path = `${id}/${Date.now().toString(36)}.jpg`
    const uploaded = await supabase.storage
      .from(BUCKET)
      .upload(path, photo, { contentType: 'image/jpeg', cacheControl: '31536000' })
    if (uploaded.error) return FAILED_PHOTO
    const linked = await supabase.from('profiles').update({ avatar_path: path }).eq('id', id)
    if (linked.error) {
      await supabase.storage.from(BUCKET).remove([path])
      return FAILED_PHOTO
    }
    const old = profile.value?.avatarPath
    if (profile.value) profile.value = { ...profile.value, avatarPath: path }
    if (old) await supabase.storage.from(BUCKET).remove([old])
    return null
  }

  async function removeAvatar(): Promise<string | null> {
    const id = user.value?.id
    if (!supabase || !id) return NOT_SIGNED_IN
    const old = profile.value?.avatarPath
    if (!old) return null
    const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', id)
    if (error) return FAILED_SAVE
    if (profile.value) profile.value = { ...profile.value, avatarPath: null }
    await supabase.storage.from(BUCKET).remove([old])
    return null
  }

  return { profile, avatarUrl, loadError, save, setAvatar, removeAvatar }
}
