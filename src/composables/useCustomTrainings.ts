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

/**
 * Version of what is stored, written next to it as `{ version, data }`.
 *
 * - 0: the bare value, no envelope; bar elements as `midi` (null for a rest) and `breath`.
 * - 1: the envelope; bars hold `elements` tagged by `type`.
 *
 * `parseDraft` reads every version, so an older value is upgraded by reading it and writing it
 * back. A newer one, from a later build of the app, is read as best it can be.
 */
const STORAGE_VERSION = 1

interface Stored {
  readonly version: number
  readonly data: unknown
}

function read(key: string): Stored | null {
  try {
    const text = localStorage.getItem(key)
    if (text === null) return null
    const value: unknown = JSON.parse(text)
    const envelope = value as Partial<Stored> | null
    if (typeof envelope?.version === 'number' && 'data' in envelope) {
      return { version: envelope.version, data: envelope.data }
    }
    return { version: 0, data: value }
  } catch {
    return null
  }
}

function write(key: string, data: unknown): void {
  try {
    if (data === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, data }))
  } catch {
    // Storage off or full: nothing is kept past the page.
  }
}

function readList(): SavedTraining[] {
  const stored = read(LIST_KEY)
  if (stored === null || !Array.isArray(stored.data)) return []
  const list: SavedTraining[] = []
  for (const item of stored.data) {
    const record = item as Partial<Record<keyof SavedTraining, unknown>> | null
    const draft = parseDraft(record?.draft)
    if (typeof record?.id !== 'string' || draft === null) continue
    list.push({ id: record.id, savedAt: Number(record.savedAt) || 0, draft })
  }
  list.sort((a, b) => b.savedAt - a.savedAt)
  if (stored.version < STORAGE_VERSION) write(LIST_KEY, list)
  return list
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
    return parseDraft(read(DRAFT_KEY)?.data) ?? EMPTY_DRAFT
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
