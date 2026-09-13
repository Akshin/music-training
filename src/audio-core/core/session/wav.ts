/**
 * Mono 16-bit PCM WAV, encode and decode.
 *
 * Encode is what `/lab` downloads. Decode is for offline passes over a file (and for tests).
 * Multi-channel files are mixed to mono; 8/24/32-bit and IEEE float are rejected so a bad file
 * fails loudly instead of being silently mangled.
 */

import { decodeInt16, encodeInt16, INT16_MAX } from './pcm'

const PCM_FORMAT = 1
const HEADER = 44

export interface WavAudio {
  readonly samples: Float32Array
  readonly sampleRate: number
  readonly channels: number
}

export function encodeWav(samples: ArrayLike<number>, sampleRate: number): ArrayBuffer {
  const pcm = encodeInt16(samples)
  const dataBytes = pcm.byteLength
  const buffer = new ArrayBuffer(HEADER + dataBytes)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, PCM_FORMAT, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)
  new Uint8Array(buffer, HEADER).set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
  return buffer
}

/** True when `buffer` starts with a RIFF/WAVE header (payload may still be invalid). */
export function isWav(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false
  const view = new DataView(buffer)
  return readAscii(view, 0, 4) === 'RIFF' && readAscii(view, 8, 4) === 'WAVE'
}

export function decodeWav(buffer: ArrayBuffer): WavAudio {
  if (buffer.byteLength < HEADER) throw new Error('WAV is truncated')
  const view = new DataView(buffer)
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Not a RIFF WAVE file')
  }
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bits = 0
  let dataOffset = -1
  let dataBytes = 0
  while (offset + 8 <= buffer.byteLength) {
    const id = readAscii(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      const format = view.getUint16(body, true)
      if (format !== PCM_FORMAT) throw new Error(`Unsupported WAV format ${format} (need PCM)`)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
      if (bits !== 16) throw new Error(`Unsupported bit depth ${bits} (need 16)`)
    } else if (id === 'data') {
      dataOffset = body
      dataBytes = size
      break
    }
    offset = body + size + (size & 1)
  }
  if (dataOffset < 0 || sampleRate === 0) throw new Error('WAV is missing fmt or data')
  const frames = Math.floor(dataBytes / (2 * channels))
  const pcm = new Int16Array(buffer, dataOffset, frames * channels)
  if (channels === 1) return { samples: decodeInt16(pcm), sampleRate, channels }
  const mixed = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) sum += pcm[i * channels + c]
    mixed[i] = sum / channels / INT16_MAX
  }
  return { samples: mixed, sampleRate, channels }
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

function readAscii(view: DataView, offset: number, length: number): string {
  let text = ''
  for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint8(offset + i))
  return text
}
