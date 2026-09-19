import { ref } from 'vue'
import type { Router } from 'vue-router'
import { EMPTY_DRAFT, parseDraft, type TrainingDraft } from '@/training/builder'
import { encodeTraining } from '@/training/customTraining'

/** A training saved from the builder. */
export interface SavedTraining {
  readonly id: string
  /** Milliseconds since the epoch. */
  readonly savedAt: number
  readonly draft: TrainingDraft
}

const LIST_KEY = 'music-training:custom-trainings'
/** The unsaved new training in the builder, so a reload does not lose it. */
const DRAFT_KEY = 'music-training:builder-draft'

function read(key: string): unknown {
  try {
    const stored = localStorage.getItem(key)
    return stored === null ? null : JSON.parse(stored)
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage off or full: nothing is kept past the page.
  }
}

function readList(): SavedTraining[] {
  const stored = read(LIST_KEY)
  if (!Array.isArray(stored)) return []
  const list: SavedTraining[] = []
  for (const item of stored) {
    const record = item as Partial<Record<keyof SavedTraining, unknown>> | null
    const draft = parseDraft(record?.draft)
    if (typeof record?.id !== 'string' || draft === null) continue
    list.push({ id: record.id, savedAt: Number(record.savedAt) || 0, draft })
  }
  return list.sort((a, b) => b.savedAt - a.savedAt)
}

/** One list for every component, so a save in the builder shows in the list at once. */
const trainings = ref<SavedTraining[]>(readList())

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function useCustomTrainings() {
  function find(id: string): SavedTraining | undefined {
    return trainings.value.find((training) => training.id === id)
  }

  /** Saves the training, over the saved one with `id` or as a new one; returns its id. */
  function save(draft: TrainingDraft, id?: string): string {
    const saved: SavedTraining = { id: id ?? newId(), savedAt: Date.now(), draft }
    trainings.value = [saved, ...trainings.value.filter((training) => training.id !== saved.id)]
    write(LIST_KEY, trainings.value)
    return saved.id
  }

  function remove(id: string): void {
    trainings.value = trainings.value.filter((training) => training.id !== id)
    write(LIST_KEY, trainings.value)
  }

  function loadNewDraft(): TrainingDraft {
    return parseDraft(read(DRAFT_KEY)) ?? EMPTY_DRAFT
  }

  function storeNewDraft(draft: TrainingDraft | null): void {
    write(DRAFT_KEY, draft)
  }

  return { trainings, find, save, remove, loadNewDraft, storeNewDraft }
}

/** Full link to play the training: `{origin}{base}custom-training?d=…`. */
export async function trainingLink(router: Router, draft: TrainingDraft): Promise<string> {
  const d = await encodeTraining(draft)
  return new URL(router.resolve({ path: '/custom-training', query: { d } }).href, location.origin)
    .href
}

/** Copies text to the clipboard; false when the browser does not allow it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // No Clipboard API here (an insecure origin, an embedded view): the old selection copy.
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.append(field)
    field.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      field.remove()
    }
  }
}
