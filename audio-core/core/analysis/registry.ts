/**
 * Feature ids → extractor definitions.
 *
 * Definitions are objects and cannot cross a worker boundary; hosts send feature ids and both
 * sides resolve them through this registry, so the worker's timeline and the main-thread mirror
 * are built from the same graph.
 */

import type { AnyExtractor } from './extractor'
import { cpp } from './extractors/cpp'
import { f0 } from './extractors/f0'
import { formants } from './extractors/formants'
import { level } from './extractors/level'
import { loudness } from './extractors/loudness'
import { onset } from './extractors/onset'
import { pitch } from './extractors/pitch'
import { spectrum } from './extractors/spectrum'
import { vibrato } from './extractors/vibrato'

export const extractorRegistry: Readonly<Record<string, AnyExtractor>> = {
  [spectrum.id]: spectrum,
  [level.id]: level,
  [f0.id]: f0,
  [pitch.id]: pitch,
  [vibrato.id]: vibrato,
  [formants.id]: formants,
  [loudness.id]: loudness,
  [cpp.id]: cpp,
  [onset.id]: onset,
}

export function resolveFeatureIds(ids: readonly string[]): AnyExtractor[] {
  return ids.map((id) => {
    const extractor = extractorRegistry[id]
    if (extractor === undefined) {
      throw new Error(
        `Unknown feature "${id}". Known: ${Object.keys(extractorRegistry).join(', ')}`,
      )
    }
    return extractor
  })
}
