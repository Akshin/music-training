import type { TonalKey } from '@/training/keys'

/** Shared settings an exercise starts with; anything left out takes the app default. */
export interface ExerciseDefaults {
  readonly bpm?: number
  readonly beats?: number
  readonly metronome?: boolean
  readonly key?: TonalKey
  readonly backing?: boolean
}

/**
 * What an exercise is, as data: its title, where the shared settings start and whether it listens
 * to the microphone. Its own logic — what the reference plays, which notes are targets and when, how
 * an attempt is judged — lives next to its screen and talks to the session.
 */
export interface ExerciseDefinition {
  readonly title: string
  readonly defaults?: ExerciseDefaults
  /** Capture and analyse the microphone while playing: pitch, loudness, scoring. */
  readonly listen?: boolean
}

/** The lab: shared settings and Play to try controls against live data, no exercise of its own. */
export const SANDBOX: ExerciseDefinition = {
  title: 'Лаборатория',
}

export const TETRACHORDS: ExerciseDefinition = {
  title: 'Тетрахорды',
}

/** Camera only: the mouth figure follows the face, no sound. */
export const MOUTH_OPENING: ExerciseDefinition = {
  title: 'Открываем рот',
}
