import { kWeighting } from '../../dsp/k-weight'
import {
  GATE_BLOCK_SECONDS,
  GATE_HOP_SECONDS,
  LUFS_ABSOLUTE_GATE,
  MOMENTARY_SECONDS,
  SHORT_TERM_SECONDS,
  meanSquareToLufs,
  relativeGated,
} from '../../dsp/lufs'
import { defineExtractor } from '../extractor'

export interface LoudnessOptions {
  /** Momentary window, seconds. Default 0.4 (BS.1770). */
  readonly momentarySeconds: number
  /** Short-term window, seconds. Default 3. */
  readonly shortTermSeconds: number
}

export interface LoudnessResult {
  /** 400 ms ungated LUFS, NaN until the window fills or below −70. */
  momentary: number
  /** 3 s ungated LUFS, NaN until the window fills or below −70. */
  shortTerm: number
  /** EBU R128 integrated (absolute + relative gate). */
  integrated: number
}

/**
 * K-weighted loudness of the *new hop* (not the overlapping analysis window), so Hann/overlap
 * cannot bias the mean square. Columns: `lufsMomentary`, `lufsShortTerm`, `lufsIntegrated`.
 */
export const loudness = defineExtractor<LoudnessResult, LoudnessOptions>({
  id: 'loudness',
  deps: [],
  columns: ['lufsMomentary', 'lufsShortTerm', 'lufsIntegrated'],
  create(context, options) {
    const hop = context.hopSize
    const frameSize = context.frameSize
    const momentaryHops = Math.max(
      1,
      Math.round(((options?.momentarySeconds ?? MOMENTARY_SECONDS) * context.sampleRate) / hop),
    )
    const shortHops = Math.max(
      1,
      Math.round(((options?.shortTermSeconds ?? SHORT_TERM_SECONDS) * context.sampleRate) / hop),
    )
    const blockHops = Math.max(1, Math.round((GATE_BLOCK_SECONDS * context.sampleRate) / hop))
    const blockStep = Math.max(1, Math.round((GATE_HOP_SECONDS * context.sampleRate) / hop))
    const filter = kWeighting(context.sampleRate)
    const weighted = new Float64Array(hop)
    const ring = new Float64Array(shortHops)
    let index = 0
    let filled = 0
    let hopsSinceBlock = 0
    let blocks = new Float64Array(256)
    let blockCount = 0
    const result: LoudnessResult = { momentary: NaN, shortTerm: NaN, integrated: NaN }

    return {
      reset() {
        filter.reset()
        ring.fill(0)
        index = 0
        filled = 0
        hopsSinceBlock = 0
        blockCount = 0
        result.momentary = NaN
        result.shortTerm = NaN
        result.integrated = NaN
      },
      process(frame, _deps, out) {
        const start = frameSize - hop
        filter.process(frame.samples, start, frameSize, weighted)
        let energy = 0
        for (let i = 0; i < hop; i++) energy += weighted[i] * weighted[i]
        ring[index] = energy / hop
        index = (index + 1) % shortHops
        if (filled < shortHops) filled++
        hopsSinceBlock++

        result.momentary =
          filled >= momentaryHops ? toColumn(meanLast(ring, index, filled, momentaryHops)) : NaN
        result.shortTerm =
          filled >= shortHops ? toColumn(meanLast(ring, index, filled, shortHops)) : NaN

        if (filled >= blockHops && hopsSinceBlock >= blockStep) {
          hopsSinceBlock = 0
          const block = meanSquareToLufs(meanLast(ring, index, filled, blockHops))
          if (blockCount === blocks.length) {
            const grown = new Float64Array(blocks.length * 2)
            grown.set(blocks)
            blocks = grown
          }
          blocks[blockCount] = block
          blockCount++
          const integrated = relativeGated(blocks, blockCount)
          result.integrated = Number.isFinite(integrated) ? integrated : NaN
        }

        out.set('lufsMomentary', result.momentary)
        out.set('lufsShortTerm', result.shortTerm)
        out.set('lufsIntegrated', result.integrated)
        return result
      },
    }
  },
})

function toColumn(meanSquare: number): number {
  const lufs = meanSquareToLufs(meanSquare)
  return lufs >= LUFS_ABSOLUTE_GATE ? lufs : NaN
}

function meanLast(ring: Float64Array, next: number, filled: number, count: number): number {
  const n = Math.min(filled, count)
  const len = ring.length
  let sum = 0
  for (let k = 1; k <= n; k++) sum += ring[(next - k + len * 4) % len]
  return sum / n
}
