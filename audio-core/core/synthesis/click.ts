/**
 * Deterministic click samples for the metronome.
 *
 * Two decaying partials, no noise: the same buffer is what tests inspect and what the Web Audio
 * adapter plays, so the click the trainee hears is the click the calibrator looks for.
 */

export function renderClick(sampleRate: number, accent: boolean): Float32Array {
  const seconds = 0.055
  const n = Math.max(1, Math.round(sampleRate * seconds))
  const out = new Float32Array(n)
  const f0 = accent ? 920 : 680
  const f1 = accent ? 1840 : 1320
  const peak = accent ? 0.72 : 0.45
  const decay = accent ? 58 : 74
  const w0 = (2 * Math.PI * f0) / sampleRate
  const w1 = (2 * Math.PI * f1) / sampleRate
  for (let i = 0; i < n; i++) {
    const env = Math.exp((-decay * i) / sampleRate)
    out[i] = peak * env * (Math.sin(w0 * i) + 0.35 * Math.sin(w1 * i))
  }
  return out
}
