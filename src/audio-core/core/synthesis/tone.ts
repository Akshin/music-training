/**
 * Reference note voice: a soft electric-piano tone that sits well next to any instrument or voice.
 *
 * Two-operator FM: a sine carrier phase-modulated by a sine at the same frequency. The modulation
 * index starts bright and falls within about a tenth of a second, so the attack has a gentle bell
 * edge and the body settles close to the fundamental — easy on the ear and easy for a pitch tracker.
 * The level decays like a struck key (faster for higher notes), and a short release tail lets the
 * note ring past its written length instead of being cut. Velocity is the peak amplitude in [0, 1].
 */

import { midiToHz } from '../model/pitch'

/** Ring after the written length, faded out with a raised cosine. */
export const TONE_RELEASE_SECONDS = 0.15

const ATTACK_SECONDS = 0.004
const INDEX_ATTACK = 1.6
const INDEX_BODY = 0.3
const INDEX_DECAY_SECONDS = 0.09
const MIDDLE_C_HZ = 261.63

export function renderTone(
  sampleRate: number,
  midi: number,
  seconds: number,
  velocity = 0.7,
): Float32Array {
  const held = Math.round(sampleRate * Math.max(0, seconds))
  const n = Math.max(1, held + Math.round(sampleRate * TONE_RELEASE_SECONDS))
  const out = new Float32Array(n)
  const hz = midiToHz(midi)
  const step = (2 * Math.PI * hz) / sampleRate
  const peak = Math.max(0, Math.min(1, velocity))
  // Middle C rings for about a second; higher notes die away sooner.
  const decaySeconds = Math.min(2, Math.max(0.3, 1.1 * Math.sqrt(MIDDLE_C_HZ / hz)))
  const releaseLength = n - held
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const attack = t < ATTACK_SECONDS ? t / ATTACK_SECONDS : 1
    const release = i < held ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (i - held + 1)) / releaseLength)
    const index = INDEX_BODY + INDEX_ATTACK * Math.exp(-t / INDEX_DECAY_SECONDS)
    const gain = peak * attack * Math.exp(-t / decaySeconds) * release
    out[i] = gain === 0 ? 0 : gain * Math.sin(step * i + index * Math.sin(step * i))
  }
  return out
}
