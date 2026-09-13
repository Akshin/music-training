import { viaForPitchClass, modeDegreeOffsets } from '@/training/fretboard'
import type { IntervalKind, ModePattern } from '@/training/patterns'

export type TabInstrument = 'off' | 'guitar' | 'piano'

export const TAB_INSTRUMENT_DEFAULT: TabInstrument = 'off'

export const TAB_INSTRUMENTS: readonly { id: TabInstrument; label: string }[] = [
  { id: 'off', label: 'Нет' },
  { id: 'guitar', label: 'Гитара' },
  { id: 'piano', label: 'Пианино' },
] as const

export function tabInstrumentLabel(id: TabInstrument): string {
  return TAB_INSTRUMENTS.find((entry) => entry.id === id)?.label ?? 'Нет'
}

export type PianoKey = {
  pc: number
  isBlack: boolean
  /** White-key index 0–7 (C through C). */
  afterWhite: number
  active: boolean
  via: IntervalKind
}

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11, 12] as const

const BLACK_KEYS: readonly { pc: number; afterWhite: number }[] = [
  { pc: 1, afterWhite: 0 },
  { pc: 3, afterWhite: 1 },
  { pc: 6, afterWhite: 3 },
  { pc: 8, afterWhite: 4 },
  { pc: 10, afterWhite: 5 },
]

function isModePitch(pc: number, mode: ModePattern): boolean {
  const wrapped = ((pc % 12) + 12) % 12
  return modeDegreeOffsets(mode).some(
    (entry) => ((entry.semitone % 12) + 12) % 12 === wrapped,
  )
}

/** The octave C–C with the mode built on `tonic` (pitch class, C = 0) marked on it. */
export function layoutPianoKeys(
  mode: ModePattern,
  tonic = 0,
): {
  whites: PianoKey[]
  blacks: PianoKey[]
} {
  const fromTonic = (pc: number) => (((pc - tonic) % 12) + 12) % 12

  const whites = WHITE_PCS.map((pc, afterWhite) => {
    const active = isModePitch(fromTonic(pc), mode)
    return {
      pc,
      isBlack: false,
      afterWhite,
      active,
      via: viaForPitchClass(fromTonic(pc), mode).via,
    }
  })

  const blacks = BLACK_KEYS.map((entry) => {
    const active = isModePitch(fromTonic(entry.pc), mode)
    return {
      pc: entry.pc,
      isBlack: true,
      afterWhite: entry.afterWhite,
      active,
      via: viaForPitchClass(fromTonic(entry.pc), mode).via,
    }
  })

  return { whites, blacks }
}
