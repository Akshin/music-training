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
  const canSave = computed(() => hasElements.value && (snapshot.value === null || dirty.value))
  const state = computed(() => {
    if (snapshot.value === null) return hasElements.value ? 'Не сохранена' : ''
    return dirty.value ? 'Есть несохранённые изменения' : 'Сохранена'
  })

  watch(draft, (value) => {
    if (savedId.value === undefined) store.storeNewDraft(value)
  })

  async function save(): Promise<void> {
    const value = draft.value
    const id = store.save(
      { ...value, title: value.title.trim(), description: value.description.trim() },
      savedId.value,
    )
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
