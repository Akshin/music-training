import type { IntervalKind, ModePattern } from '@/training/patterns'

/** Low E → high E, semitones above low-E open. */
export const STRING_SEMITONES = [0, 5, 10, 15, 19, 24] as const

/** First position: index through pinky. */
export const FIRST_POSITION_MIN = 1
export const FIRST_POSITION_MAX = 4

export type FretMark = {
  /** 0 = low E, 5 = high E. */
  string: number
  fret: number
  degree: number
  isTonic: boolean
  /** Interval that lands on this degree. */
  via: IntervalKind
}

function intervalSemitones(kind: IntervalKind): number {
  return kind === 'semitone' ? 1 : 2
}

export function modeDegreeOffsets(
  mode: ModePattern,
): { degree: number; semitone: number; via: IntervalKind | null }[] {
  const steps: IntervalKind[] = [...mode.first, 'tc', ...mode.second]
  const out: { degree: number; semitone: number; via: IntervalKind | null }[] = [
    { degree: 1, semitone: 0, via: null },
  ]
  let pitch = 0
  steps.forEach((kind, index) => {
    pitch += intervalSemitones(kind)
    out.push({ degree: index + 2, semitone: pitch, via: kind })
  })
  return out
}

export function viaForPitchClass(pc: number, mode: ModePattern): { via: IntervalKind; degree: number } {
  const degrees = modeDegreeOffsets(mode)
  const hits = degrees.filter((entry) => ((entry.semitone % 12) + 12) % 12 === pc)
  const arriving = [...hits].reverse().find((entry) => entry.via !== null)
  if (arriving?.via) {
    return { via: arriving.via, degree: arriving.degree }
  }
  const last = mode.second[2] ?? 'tone'
  return { via: last, degree: 1 }
}

/** Pitch class of the open low E string, C = 0. */
const LOW_E_PITCH_CLASS = 4

/**
 * Every mode note that sits in first position (frets 1–4) on every string, for the mode built on
 * `tonic` (pitch class, C = 0; E by default). Open strings stay off the grid so the box stays four
 * cells.
 */
export function layoutModeMarks(
  mode: ModePattern,
  tonic = LOW_E_PITCH_CLASS,
): { marks: FretMark[]; fretSpan: number } {
  const marks: FretMark[] = []

  for (let string = 0; string < STRING_SEMITONES.length; string++) {
    const open = STRING_SEMITONES[string]
    if (open === undefined) continue
    for (let fret = FIRST_POSITION_MIN; fret <= FIRST_POSITION_MAX; fret++) {
      // Semitones above the tonic.
      const pitch = LOW_E_PITCH_CLASS + open + fret - tonic
      const pc = ((pitch % 12) + 12) % 12
      const inMode = modeDegreeOffsets(mode).some(
        (entry) => ((entry.semitone % 12) + 12) % 12 === pc,
      )
      if (!inMode) continue
      const { via, degree } = viaForPitchClass(pc, mode)
      marks.push({
        string,
        fret,
        degree,
        isTonic: pc === 0,
        via,
      })
    }
  }

  return { marks, fretSpan: FIRST_POSITION_MAX }
}
