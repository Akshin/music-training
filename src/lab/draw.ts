/**
 * Canvas 2D renderers for the /lab page: pitch contour, level meter, magnitude spectrum.
 * Pure functions over typed arrays; no engine or Vue dependencies beyond note names.
 */

import { amplitudeToDb, noteName } from '@audio-core/core/index'

export interface LabTheme {
  readonly ink: string
  readonly muted: string
  readonly line: string
  readonly accent: string
  readonly good: string
  readonly warn: string
  readonly bad: string
  readonly font: string
}

export function readTheme(): LabTheme {
  const style = getComputedStyle(document.documentElement)
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    ink: pick('--ink', '#eceae4'),
    muted: pick('--muted', '#9aa0a8'),
    line: pick('--line', 'rgb(236 234 228 / 12%)'),
    accent: pick('--accent', '#d4b84a'),
    good: pick('--tone', '#4f9a62'),
    warn: pick('--semitone', '#d4b84a'),
    bad: pick('--tonic', '#8f3a48'),
    font: pick('--font', 'sans-serif'),
  }
}

/** Resizes the backing store to the element's CSS size × devicePixelRatio. Returns CSS size. */
export function fitCanvas(canvas: HTMLCanvasElement): { width: number; height: number } {
  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const targetW = Math.max(1, Math.round(width * dpr))
  const targetH = Math.max(1, Math.round(height * dpr))
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW
    canvas.height = targetH
  }
  return { width, height }
}

function begin(canvas: HTMLCanvasElement): {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
} | null {
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  const { width, height } = fitCanvas(canvas)
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return { ctx, width, height }
}

// ---------------------------------------------------------------------------------------------
// Pitch contour

export interface PitchRange {
  lo: number
  hi: number
}

const MIN_SPAN = 12
const PAD = 2
const RANGE_SMOOTHING = 0.12

/** Moves the visible MIDI range towards the voiced content of the window. */
export function followPitchRange(
  range: PitchRange,
  midi: Float32Array,
  count: number,
  offset: number,
): void {
  let min = Infinity
  let max = -Infinity
  for (let i = offset; i < count; i++) {
    const value = midi[i]!
    if (Number.isNaN(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  if (min === Infinity) return
  let lo = min - PAD
  let hi = max + PAD
  if (hi - lo < MIN_SPAN) {
    const centre = (lo + hi) / 2
    lo = centre - MIN_SPAN / 2
    hi = centre + MIN_SPAN / 2
  }
  range.lo += (lo - range.lo) * RANGE_SMOOTHING
  range.hi += (hi - range.hi) * RANGE_SMOOTHING
}

export interface PitchDrawInput {
  /** Fractional MIDI per frame, NaN when unvoiced. Only the first `count` values are used. */
  readonly midi: Float32Array
  readonly count: number
  /** Frames the window can hold; the contour is right-aligned so "now" is the right edge. */
  readonly capacity: number
  readonly frameRate: number
  readonly range: PitchRange
  /** Timeline index of `midi[0]`. Used to place note overlays. */
  readonly windowStart?: number
  readonly notes?: readonly { startFrame: number; endFrame: number; midi: number }[]
}

export function drawPitch(canvas: HTMLCanvasElement, input: PitchDrawInput, theme: LabTheme): void {
  const started = begin(canvas)
  if (started === null) return
  const { ctx, width, height } = started
  const { midi, count, capacity, frameRate, range } = input
  const windowStart = input.windowStart ?? 0
  const left = 44
  const plotW = width - left - 8
  const plotH = height - 22
  const span = Math.max(1e-3, range.hi - range.lo)
  const y = (value: number) => 4 + (plotH - 8) * (1 - (value - range.lo) / span)
  const x = (frame: number) => left + (plotW * (frame + (capacity - count))) / capacity

  ctx.font = `11px ${theme.font}`
  ctx.textBaseline = 'middle'

  // Semitone grid; C lines and labels stronger.
  const first = Math.ceil(range.lo)
  const last = Math.floor(range.hi)
  const labelEvery = span > 30 ? 12 : span > 18 ? 2 : 1
  for (let note = first; note <= last; note++) {
    const isC = note % 12 === 0
    const yy = y(note)
    ctx.strokeStyle = theme.line
    ctx.lineWidth = isC ? 1.5 : 0.5
    ctx.beginPath()
    ctx.moveTo(left, yy)
    ctx.lineTo(left + plotW, yy)
    ctx.stroke()
    if (isC || (note - first) % labelEvery === 0) {
      ctx.fillStyle = isC ? theme.ink : theme.muted
      ctx.textAlign = 'right'
      ctx.fillText(noteName(note), left - 6, yy)
    }
  }

  // Time ticks every second.
  ctx.fillStyle = theme.muted
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const seconds = capacity / frameRate
  for (let s = 0; s <= seconds; s++) {
    const xx = left + plotW * (1 - s / seconds)
    ctx.fillText(s === 0 ? 'now' : `-${s}s`, xx, plotH + 6)
  }

  // Detected notes: a faint bar at the median pitch, clipped to the visible window.
  if (input.notes !== undefined) {
    const windowEnd = windowStart + count
    ctx.globalAlpha = 0.28
    for (const note of input.notes) {
      if (note.endFrame <= windowStart || note.startFrame >= windowEnd) continue
      const from = Math.max(note.startFrame, windowStart) - windowStart
      const to = Math.min(note.endFrame, windowEnd) - windowStart
      const yy = y(note.midi)
      ctx.fillStyle = theme.good
      ctx.fillRect(x(from), yy - 4, Math.max(1, x(to) - x(from)), 8)
    }
    ctx.globalAlpha = 1
  }

  // Contour: continuous runs of voiced frames.
  ctx.strokeStyle = theme.accent
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  let open = false
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const value = midi[i]!
    if (Number.isNaN(value)) {
      open = false
      continue
    }
    const px = x(i)
    const py = y(value)
    if (open) ctx.lineTo(px, py)
    else ctx.moveTo(px, py)
    open = true
  }
  ctx.stroke()
}

// ---------------------------------------------------------------------------------------------
// Level meter

export interface LevelDrawInput {
  readonly dbfs: number
  readonly peakDb: number
}

const LEVEL_FLOOR = -60

export function drawLevel(canvas: HTMLCanvasElement, input: LevelDrawInput, theme: LabTheme): void {
  const started = begin(canvas)
  if (started === null) return
  const { ctx, width, height } = started
  const top = 6
  const bottom = height - 18
  const barX = 12
  const barW = Math.max(10, width - 44)
  const yOf = (db: number) =>
    bottom -
    ((Math.min(0, Math.max(LEVEL_FLOOR, db)) - LEVEL_FLOOR) / -LEVEL_FLOOR) * (bottom - top)

  ctx.fillStyle = theme.line
  ctx.fillRect(barX, top, barW, bottom - top)

  const dbfs = Number.isFinite(input.dbfs) ? input.dbfs : LEVEL_FLOOR
  const yLevel = yOf(dbfs)
  ctx.fillStyle = dbfs > -3 ? theme.bad : dbfs > -12 ? theme.warn : theme.good
  ctx.fillRect(barX, yLevel, barW, bottom - yLevel)

  if (Number.isFinite(input.peakDb)) {
    const yPeak = yOf(input.peakDb)
    ctx.fillStyle = theme.ink
    ctx.fillRect(barX, yPeak - 1, barW, 2)
  }

  ctx.font = `10px ${theme.font}`
  ctx.fillStyle = theme.muted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const db of [0, -12, -24, -36, -48, -60]) {
    ctx.fillText(`${db}`, barX + barW + 4, yOf(db))
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = theme.ink
  ctx.fillText(
    Number.isFinite(input.dbfs) ? `${input.dbfs.toFixed(1)} dB` : '—',
    width / 2,
    height - 7,
  )
}

// ---------------------------------------------------------------------------------------------
// Spectrum

export interface SpectrumDrawInput {
  /** Linear magnitude per bin (full-scale sine ≈ 1). */
  readonly magnitude: Float32Array
  readonly binHz: number
}

const SPECTRUM_MIN_HZ = 40
const SPECTRUM_MAX_HZ = 8000
const SPECTRUM_FLOOR_DB = -96

export function drawSpectrum(
  canvas: HTMLCanvasElement,
  input: SpectrumDrawInput,
  theme: LabTheme,
): void {
  const started = begin(canvas)
  if (started === null) return
  const { ctx, width, height } = started
  const left = 6
  const plotW = width - 12
  const plotH = height - 18
  const logMin = Math.log2(SPECTRUM_MIN_HZ)
  const logMax = Math.log2(SPECTRUM_MAX_HZ)
  const xOf = (hz: number) => left + (plotW * (Math.log2(hz) - logMin)) / (logMax - logMin)
  const yOf = (db: number) =>
    4 +
    (plotH - 4) *
      (1 - (Math.max(SPECTRUM_FLOOR_DB, Math.min(0, db)) - SPECTRUM_FLOOR_DB) / -SPECTRUM_FLOOR_DB)

  ctx.font = `10px ${theme.font}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let hz = 55; hz <= SPECTRUM_MAX_HZ; hz *= 2) {
    const xx = xOf(hz)
    ctx.strokeStyle = theme.line
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(xx, 0)
    ctx.lineTo(xx, plotH)
    ctx.stroke()
    ctx.fillStyle = theme.muted
    ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : `${hz}`, xx, plotH + 4)
  }

  const { magnitude, binHz } = input
  const firstBin = Math.max(1, Math.floor(SPECTRUM_MIN_HZ / binHz))
  const lastBin = Math.min(magnitude.length - 1, Math.ceil(SPECTRUM_MAX_HZ / binHz))
  ctx.strokeStyle = theme.accent
  ctx.lineWidth = 1.25
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (let bin = firstBin; bin <= lastBin; bin++) {
    const px = xOf(bin * binHz)
    const py = yOf(amplitudeToDb(magnitude[bin]!, SPECTRUM_FLOOR_DB))
    if (bin === firstBin) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
}
