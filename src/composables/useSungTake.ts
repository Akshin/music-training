import { onScopeDispose, ref, watch } from 'vue'
import { quantizeNotes, type GridNote } from '@audio-core/core/index'
import type { ExerciseSession, GridAnchor } from '@/composables/useExerciseSession'

export type SungTakeState = 'idle' | 'starting' | 'counting' | 'singing' | 'reading'

export interface SungTakeOptions {
  /** Grid step the notes snap to, in beats of the meter, read when the take ends. */
  readonly stepBeats: () => number
}

/** What was sung in a take, on the grid it was sung to. */
export interface SungTake {
  /** Notes in whole steps of the grid, in time order. */
  readonly notes: readonly GridNote[]
  /** The step the first bar after the count-in starts on. */
  readonly firstStep: number
  readonly beatsPerBar: number
  /** Notes faster than the grid step that found no step of their own. */
  readonly dropped: number
}

/** Where the take is, as the singer counts it: bar and beat from 1. */
export interface SungTakePosition {
  readonly bar: number
  readonly beat: number
}

/** Bars of clicks before the take. */
const COUNT_IN_BARS = 1
/** Frames read around the take, seconds each side, so a note at its edge is heard whole. */
const MARGIN_SECONDS = 0.5

/**
 * Singing notes in instead of typing them: a bar of clicks, then the singer sings to the metronome
 * until `finish`, and what was sung comes back as notes on the grid — snapped to the step, tuned
 * to the tempered scale, slides kept. The session must listen (`listen: true`); its tempo and
 * meter have to hold from `start` to `finish`.
 */
export function useSungTake(session: ExerciseSession, options: SungTakeOptions) {
  const state = ref<SungTakeState>('idle')
  /** Bar and beat being sung; during the count-in, the beat of it. */
  const position = ref<SungTakePosition | null>(null)
  let raf = 0
  let run = 0

  function follow(): void {
    const clock = session.clock()
    if (clock !== null && (state.value === 'starting' || state.value === 'counting')) {
      state.value = clock.bar < COUNT_IN_BARS ? 'counting' : 'singing'
    }
    if (clock !== null && clock.bar >= 0) {
      const bar = Math.max(1, clock.bar - COUNT_IN_BARS + 1)
      const beat = clock.beat + 1
      if (position.value?.bar !== bar || position.value.beat !== beat)
        position.value = { bar, beat }
    }
    raf = requestAnimationFrame(follow)
  }

  function reset(): void {
    run++
    cancelAnimationFrame(raf)
    raf = 0
    position.value = null
    state.value = 'idle'
  }

  /** Start the count-in; call it from a click, where the microphone and sound may start. */
  function start(): void {
    if (state.value !== 'idle') return
    run++
    state.value = 'starting'
    session.playing.value = true
    raf = requestAnimationFrame(follow)
  }

  /** Drop the take. */
  function cancel(): void {
    if (state.value === 'idle') return
    reset()
    session.playing.value = false
    void session.stopListening()
  }

  /**
   * End the take and read it. Null when there was nothing to read: it was ended during the
   * count-in, or dropped while it was being read.
   */
  async function finish(): Promise<SungTake | null> {
    if (state.value !== 'counting' && state.value !== 'singing') {
      cancel()
      return null
    }
    const anchor = session.gridAnchor()
    const current = ++run
    cancelAnimationFrame(raf)
    state.value = 'reading'
    session.playing.value = false
    // Analysis runs behind the sound: read once it has caught up with the end of the take.
    if (anchor !== null) await session.notesReady(endOf(anchor) + anchor.offset)
    if (current !== run) return null

    let take: SungTake | null = null
    if (anchor !== null) {
      const { position: at, offset } = anchor
      const { grid } = at
      const beatsPerBar = grid.meter.beatsPerBar
      const stepBeats = options.stepBeats()
      const fromBeat = COUNT_IN_BARS * beatsPerBar
      const toBeat = grid.secondsToBeat(endOf(anchor))
      const sung =
        toBeat > fromBeat
          ? session.sungBetween(
              grid.beatToSeconds(fromBeat) + offset - MARGIN_SECONDS,
              grid.beatToSeconds(toBeat) + offset + MARGIN_SECONDS,
            )
          : null
      if (sung !== null) {
        const { notes, dropped } = quantizeNotes(sung.notes, sung.slides, grid, {
          stepBeats,
          latencySeconds: offset,
          fromBeat,
          toBeat,
        })
        take = {
          notes,
          firstStep: Math.round(fromBeat / stepBeats),
          beatsPerBar,
          dropped: dropped.length,
        }
      }
    }
    reset()
    void session.stopListening()
    return take
  }

  // Playback that stops by itself — the microphone was refused, the sound failed — ends the take.
  watch(session.playing, (on) => {
    if (!on && state.value !== 'idle' && state.value !== 'reading') cancel()
  })

  onScopeDispose(() => {
    run++
    cancelAnimationFrame(raf)
  })

  return { state, position, start, finish, cancel }
}

/** Where the listener was on the grid when the take ended, seconds of the grid. */
function endOf({ position }: GridAnchor): number {
  const { grid, bar, beat, phase } = position
  return grid.beatToSeconds(bar * grid.meter.beatsPerBar + beat + phase)
}

export type SungTakeControl = ReturnType<typeof useSungTake>
