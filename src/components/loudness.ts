/**
 * Loudness colours — the one convention for every meter and chart: from the quietest a greyish
 * yellow, through yellow to green, the level to practise singing at, and on to burgundy, too loud.
 * Colours blend gradually between the stops, in OKLab so the midpoints stay clean.
 *
 * Levels are the meter scale of the mic composables: 0…1 over −60…0 dBFS.
 */

export interface LoudnessStop {
  /** Level in [0, 1] where the stop's colour is pure. */
  readonly at: number
  /** CSS custom property holding the colour for the current theme. */
  readonly token: string
}

export const LOUDNESS_STOPS: readonly LoudnessStop[] = [
  { at: 0, token: '--loudness-quiet' }, // silence
  { at: 0.35, token: '--loudness-soft' }, // −39 dBFS
  { at: 0.55, token: '--loudness-good' }, // −27 dBFS: the practice level starts
  { at: 0.78, token: '--loudness-good' }, // −13 dBFS: the practice level ends
  { at: 0.92, token: '--loudness-loud' }, // −5 dBFS and up: too loud
]

/** The whole scale from silence at the bottom to full at the top, for fills clipped at the level. */
export const LOUDNESS_GRADIENT = `linear-gradient(to top in oklab, ${LOUDNESS_STOPS.map(
  (stop) => `var(${stop.token}) ${stop.at * 100}%`,
).join(', ')})`

/** CSS colour of a level for DOM elements; follows the theme through the tokens. */
export function loudnessColor(level: number): string {
  const { from, to, t } = bracket(level)
  if (from.token === to.token) return `var(${from.token})`
  return `color-mix(in oklab, var(${from.token}) ${Math.round((1 - t) * 100)}%, var(${to.token}))`
}

/**
 * Resolved colours for canvas, which cannot read CSS variables: `steps + 1` colours from silence
 * to full, blended the same way as `color-mix(in oklab, …)`. `readToken` returns a token's value
 * (hex or `rgb()`), e.g. from `getComputedStyle`.
 */
export function loudnessColorTable(readToken: (token: string) => string, steps = 100): string[] {
  const lab = new Map(
    LOUDNESS_STOPS.map((stop) => [stop.token, toOklab(parseColor(readToken(stop.token)))]),
  )
  return Array.from({ length: steps + 1 }, (_, index) => {
    const { from, to, t } = bracket(index / steps)
    const a = lab.get(from.token)!
    const b = lab.get(to.token)!
    return fromOklab([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
  })
}

/** The two stops around a level and how far between them it sits. */
function bracket(level: number): { from: LoudnessStop; to: LoudnessStop; t: number } {
  const x = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
  for (let i = 1; i < LOUDNESS_STOPS.length; i++) {
    const from = LOUDNESS_STOPS[i - 1]!
    const to = LOUDNESS_STOPS[i]!
    if (x <= to.at) return { from, to, t: (x - from.at) / (to.at - from.at) }
  }
  const last = LOUDNESS_STOPS[LOUDNESS_STOPS.length - 1]!
  return { from: last, to: last, t: 0 }
}

type Triple = readonly [number, number, number]

function parseColor(value: string): Triple {
  const text = value.trim()
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(text)?.[1]
  if (hex !== undefined) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ]
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text)
  if (rgb !== null) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return [128, 128, 128]
}

function toLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function toSrgb(linear: number): number {
  const c = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, c)) * 255)
}

/** sRGB → OKLab (Björn Ottosson). */
function toOklab([red, green, blue]: Triple): Triple {
  const r = toLinear(red)
  const g = toLinear(green)
  const b = toLinear(blue)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLab → `rgb()` string. */
function fromOklab([lightness, a, b]: Triple): string {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const red = toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const green = toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const blue = toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return `rgb(${red}, ${green}, ${blue})`
}
