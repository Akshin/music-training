import { describe, expect, it } from 'vitest'

import { pitch } from './extractors/pitch'
import { spectrum } from './extractors/spectrum'
import { extractorRegistry, resolveFeatureIds } from './registry'

describe('extractor registry', () => {
  it('is keyed by extractor id', () => {
    for (const [id, extractor] of Object.entries(extractorRegistry)) expect(extractor.id).toBe(id)
  })

  it('resolves ids in the requested order', () => {
    expect(resolveFeatureIds(['pitch', 'spectrum'])).toEqual([pitch, spectrum])
  })

  it('fails loudly on an unknown id', () => {
    expect(() => resolveFeatureIds(['pitch', 'nope'])).toThrow(/Unknown feature "nope"/)
  })
})
