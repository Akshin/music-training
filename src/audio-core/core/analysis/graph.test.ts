import { describe, expect, it } from 'vitest'

import { defineExtractor, type AnyExtractor } from './extractor'
import { collectColumns, columnLags, resolveExtractors } from './graph'

function stub(id: string, deps: AnyExtractor[] = [], columns: string[] = []): AnyExtractor {
  return defineExtractor<void>({
    id,
    deps,
    columns,
    create: () => ({ process: () => undefined }),
  })
}

describe('resolveExtractors', () => {
  it('orders dependencies before dependants and deduplicates', () => {
    const a = stub('a')
    const b = stub('b', [a])
    const c = stub('c', [a, b])
    const order = resolveExtractors([c, b]).map((e) => e.id)
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('includes transitive dependencies that were not requested', () => {
    const a = stub('a')
    const b = stub('b', [a])
    expect(resolveExtractors([b]).map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('rejects two definitions with the same id', () => {
    expect(() => resolveExtractors([stub('x'), stub('x')])).toThrow(/share the id "x"/)
  })

  it('detects cycles', () => {
    const deps: AnyExtractor[] = []
    const a = stub('a', deps)
    const b = stub('b', [a])
    deps.push(b)
    expect(() => resolveExtractors([a])).toThrow(/cycle/)
  })
})

describe('collectColumns', () => {
  it('gathers columns in graph order and rejects duplicates', () => {
    const a = stub('a', [], ['x', 'y'])
    const b = stub('b', [a], ['z'])
    expect(collectColumns(resolveExtractors([b]))).toEqual(['x', 'y', 'z'])
    const clash = stub('c', [], ['x'])
    expect(() => collectColumns(resolveExtractors([a, clash]))).toThrow(/Column "x"/)
  })
})

describe('columnLags', () => {
  it('adds the own lag of an extractor to the largest lag of its inputs', () => {
    const context = { sampleRate: 48000, frameSize: 2048, hopSize: 480 }
    const lagging = (id: string, deps: AnyExtractor[], columns: string[]): AnyExtractor =>
      defineExtractor<void, { delay: number }>({
        id,
        deps,
        columns,
        lag: (_context, options) => options?.delay ?? 0,
        create: () => ({ process: () => undefined }),
      })
    const level = stub('level', [], ['rms'])
    const tracker = lagging('tracker', [], ['f0'])
    const pitch = stub('pitch', [tracker], ['midi'])
    const mixed = lagging('mixed', [level, pitch], ['h1'])
    const graph = resolveExtractors([mixed])
    expect(columnLags(graph, context, { tracker: { delay: 5 }, mixed: { delay: 1 } })).toEqual({
      f0: 5,
      midi: 5,
      h1: 6,
    })
    expect(columnLags(graph, context)).toEqual({})
  })
})
