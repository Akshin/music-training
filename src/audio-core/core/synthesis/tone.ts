/**
 * Short pitched tone for reference melodies.
 *
 * Sine at the target MIDI pitch, linear 8 ms edges so scheduling it back-to-back does not click.
 * Velocity is peak amplitude in [0, 1].
 */

import { midiToHz } from '../model/pitch'

const EDGE = 0.008

export function renderTone(
  sampleRate: number,
  midi: number,
  seconds: number,
  velocity = 0.7,
): Float32Array {
  const n = Math.max(1, Math.round(sampleRate * Math.max(0, seconds)))
  const out = new Float32Array(n)
  const step = (2 * Math.PI * midiToHz(midi)) / sampleRate
  const edge = Math.min(Math.floor(EDGE * sampleRate), Math.floor(n / 2))
  const peak = Math.max(0, Math.min(1, velocity))
  for (let i = 0; i < n; i++) {
    let gain = peak
    if (i < edge) gain *= i / edge
    else if (n - 1 - i < edge) gain *= (n - 1 - i) / edge
    out[i] = gain === 0 ? 0 : gain * Math.sin(step * i)
  }
  return out
}
