import { describe, expect, it } from 'vitest'

import { BufferPool } from './buffer-pool'

describe('BufferPool', () => {
  it('hands out buffers of the configured size and reuses released ones', () => {
    const pool = new BufferPool(256)
    const a = pool.acquire()
    const b = pool.acquire()
    expect(a.byteLength).toBe(256)
    expect(pool.getStats()).toEqual({ allocated: 2, free: 0 })

    expect(pool.release(a)).toBe(true)
    expect(pool.getStats()).toEqual({ allocated: 2, free: 1 })
    expect(pool.acquire()).toBe(a)
    expect(pool.getStats()).toEqual({ allocated: 2, free: 0 })
    pool.release(b)
  })

  it('rejects buffers of another size or detached ones', () => {
    const pool = new BufferPool(64)
    expect(pool.release(new ArrayBuffer(32))).toBe(false)

    const detached = new ArrayBuffer(64)
    structuredClone(detached, { transfer: [detached] })
    expect(detached.detached).toBe(true)
    expect(pool.release(detached)).toBe(false)
    expect(pool.getStats()).toEqual({ allocated: 0, free: 0 })
  })

  it('releaseAll reports how many buffers were accepted', () => {
    const pool = new BufferPool(16)
    const accepted = pool.releaseAll([new ArrayBuffer(16), new ArrayBuffer(8), new ArrayBuffer(16)])
    expect(accepted).toBe(2)
    expect(pool.getStats().free).toBe(2)
  })

  it('refuses a non-positive size', () => {
    expect(() => new BufferPool(0)).toThrow(RangeError)
  })
})
