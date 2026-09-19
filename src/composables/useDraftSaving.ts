import { computed, ref, watch, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { copyText, trainingLink, useCustomTrainings } from '@/composables/useCustomTrainings'
import type { TrainingDraft } from '@/training/builder'

/**
 * Saving the builder's training and sharing it. A new training lives as a draft in storage until
 * its first save, which gives it an id and puts it in the address (`?id=`); after that saves go
 * over it and the state tells whether there are unsaved changes. A link is made of the training as
 * it is and is dropped once the training changes.
 */
export function useDraftSaving(
  draft: Readonly<Ref<TrainingDraft>>,
  hasElements: Readonly<Ref<boolean>>,
  savedId: Ref<string | undefined>,
  initial: TrainingDraft,
) {
  const router = useRouter()
  const store = useCustomTrainings()

  /** The draft as last saved, to tell unsaved changes; null for a training never saved. */
  const snapshot = ref(savedId.value === undefined ? null : JSON.stringify(initial))
  const dirty = computed(() => snapshot.value !== JSON.stringify(draft.value))
  /** A save is on its way; a second one now would add a second copy of a new training. */
  const saving = ref(false)
  const canSave = computed(
    () => !saving.value && hasElements.value && (snapshot.value === null || dirty.value),
  )
  /** Why the last save failed, until the training changes or a save goes through. */
  const failure = ref('')
  const state = computed(() => {
    if (failure.value) return failure.value
    if (snapshot.value === null) return hasElements.value ? 'Не сохранена' : ''
    return dirty.value ? 'Есть несохранённые изменения' : 'Сохранена'
  })

  watch(draft, (value) => {
    failure.value = ''
    if (savedId.value === undefined) store.storeNewDraft(value)
  })

  async function save(): Promise<void> {
    if (saving.value) return
    const value = draft.value
    failure.value = ''
    saving.value = true
    let id: string
    try {
      id = await store.save(
        { ...value, title: value.title.trim(), description: value.description.trim() },
        savedId.value,
      )
    } catch (error) {
      failure.value = error instanceof Error ? error.message : 'Не удалось сохранить'
      return
    } finally {
      saving.value = false
    }
    snapshot.value = JSON.stringify(value)
    if (savedId.value !== undefined) return
    savedId.value = id
    store.storeNewDraft(null)
    await router.replace({ query: { id } })
  }

  const link = ref('')
  const linkCopied = ref(false)

  async function share(): Promise<void> {
    link.value = await trainingLink(router, draft.value)
    linkCopied.value = await copyText(link.value)
  }

  watch(draft, () => {
    link.value = ''
    linkCopied.value = false
  })

  return { state, canSave, save, link, linkCopied, share }
}
