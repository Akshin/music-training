import { ref, watch } from 'vue'
import type { Router } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import type { Json } from '@/lib/database.types'
import { supabase } from '@/lib/supabase'
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
 * Version of what is stored, written next to it as `{ version, data }` in `localStorage` and as the
 * `version` column in `trainings`.
 *
 * - 0: the bare value, no envelope; bar elements as `midi` (null for a rest) and `breath`.
 * - 1: the envelope; bars hold `elements` tagged by `type`.
 *
 * `parseDraft` reads every version, so an older value is upgraded by reading it and writing it
 * back. A newer one, from a later build of the app, is read as best it can be.
 */
const STORAGE_VERSION = 1

const FAILED_LOAD = 'Не удалось загрузить тренировки'
const FAILED_MOVE = 'Не удалось перенести тренировки из этого браузера, попробуйте позже'
const FAILED_SAVE = 'Не удалось сохранить: нет связи или доступа'
const FAILED_REMOVE = 'Не удалось удалить'
const NOT_SIGNED_IN = 'Нужно войти'

/** Longest the router waits for the list before opening a page without it. */
const LOAD_TIMEOUT_MS = 4000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

/**
 * Where the list lives. With Supabase it is the signed-in user's rows in `trainings`: read once
 * after signing in, then kept in step with every save and removal, each of which waits for the
 * database. `localStorage` then holds only what an older build saved here before there were
 * accounts, and that moves into the first account that signs in. Without Supabase the list is
 * `localStorage`, as it always was.
 */
const { user } = useAuth()

/** One list for every component, so a save in the builder shows in the list at once. */
const trainings = ref<SavedTraining[]>(supabase ? [] : readList())
/** False while the signed-in user's list is on its way; without Supabase there is nothing to wait for. */
const loaded = ref(supabase === null)
/** Why the list could not be read whole, or ''. */
const loadError = ref('')

function newId(): string {
  return crypto.randomUUID()
}

function fromRow(row: { id: string; draft: Json; saved_at: string }): SavedTraining | null {
  const draft = parseDraft(row.draft)
  return draft === null ? null : { id: row.id, savedAt: Date.parse(row.saved_at) || 0, draft }
}

function toRow(userId: string, training: SavedTraining) {
  return {
    id: training.id,
    user_id: userId,
    draft: training.draft as unknown as Json,
    version: STORAGE_VERSION,
    saved_at: new Date(training.savedAt).toISOString(),
  }
}

/** Trainings an older build kept in this browser go into the account, once. */
async function moveLocal(userId: string): Promise<void> {
  const found = readList()
  if (!supabase || found.length === 0) return
  // Ids of the database's kind first, kept on disk: a second try after a lost answer then writes
  // the same rows again instead of adding copies.
  const list = found.map((training) =>
    UUID.test(training.id) ? training : { ...training, id: newId() },
  )
  write(LIST_KEY, list)
  const { error } = await supabase
    .from('trainings')
    .upsert(list.map((training) => toRow(userId, training)))
  if (error) throw error
  write(LIST_KEY, null)
}

async function load(userId: string): Promise<void> {
  if (!supabase) return
  loaded.value = false
  loadError.value = ''
  trainings.value = []
  let moveFailed = false
  try {
    await moveLocal(userId)
  } catch {
    moveFailed = true
  }
  const { data, error } = await supabase
    .from('trainings')
    .select('id, draft, saved_at')
    .order('saved_at', { ascending: false })
  // Someone else may have signed in while this was on its way.
  if (user.value?.id !== userId) return
  if (error) loadError.value = FAILED_LOAD
  else {
    trainings.value = data.flatMap((row) => fromRow(row) ?? [])
    if (moveFailed) loadError.value = FAILED_MOVE
  }
  loaded.value = true
}

if (supabase) {
  watch(
    user,
    (current, before) => {
      if (current) {
        if (current.id !== before?.id) void load(current.id)
      } else if (before) {
        // Signed out: the next person on this browser sees none of it.
        trainings.value = []
        loaded.value = false
        loadError.value = ''
        write(DRAFT_KEY, null)
      }
    },
    { immediate: true },
  )
}

/** Resolves once the list is read, or after a while: the pages that need it do not hang on a slow answer. */
function whenLoaded(): Promise<void> {
  if (loaded.value) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = watch(loaded, (value) => {
      if (!value) return
      stop()
      resolve()
    })
    setTimeout(() => {
      stop()
      resolve()
    }, LOAD_TIMEOUT_MS)
  })
}

export function useCustomTrainings() {
  function find(id: string): SavedTraining | undefined {
    return trainings.value.find((training) => training.id === id)
  }

  /** Saves the training, over the saved one with `id` or as a new one; returns its id. Rejects with a message to show. */
  async function save(draft: TrainingDraft, id?: string): Promise<string> {
    const saved: SavedTraining = { id: id ?? newId(), savedAt: Date.now(), draft }
    if (supabase) {
      const userId = user.value?.id
      if (!userId) throw new Error(NOT_SIGNED_IN)
      const { error } = await supabase.from('trainings').upsert(toRow(userId, saved))
      if (error) throw new Error(FAILED_SAVE)
    }
    trainings.value = [saved, ...trainings.value.filter((training) => training.id !== saved.id)]
    if (!supabase) write(LIST_KEY, trainings.value)
    return saved.id
  }

  /** Rejects with a message to show. */
  async function remove(id: string): Promise<void> {
    if (supabase) {
      const { error } = await supabase.from('trainings').delete().eq('id', id)
      if (error) throw new Error(FAILED_REMOVE)
    }
    trainings.value = trainings.value.filter((training) => training.id !== id)
    if (!supabase) write(LIST_KEY, trainings.value)
  }

  function loadNewDraft(): TrainingDraft {
    return parseDraft(read(DRAFT_KEY)?.data) ?? EMPTY_DRAFT
  }

  function storeNewDraft(draft: TrainingDraft | null): void {
    write(DRAFT_KEY, draft)
  }

  return {
    trainings,
    loaded,
    loadError,
    /** Whether the list follows the account (Supabase) rather than this browser alone. */
    synced: supabase !== null,
    find,
    save,
    remove,
    whenLoaded,
    loadNewDraft,
    storeNewDraft,
  }
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
