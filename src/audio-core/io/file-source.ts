/**
 * File → PCM chunks the analyser already understands.
 *
 * 16-bit WAV goes through `decodeWav` (no DOM). Other containers use `decodeAudioData` here in
 * `io/`, never in `core/`.
 */

import { chunkSamples, type AudioChunk } from '../core/model/audio'
import { decodeWav, isWav } from '../core/session/wav'

export interface FileSource {
  readonly samples: Float32Array
  readonly sampleRate: number
  readonly channels: number
  readonly label: string
  chunks(chunkSize?: number): AudioChunk[]
}

const DEFAULT_CHUNK = 4096

function source(
  samples: Float32Array,
  sampleRate: number,
  channels: number,
  label: string,
): FileSource {
  return {
    samples,
    sampleRate,
    channels,
    label,
    chunks(chunkSize = DEFAULT_CHUNK) {
      return chunkSamples(samples, chunkSize, sampleRate)
    },
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const n = buffer.length
  const channels = buffer.numberOfChannels
  if (channels === 1) return buffer.getChannelData(0).slice()
  const out = new Float32Array(n)
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < n; i++) out[i] += data[i]
  }
  const scale = 1 / channels
  for (let i = 0; i < n; i++) out[i] *= scale
  return out
}

/** Decode a 16-bit PCM WAV without AudioContext. */
export function fileFromWav(buffer: ArrayBuffer, label = 'wav'): FileSource {
  const wav = decodeWav(buffer)
  return source(wav.samples, wav.sampleRate, wav.channels, label)
}

/**
 * Decode a user file. WAV uses the core decoder; anything else (and odd WAV) goes through
 * `decodeAudioData`. Pass a shared `AudioContext` when the host already has one.
 */
export async function fileFromBlob(
  file: Blob,
  options: { context?: AudioContext; label?: string } = {},
): Promise<FileSource> {
  const label = options.label ?? (file instanceof File ? file.name : 'file')
  const buffer = await file.arrayBuffer()
  if (isWav(buffer)) {
    try {
      return fileFromWav(buffer, label)
    } catch {
      // Fall through: IEEE-float / 24-bit WAVE still has a RIFF header.
    }
  }
  const ctx = options.context ?? new AudioContext()
  const owns = options.context === undefined
  try {
    const decoded = await ctx.decodeAudioData(buffer.slice(0))
    return source(mixToMono(decoded), decoded.sampleRate, decoded.numberOfChannels, label)
  } finally {
    if (owns) await ctx.close()
  }
}
