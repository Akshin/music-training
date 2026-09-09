import type { AnyExtractor } from './extractor'

/**
 * Orders the requested extractors and their transitive dependencies so that every extractor comes
 * after everything it depends on. Deduplicates by definition identity and rejects two different
 * definitions sharing an id, as well as cycles.
 */
export function resolveExtractors(requested: readonly AnyExtractor[]): AnyExtractor[] {
  const ordered: AnyExtractor[] = []
  const byId = new Map<string, AnyExtractor>()
  const visiting = new Set<AnyExtractor>()

  const visit = (extractor: AnyExtractor, path: string[]): void => {
    const known = byId.get(extractor.id)
    if (known === extractor) return
    if (known !== undefined) {
      throw new Error(`Two different extractors share the id "${extractor.id}"`)
    }
    if (visiting.has(extractor)) {
      throw new Error(`Extractor dependency cycle: ${[...path, extractor.id].join(' → ')}`)
    }
    visiting.add(extractor)
    for (const dep of extractor.deps) visit(dep, [...path, extractor.id])
    visiting.delete(extractor)
    byId.set(extractor.id, extractor)
    ordered.push(extractor)
  }

  for (const extractor of requested) visit(extractor, [])
  return ordered
}

/** Collects the timeline columns of an ordered graph, rejecting duplicates. */
export function collectColumns(extractors: readonly AnyExtractor[]): string[] {
  const owner = new Map<string, string>()
  for (const extractor of extractors) {
    for (const column of extractor.columns) {
      const existing = owner.get(column)
      if (existing !== undefined) {
        throw new Error(`Column "${column}" is written by both "${existing}" and "${extractor.id}"`)
      }
      owner.set(column, extractor.id)
    }
  }
  return [...owner.keys()]
}
