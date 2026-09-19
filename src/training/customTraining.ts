/**
 * A built training packed into a link: `/custom-training?d=…`. Only what the training needs goes
 * in — title, conditions, meter and the full bars; the bar still being filled stays in the builder.
 *
 * The payload is a compact JSON array, deflated when the browser can and written as base64url. The
 * first character says which: `z` deflated, `j` plain JSON.
 */
import {
  LOUDNESS_ZONES,
  NOTE_KINDS,
  NOTE_LENGTHS,
  ONSETS,
  parseDraft,
  type BuilderNote,
  type TrainingDraft,
} from '@/training/builder'

const VERSION = 1
/** Pitch fields past MIDI for elements with no pitch. */
const REST = 128
const INHALE = 129
const EXHALE = 130

/**
 * `[version, title, bpmMin, bpmMax, loudness, beats, onset, bars]`: a free tempo is `0, 0`, free
 * loudness `-1`, loudness and onset are indexes into their option lists, and each note is one
 * number, `pitch * 64 + length * 8 + kind`, with length and kind as indexes too; a rest, an inhale
 * and an exhale take pitches 128, 129 and 130. Then, if there are any, reprises as flat
 * `[from, to, times, …]` and the description; links made before them simply end earlier.
 */
type Payload =
  | [number, string, number, number, number, number, number, number[][]]
  | [number, string, number, number, number, number, number, number[][], number[]]
  | [number, string, number, number, number, number, number, number[][], number[], string]

function packNote(note: BuilderNote): number {
  const length = NOTE_LENGTHS.findIndex((option) => option.sixteenths === note.sixteenths)
  const kind = NOTE_KINDS.findIndex((option) => option.kind === note.kind)
  const pitch = note.breath === 'inhale' ? INHALE : note.breath === 'exhale' ? EXHALE : note.midi
  return (pitch ?? REST) * 64 + Math.max(0, length) * 8 + Math.max(0, kind)
}

function unpackNote(code: number): Record<string, unknown> {
  const pitch = Math.floor(code / 64)
  return {
    midi: pitch >= REST ? null : pitch,
    breath: pitch === INHALE ? 'inhale' : pitch === EXHALE ? 'exhale' : undefined,
    sixteenths: NOTE_LENGTHS[Math.floor(code / 8) % 8]?.sixteenths,
    kind: NOTE_KINDS[code % 8]?.kind,
  }
}

export function toPayload(draft: TrainingDraft): Payload {
  const payload: Payload = [
    VERSION,
    draft.title,
    draft.bpmRange?.min ?? 0,
    draft.bpmRange?.max ?? 0,
    LOUDNESS_ZONES.findIndex((option) => option.zone === draft.loudness),
    draft.beats,
    ONSETS.findIndex((option) => option.onset === draft.onset),
    draft.bars.map((bar) => bar.notes.map(packNote)),
  ]
  const repeats = draft.repeats.flatMap((repeat) => [repeat.from, repeat.to, repeat.times])
  if (draft.description !== '') return [...payload, repeats, draft.description]
  return repeats.length === 0 ? payload : [...payload, repeats]
}

/** A draft from a payload, checked like a stored one; null when it is not a payload. */
export function fromPayload(value: unknown): TrainingDraft | null {
  if (!Array.isArray(value) || value[0] !== VERSION || value.length < 8) return null
  const [, title, bpmMin, bpmMax, loudness, beats, onset, bars, repeats, description] =
    value as unknown[]
  const flat = Array.isArray(repeats) ? repeats : []
  return parseDraft({
    title,
    description,
    bpmRange: bpmMin && bpmMax ? { min: bpmMin, max: bpmMax } : null,
    loudness: typeof loudness === 'number' ? LOUDNESS_ZONES[loudness]?.zone : null,
    beats,
    onset: typeof onset === 'number' ? ONSETS[onset]?.onset : undefined,
    bars: Array.isArray(bars)
      ? bars.map((notes) => ({
          notes: Array.isArray(notes)
            ? notes.filter((code) => Number.isInteger(code) && code >= 0).map(unpackNote)
            : [],
        }))
      : [],
    repeats: Array.from({ length: Math.floor(flat.length / 3) }, (_, index) => ({
      from: flat[index * 3],
      to: flat[index * 3 + 1],
      times: flat[index * 3 + 2],
    })),
    current: [],
  })
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(piped).arrayBuffer())
}

const canDeflate = typeof CompressionStream !== 'undefined'

/** The training as the `d` parameter of a link. */
export async function encodeTraining(draft: TrainingDraft): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(toPayload(draft)))
  if (!canDeflate) return `j${toBase64Url(bytes)}`
  return `z${toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))}`
}

/** The training from a link's `d` parameter; null when it is broken or not a training. */
export async function decodeTraining(encoded: string): Promise<TrainingDraft | null> {
  try {
    const kind = encoded[0]
    let bytes = fromBase64Url(encoded.slice(1))
    if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'))
    else if (kind !== 'j') return null
    return fromPayload(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}
