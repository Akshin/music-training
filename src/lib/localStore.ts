/**
 * Larger things kept on this device between visits — IndexedDB, one value per key. Every call may
 * fail (a private window, storage turned off); callers treat that as nothing kept.
 */

const DATABASE = 'music-training'
const STORE = 'kept'

let opened: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable'))
  }).catch((error: unknown) => {
    opened = null
    throw error
  })
  return opened
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await database()
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

export function loadKept<T>(key: string): Promise<T | undefined> {
  return run<T | undefined>('readonly', (store) => store.get(key))
}

export async function keep(key: string, value: unknown): Promise<void> {
  await run('readwrite', (store) => store.put(value, key))
}

export async function forgetKept(key: string): Promise<void> {
  await run('readwrite', (store) => store.delete(key))
}
