/**
 * Float32 ↔ int16 conversion for cold PCM storage.
 *
 * 16-bit is ~96 dB of dynamic range — enough for a vocal take, half the bytes of float32.
 * Encoding clips to [-1, 1]; decoding is exact for values that came from this encoder.
 */

export const INT16_MAX = 32767

/** Writes `source[offset, offset + out.length)` into `out` as 16-bit PCM. */
export function floatToInt16(source: ArrayLike<number>, out: Int16Array, offset = 0): Int16Array {
  const count = out.length
  for (let i = 0; i < count; i++) {
    const x = source[offset + i]
    if (x >= 1) out[i] = INT16_MAX
    else if (x <= -1) out[i] = -INT16_MAX
    else out[i] = x * INT16_MAX
  }
  return out
}

/** Writes `source` into `out[offset, ...)` as float in [-1, 1]. */
export function int16ToFloat(source: Int16Array, out: Float32Array, offset = 0): Float32Array {
  for (let i = 0; i < source.length; i++) out[offset + i] = source[i] / INT16_MAX
  return out
}

export function encodeInt16(samples: ArrayLike<number>): Int16Array {
  return floatToInt16(samples, new Int16Array(samples.length))
}

export function decodeInt16(pcm: Int16Array): Float32Array {
  return int16ToFloat(pcm, new Float32Array(pcm.length))
}
