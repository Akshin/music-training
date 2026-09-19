/**
 * Breaths on the pitch charts, drawn as veils of haze. An inhale gathers the haze upwards into a
 * point and breathes it in; an exhale lets it out of the point downwards, where it spreads and
 * fades. One movement lasts exactly the breath, so it follows the tempo.
 */

export type BreathKind = 'inhale' | 'exhale'

/** A breath on the chart's clock, like a `PitchTarget` but with no pitch of its own. */
export interface BreathTarget {
  readonly kind: BreathKind
  /** Seconds on the trace clock. */
  readonly start: number
  readonly duration: number
  /**
   * The pitch the breath hangs from: where an inhale gathers into its point and an exhale leaves
   * it. Null when there are no notes around; the chart picks the middle of its range.
   */
  readonly midi: number | null
}

/** Layers of haze, each a little behind the one before. */
const VEILS = 4
const VEIL_LAG = 0.12
/** Opacity of one veil at its densest; the layers add up where they overlap. */
const VEIL_ALPHA = 0.34

function smooth(from: number, to: number, x: number): number {
  const u = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return u * u * (3 - 2 * u)
}

/**
 * How far the haze has gathered (0 spread wide below, 1 in the point), how visible it is and how
 * bright the point is, at phase `p` of the breath. An inhale speeds up towards the point; an
 * exhale bursts out and slows down as it spreads.
 */
function breathState(kind: BreathKind, p: number) {
  if (kind === 'inhale') {
    return {
      gathered: p * p * p,
      alpha: smooth(0, 0.12, p) * (1 - smooth(0.92, 1, p)),
      spark: smooth(0.8, 0.95, p) * (1 - smooth(0.95, 1, p)),
    }
  }
  return {
    gathered: (1 - p) ** 3,
    alpha: smooth(0, 0.06, p) * (1 - smooth(0.55, 1, p)),
    spark: 1 - smooth(0, 0.18, p),
  }
}

/** The phase a breath is at while it waits for its turn: visible, not yet moving. */
export const BREATH_WAITING_PHASE: Record<BreathKind, number> = { inhale: 0.15, exhale: 0.1 }

/**
 * The phase of a breath at `time` on its clock: 0…1 while it lasts, the waiting phase before it,
 * null once it is over.
 */
export function breathPhaseAt(breath: BreathTarget, time: number): number | null {
  if (time < breath.start) return BREATH_WAITING_PHASE[breath.kind]
  if (breath.duration <= 0 || time > breath.start + breath.duration) return null
  return (time - breath.start) / breath.duration
}

/** The phase of a breath played over and over, for previews: `seconds` on any running clock. */
export function loopedBreathPhase(breath: BreathTarget, seconds: number): number {
  return breath.duration > 0 ? (seconds % breath.duration) / breath.duration : 0
}

export interface BreathBox {
  /** Horizontal centre and half-width of the breath, px. */
  readonly centre: number
  readonly halfWidth: number
  /** Where the point is, px from the top. */
  readonly point: number
  /** How far below the point the haze spreads, px. */
  readonly depth: number
}

/** `r, g, b` of a colour in hex or `rgb()`, for gradients that fade it out. */
export function rgbChannels(color: string): string {
  const text = color.trim()
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(text)?.[1]
  if (hex !== undefined) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex
    return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)).join(', ')
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text)
  return rgb === null ? '154, 160, 168' : `${rgb[1]}, ${rgb[2]}, ${rgb[3]}`
}

/**
 * Draws a breath at phase `p`: veils of haze, soft ellipses with no outline, that narrow as they
 * rise into the point (an inhale) or widen as they sink from it (an exhale), the later ones
 * lagging, so together they read as a cone of breath. `channels` is the haze colour as `r, g, b`.
 */
export function drawBreath(
  context: CanvasRenderingContext2D,
  kind: BreathKind,
  p: number,
  box: BreathBox,
  channels: string,
): void {
  const { gathered, alpha, spark } = breathState(kind, p)
  const color = (a: number) => `rgba(${channels}, ${Math.min(1, Math.max(0, a))})`
  const bottom = box.point + box.depth
  const lagSign = kind === 'inhale' ? 1 : -1

  context.save()
  for (let layer = 0; layer < VEILS; layer++) {
    const q = Math.min(1, Math.max(0, gathered - lagSign * layer * VEIL_LAG))
    const y = bottom + (box.point - bottom) * q
    const radiusX = Math.max(1, box.halfWidth * (1 - q) * 0.95)
    const radiusY = Math.max(1, box.depth * 0.18 * (1 - q) + 1)
    context.save()
    context.translate(box.centre, y)
    context.scale(radiusX / radiusY, 1)
    const veil = context.createRadialGradient(0, 0, 0, 0, 0, radiusY)
    veil.addColorStop(0, color(alpha * VEIL_ALPHA))
    veil.addColorStop(1, color(0))
    context.fillStyle = veil
    context.beginPath()
    context.arc(0, 0, radiusY, 0, Math.PI * 2)
    context.fill()
    context.restore()
  }
  if (spark > 0) {
    const radius = Math.max(2.5, Math.min(6, box.halfWidth * 0.5))
    const glow = context.createRadialGradient(
      box.centre,
      box.point,
      0,
      box.centre,
      box.point,
      radius,
    )
    glow.addColorStop(0, color(spark * 0.9))
    glow.addColorStop(1, color(0))
    context.fillStyle = glow
    context.beginPath()
    context.arc(box.centre, box.point, radius, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}
