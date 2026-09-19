<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhCamera, PhSignOut, PhTrash, PhUserCircle } from '@phosphor-icons/vue'
import SegmentedChoice from '@/components/builder/SegmentedChoice.vue'
import { useAuth } from '@/composables/useAuth'
import { useProfile } from '@/composables/useProfile'
import {
  AVATAR_TYPES,
  BIO_MAX,
  ROLE_DEFAULT,
  ROLE_OPTIONS,
  type UserRole,
} from '@/training/profile'

const { user, signOut } = useAuth()
const { profile, avatarUrl, loadError, save, setAvatar, removeAvatar } = useProfile()

const role = ref<UserRole>(ROLE_DEFAULT)
const bio = ref('')

// The form starts from the profile once it is read; a save replaces the profile with what the form
// holds, which must not overwrite what is typed meanwhile.
let filled = false
watch(
  profile,
  (value) => {
    if (value === null) {
      filled = false
      return
    }
    if (filled) return
    filled = true
    role.value = value.role
    bio.value = value.bio
  },
  { immediate: true },
)

const dirty = computed(
  () =>
    profile.value !== null &&
    (role.value !== profile.value.role || bio.value.trim() !== profile.value.bio),
)

const saving = ref(false)
/** How the last save went: a message, or 'Сохранено'. */
const saveState = ref('')
const saveFailed = ref(false)

watch([role, bio], () => (saveState.value = ''))

async function saveProfile(): Promise<void> {
  if (saving.value || !dirty.value) return
  saving.value = true
  saveState.value = ''
  const message = await save(role.value, bio.value)
  saving.value = false
  saveFailed.value = message !== null
  saveState.value = message ?? 'Сохранено'
  if (message === null) bio.value = bio.value.trim()
}

const photoBusy = ref(false)
const photoError = ref('')

async function pickPhoto(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Picking the same file again has to fire `change` again.
  input.value = ''
  if (!file || photoBusy.value) return
  photoBusy.value = true
  photoError.value = (await setAvatar(file)) ?? ''
  photoBusy.value = false
}

async function dropPhoto(): Promise<void> {
  if (photoBusy.value) return
  photoBusy.value = true
  photoError.value = (await removeAvatar()) ?? ''
  photoBusy.value = false
}
</script>

<template>
  <main id="main" class="page profile">
    <section class="panel" aria-labelledby="profile-title">
      <h2 id="profile-title" class="panel__title">Профиль</h2>

      <p v-if="loadError" class="note note--error" role="alert">{{ loadError }}</p>
      <p v-else-if="!profile" class="note" role="status">Загружаю…</p>

      <template v-if="profile">
        <div class="photo">
          <span class="avatar">
            <img v-if="avatarUrl" :src="avatarUrl" alt="Ваше фото" class="avatar__img" />
            <PhUserCircle v-else :size="56" weight="light" aria-hidden="true" />
          </span>
          <div class="photo__actions">
            <label class="btn pick" :aria-disabled="photoBusy || undefined">
              <PhCamera :size="16" weight="light" aria-hidden="true" />
              {{ avatarUrl ? 'Заменить фото' : 'Загрузить фото' }}
              <input
                class="pick__input"
                type="file"
                :accept="AVATAR_TYPES.join(',')"
                :disabled="photoBusy"
                @change="pickPhoto"
              />
            </label>
            <button
              v-if="avatarUrl"
              type="button"
              class="btn btn--quiet"
              :disabled="photoBusy"
              @click="dropPhoto"
            >
              <PhTrash :size="14" weight="light" aria-hidden="true" />
              Убрать
            </button>
          </div>
        </div>
        <p v-if="photoError" class="note note--error" role="alert">{{ photoError }}</p>

        <p class="email">{{ user?.email }}</p>

        <div class="field">
          <div class="field__head">
            <span class="ctrl-title">Я</span>
          </div>
          <SegmentedChoice
            v-model="role"
            :options="ROLE_OPTIONS"
            label="Кто вы"
            :disabled="saving"
          />
        </div>

        <label class="field">
          <span class="field__head">
            <span class="ctrl-title">О себе</span>
            <span class="field__count">{{ bio.length }} / {{ BIO_MAX }}</span>
          </span>
          <textarea
            v-model="bio"
            class="field__input field__input--area"
            rows="5"
            :maxlength="BIO_MAX"
            placeholder="Чему учитесь или чему учите, на чём играете, что хотите от занятий."
          />
        </label>

        <div class="actions">
          <button
            type="button"
            class="btn btn--primary"
            :disabled="saving || !dirty"
            @click="saveProfile"
          >
            Сохранить
          </button>
          <span
            class="actions__state"
            :class="{ 'actions__state--error': saveFailed && saveState !== 'Сохранено' }"
            aria-live="polite"
          >
            {{ saveState }}
          </span>
          <button type="button" class="btn btn--quiet actions__out" @click="signOut">
            <PhSignOut :size="14" weight="light" aria-hidden="true" />
            Выйти
          </button>
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
.profile {
  max-width: 34rem;
  /* Clears the sticky nav pill; the profile is the whole page. */
  padding-top: 3.5rem;
}

.photo {
  display: flex;
  align-items: center;
  gap: 1.1rem;
}

.avatar {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 5.5rem;
  height: 5.5rem;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--bg-inset);
  color: var(--muted);
}

.avatar__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.photo__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* The file input sits in its label, out of sight; the label is the button. */
.pick {
  position: relative;
  overflow: hidden;
}

.pick[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.4;
}

.pick__input {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  cursor: pointer;
}

.pick:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.email {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 0.9rem;
}

.actions__state {
  color: var(--muted);
  font-size: 0.85rem;
}

.actions__state--error {
  color: var(--ink);
}

.actions__out {
  margin-left: auto;
}

.note {
  margin: 0;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--line);
  border-radius: 0.8rem;
  font-size: 0.88rem;
  line-height: 1.45;
}

.note--error {
  border-color: var(--tonic);
  background: color-mix(in srgb, var(--tonic) 22%, var(--bg-inset));
}
</style>
