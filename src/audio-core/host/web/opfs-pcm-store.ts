/**
 * Cold PCM store backed by a single OPFS file, written with a sync access handle.
 *
 * Only available inside a worker (`createSyncAccessHandle`). Chunk `i` lives at byte offset
 * `i * chunkSamples * 2`. The core `PcmTape` talks to this through `PcmColdStore` — no OPFS types
 * leak into `core/`.
 */

import type { PcmColdStore } from '../../core/session/pcm-tape'

interface SyncAccessHandle {
  write(buffer: ArrayBufferView, options?: { at: number }): number
  read(buffer: ArrayBufferView, options?: { at: number }): number
  getSize(): number
  truncate(size: number): void
  flush(): void
  close(): void
}

interface FileHandle {
  createSyncAccessHandle(): Promise<SyncAccessHandle>
}

interface DirectoryHandle {
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<DirectoryHandle>
  getFileHandle(name: string, options: { create: boolean }): Promise<FileHandle>
}

export class OpfsColdStore implements PcmColdStore {
  readonly chunkSamples: number
  readonly backend = 'opfs' as const
  private readonly handle: SyncAccessHandle
  private readonly chunkBytes: number
  private written = 0

  constructor(handle: SyncAccessHandle, chunkSamples: number) {
    this.handle = handle
    this.chunkSamples = chunkSamples
    this.chunkBytes = chunkSamples * Int16Array.BYTES_PER_ELEMENT
    this.written = Math.floor(handle.getSize() / this.chunkBytes)
  }

  write(index: number, pcm: Int16Array): void {
    this.handle.write(pcm, { at: index * this.chunkBytes })
    if (index + 1 > this.written) this.written = index + 1
  }

  read(index: number): Int16Array | undefined {
    if (index < 0 || index >= this.written) return undefined
    const pcm = new Int16Array(this.chunkSamples)
    const bytes = this.handle.read(pcm, { at: index * this.chunkBytes })
    if (bytes < this.chunkBytes) return undefined
    return pcm
  }

  get chunkCount(): number {
    return this.written
  }

  clear(): void {
    this.handle.truncate(0)
    this.written = 0
  }

  close(): void {
    try {
      this.handle.flush()
      this.handle.close()
    } catch {
      // Already closed, or the worker is tearing down.
    }
  }
}

export async function openOpfsColdStore(
  chunkSamples: number,
  name = `pcm-${Date.now()}`,
): Promise<OpfsColdStore> {
  const storage = navigator.storage as { getDirectory?: () => Promise<DirectoryHandle> } | undefined
  if (storage?.getDirectory === undefined) throw new Error('OPFS is unavailable')
  const root = await storage.getDirectory()
  const dir = await root.getDirectoryHandle('audio-core', { create: true })
  const file = await dir.getFileHandle(name, { create: true })
  const handle = await file.createSyncAccessHandle()
  handle.truncate(0)
  return new OpfsColdStore(handle, chunkSamples)
}
