/**
 * pYIN (Mauch & Dixon 2014): YIN's CMNDF as a distribution over periods, then a sparse HMM.
 *
 * Local minima of d'(τ) get Boltzmann mass; leftover mass is the unvoiced state. Viterbi with a
 * fixed lag (default 5 frames ≈ 50 ms at 100 fps) reports the state from `delay` steps ago, so
 * the live contour is late by that much and more stable than frame-local YIN on noisy vowels.
 */

import { parabolicOffset, parabolicValue } from './interpolate'

export interface PyinOptions {
  readonly minLag: number
  readonly maxLag: number
  readonly sampleRate: number
  /** HMM bin width, cents. Default 20. */
  readonly binCents?: number
  /** Viterbi lag in frames. Default 5. */
  readonly delay?: number
  /** Boltzmann temperature over trough ranks. Default 2. */
  readonly boltzmann?: number
}

export interface PyinResult {
  frequency: number
  confidence: number
  voiced: boolean
}

const LOG_EPS = -30
const NEIGHBOR = 4

export class PyinTracker {
  readonly delay: number
  readonly binCount: number
  readonly unvoiced: number
  private readonly minLag: number
  private readonly maxLag: number
  private readonly sampleRate: number
  private readonly minHz: number
  private readonly binCents: number
  private readonly boltzmann: number
  private readonly logObs: Float64Array
  private readonly score: Float64Array
  private readonly prevScore: Float64Array
  private readonly binHz: Float64Array
  private readonly back: Int32Array[]
  private readonly hzAt: Float64Array[]
  private readonly masses: Float64Array
  private readonly troughBin: Int32Array
  private readonly troughD: Float64Array
  private readonly troughHz: Float64Array
  private readonly logStay: Float64Array
  private readonly logFromU: number
  private readonly logToU: number
  private readonly logStayU: number
  private cursor = 0
  private filled = 0
  private readonly result: PyinResult = { frequency: NaN, confidence: 0, voiced: false }

  constructor(options: PyinOptions) {
    this.minLag = options.minLag
    this.maxLag = options.maxLag
    this.sampleRate = options.sampleRate
    this.minHz = options.sampleRate / options.maxLag
    const maxHz = options.sampleRate / options.minLag
    this.binCents = options.binCents ?? 20
    this.delay = Math.max(0, options.delay ?? 5)
    this.boltzmann = options.boltzmann ?? 2
    this.binCount = Math.max(
      2,
      Math.round((1200 * Math.log2(maxHz / this.minHz)) / this.binCents) + 1,
    )
    this.unvoiced = this.binCount
    const n = this.binCount + 1
    this.logObs = new Float64Array(n)
    this.score = new Float64Array(n)
    this.prevScore = new Float64Array(n)
    this.binHz = new Float64Array(this.binCount)
    this.masses = new Float64Array(this.binCount)
    this.troughBin = new Int32Array(64)
    this.troughD = new Float64Array(64)
    this.troughHz = new Float64Array(64)
    this.logStay = new Float64Array(NEIGHBOR + 1)
    this.logStay[0] = Math.log(0.62)
    this.logStay[1] = Math.log(0.12)
    this.logStay[2] = Math.log(0.055)
    this.logStay[3] = Math.log(0.025)
    this.logStay[4] = Math.log(0.012)
    this.logFromU = Math.log(0.45)
    this.logToU = Math.log(0.08)
    this.logStayU = Math.log(0.55)
    const history = this.delay + 1
    this.back = Array.from({ length: history }, () => new Int32Array(n).fill(-1))
    this.hzAt = Array.from({ length: history }, () => new Float64Array(this.binCount))
    this.prevScore.fill(LOG_EPS)
    this.prevScore[this.unvoiced] = 0
  }

  reset(): void {
    this.filled = 0
    this.cursor = 0
    this.prevScore.fill(LOG_EPS)
    this.prevScore[this.unvoiced] = 0
    this.result.frequency = NaN
    this.result.confidence = 0
    this.result.voiced = false
  }

  push(cmndf: Float64Array): Readonly<PyinResult> {
    this.observe(cmndf)
    this.viterbi()
    this.filled++
    if (this.filled <= this.delay) {
      this.result.frequency = NaN
      this.result.confidence = 0
      this.result.voiced = false
      return this.result
    }
    const traced = this.trace(this.delay)
    if (traced.state < 0 || traced.state === this.unvoiced) {
      this.result.frequency = NaN
      this.result.confidence = 0
      this.result.voiced = false
      return this.result
    }
    const hz = this.hzAt[traced.frame][traced.state]
    this.result.frequency = hz > 0 ? hz : this.binHzAt(traced.state)
    this.result.confidence = Math.max(0.5, Math.min(1, 1 + this.logObs[traced.state] / 8))
    this.result.voiced = true
    return this.result
  }

  private binHzAt(bin: number): number {
    return this.minHz * 2 ** ((bin * this.binCents) / 1200)
  }

  private hzToBin(hz: number): number {
    const bin = Math.round((1200 * Math.log2(hz / this.minHz)) / this.binCents)
    return bin < 0 ? 0 : bin >= this.binCount ? this.binCount - 1 : bin
  }

  private observe(cmndf: Float64Array): void {
    const { minLag, maxLag, binCount, binHz, logObs, boltzmann, masses } = this
    logObs.fill(LOG_EPS)
    binHz.fill(0)
    masses.fill(0)
    let nTrough = 0
    for (let tau = minLag; tau <= maxLag; tau++) {
      const d = cmndf[tau]
      if (d >= 0.5) continue
      const left = tau === minLag ? d + 1 : cmndf[tau - 1]
      const right = tau === maxLag ? d + 1 : cmndf[tau + 1]
      if (d > left || d > right) continue
      if (nTrough === this.troughBin.length) break
      const offset = parabolicOffset(left, d, right)
      const dip = Math.max(0, parabolicValue(left, d, right, offset))
      const hz = this.sampleRate / (tau + offset)
      this.troughBin[nTrough] = this.hzToBin(hz)
      this.troughD[nTrough] = dip
      this.troughHz[nTrough] = hz
      nTrough++
    }
    let bestD = 1
    let weightSum = 0
    for (let i = 0; i < nTrough; i++) {
      if (this.troughD[i] < bestD) bestD = this.troughD[i]
      const w = Math.exp(-i / boltzmann)
      const bin = this.troughBin[i]
      masses[bin] += w
      if (binHz[bin] === 0) binHz[bin] = this.troughHz[i]
      weightSum += w
    }
    const voiced = nTrough === 0 ? 0 : Math.min(0.99, 1 / (1 + bestD))
    if (weightSum > 0 && voiced > 0) {
      const scale = voiced / weightSum
      for (let b = 0; b < binCount; b++) {
        const p = masses[b] * scale
        if (p > 0) logObs[b] = Math.log(p)
      }
    }
    logObs[this.unvoiced] = Math.log(Math.max(1e-6, 1 - voiced))
    this.hzAt[this.cursor].set(binHz)
  }

  private viterbi(): void {
    const { binCount, unvoiced, score, prevScore, logObs, logStay, logFromU, logToU, logStayU } =
      this
    const back = this.back[this.cursor]
    for (let s = 0; s < binCount; s++) {
      let best = prevScore[unvoiced] + logFromU
      let pred = unvoiced
      const lo = s - NEIGHBOR
      const hi = s + NEIGHBOR
      for (let p = lo < 0 ? 0 : lo; p <= hi && p < binCount; p++) {
        const val = prevScore[p] + logStay[Math.abs(s - p)]
        if (val > best) {
          best = val
          pred = p
        }
      }
      score[s] = best + logObs[s]
      back[s] = pred
    }
    let bestU = prevScore[unvoiced] + logStayU
    let predU = unvoiced
    for (let p = 0; p < binCount; p++) {
      const val = prevScore[p] + logToU
      if (val > bestU) {
        bestU = val
        predU = p
      }
    }
    score[unvoiced] = bestU + logObs[unvoiced]
    back[unvoiced] = predU
    prevScore.set(score)
    this.cursor = (this.cursor + 1) % this.back.length
  }

  private trace(lag: number): { state: number; frame: number } {
    let state = 0
    let best = -Infinity
    const n = this.binCount + 1
    for (let s = 0; s < n; s++) {
      if (this.score[s] > best) {
        best = this.score[s]
        state = s
      }
    }
    let frame = (this.cursor - 1 + this.back.length) % this.back.length
    for (let step = 0; step < lag; step++) {
      state = this.back[frame][state]
      if (state < 0) return { state: this.unvoiced, frame }
      frame = (frame - 1 + this.back.length) % this.back.length
    }
    return { state, frame }
  }
}
