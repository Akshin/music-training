import { modeDegreeOffsets } from '@/training/fretboard'
import type { ModePattern } from '@/training/patterns'
import type { TabInstrument } from '@/training/tabs'
import type { Meter } from '@/training/tempo'

/** C4, middle C: the piano helper's tonic and the default when no helper is shown. */
export const MELODY_ROOT = 60
/** E4: the tonic the guitar tab marks (the tab is built from the low E string). */
export const MELODY_ROOT_GUITAR = 64

/** What should sound while a training plays: the running cycle and the one after it. */
export type CyclePlan = {
  /** Tempo-map epoch the bars count in; a meter change starts a new one. */
  epoch: number
  meter: Meter
  cycles: readonly { startBar: number; bars: number; mode: ModePattern }[]
}

export type MelodyNote = {
  midi: number
  startBeat: number
  durationBeats: number
  velocity: number
}

/** The tonic the chosen helper shows, so the melody matches the tab or the keys on screen. */
export function melodyRoot(instrument: TabInstrument): number {
  return instrument === 'guitar' ? MELODY_ROOT_GUITAR : MELODY_ROOT
}

/** Eight MIDI pitches of the mode from `root`: lower tetrachord, ТС, upper tetrachord. */
export function modePitches(mode: ModePattern, root: number): number[] {
  return modeDegreeOffsets(mode).map((degree) => root + degree.semitone)
}

/**
 * Each cycle's mode as a running scale in eighth notes — up to the octave and back down — starting
 * on the cycle's downbeat. Eighths keep every note on the grid: two per quarter beat, one per beat
 * of 6/8. Downbeats are a touch louder; the levels leave headroom for the clicks on top.
 */
export function planMelody(plan: CyclePlan, root: number): MelodyNote[] {
  const { beatsPerBar, beatUnit } = plan.meter
  const perBeat = Math.max(1, Math.round(8 / beatUnit))
  const perBar = beatsPerBar * perBeat
  const step = 1 / perBeat
  const notes: MelodyNote[] = []
  for (const cycle of plan.cycles) {
    const pitches = modePitches(cycle.mode, root)
    const startBeat = cycle.startBar * beatsPerBar
    for (let i = 0; i < cycle.bars * perBar; i++) {
      const midi = pitches[scaleIndex(i, pitches.length)]
      if (midi === undefined) continue
      notes.push({
        midi,
        startBeat: startBeat + i * step,
        durationBeats: step * 0.9,
        velocity: i % perBar === 0 ? 0.36 : 0.3,
      })
    }
  }
  return notes
}

/** 0, 1, … n-1, n-2, … 1, 0, 1, … — up and back without repeating the turning notes. */
function scaleIndex(i: number, n: number): number {
  const period = 2 * (n - 1)
  const k = i % period
  return k < n ? k : period - k
}
