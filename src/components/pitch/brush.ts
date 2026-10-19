/**
 * The voice as a brush stroke: ink laid along the pitch line, thick where a note is held on its
 * semitone, thin where the voice is between notes or off. Three passes, from a wide faint one to a
 * narrow dark one, give the stroke a wet edge; a noise along the edge keeps it from looking drawn
 * with a ruler.
 *
 * The outline of a stroke of varying width is `stroke()` from shan-shui-inf
 * (c) 2018 Lingdong Huang, MIT License.
 */

/** A point of the pitch line on the canvas, with how far the voice is from its semitone. */
export interface BrushPoint {
  readonly x: number
  readonly y: number
  /** 0 on the semitone … 1 half a semitone off. */
  readonly off: number
}

/** Half-width in px of a held, in-tune note at `lane` px per semitone: a third of the lane. */
export function brushWidth(lane: number): number {
  return Math.min(9, Math.max(2.5, lane * 0.34))
}

const NOISE = new Float32Array(256)
{
  let s = 9
  for (let i = 0; i < NOISE.length; i++) {
    s = (s * 16807) % 2147483647
    NOISE[i] = s / 2147483647
  }
}
/** Smooth value noise in [0, 1] along one axis. */
function noise(t: number): number {
  const i = Math.floor(t)
  const f = t - i
  const u = f * f * (3 - 2 * f)
  const a = NOISE[((i % 256) + 256) % 256]!
  const b = NOISE[(((i + 1) % 256) + 256) % 256]!
  return a + (b - a) * u
}

/** The outline of a stroke along `points`, `width` wide where `weight` is 1, as a closed polygon. */
function outline(
  points: readonly BrushPoint[],
  width: number,
  weight: (point: BrushPoint, at: number) => number,
  wobble: number,
  seed: number,
): [number, number][] | null {
  if (points.length < 3) return null
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!
    const before = points[i - 1]!
    const after = points[i + 1]!
    let w = width * weight(p, i / points.length)
    w = w * (1 - wobble) + w * wobble * noise(i * 0.5 + seed)
    const a1 = Math.atan2(p.y - before.y, p.x - before.x)
    const a2 = Math.atan2(p.y - after.y, p.x - after.x)
    let a = (a1 + a2) / 2
    if (a < a2) a += Math.PI
    left.push([p.x + w * Math.cos(a), p.y + w * Math.sin(a)])
    right.push([p.x - w * Math.cos(a), p.y - w * Math.sin(a)])
  }
  const first = points[0]!
  const last = points[points.length - 1]!
  return [[first.x, first.y], ...left, [last.x, last.y], ...right.reverse()]
}

function fill(c: CanvasRenderingContext2D, poly: [number, number][] | null, alpha: number): void {
  if (poly === null) return
  c.globalAlpha = alpha
  c.beginPath()
  c.moveTo(poly[0]![0], poly[0]![1])
  for (let i = 1; i < poly.length; i++) c.lineTo(poly[i]![0], poly[i]![1])
  c.closePath()
  c.fill()
}

/**
 * One breath of voice as a stroke. The brush is fullest on a held, in-tune note and thins to a
 * hair when the voice is half a semitone off; it also tapers in at the start and out at the end.
 */
export function strokeBrush(
  c: CanvasRenderingContext2D,
  points: readonly BrushPoint[],
  width: number,
  color: string,
  seed = 0,
  /** The stroke is still being sung: no taper at its end. */
  open = false,
): void {
  if (points.length < 3) return
  const taper = (at: number) =>
    open ? Math.min(1, at * 4) : Math.sin(Math.min(1, at * 1.08) * Math.PI)
  const weight = (p: BrushPoint, at: number) =>
    (0.18 + 0.82 * Math.max(0, 1 - p.off * 1.6)) * Math.pow(taper(at), 0.35)
  c.save()
  c.fillStyle = color
  fill(c, outline(points, width * 1.35, weight, 0.9, seed), 0.18)
  fill(c, outline(points, width, weight, 0.6, seed + 3), 0.5)
  fill(c, outline(points, width * 0.66, weight, 0.35, seed + 7), 0.92)
  c.restore()
}
