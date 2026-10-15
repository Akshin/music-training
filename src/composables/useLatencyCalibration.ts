import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { pcmOnsets } from '@audio-core/core/index'
import { useExerciseSession, type SessionDelays } from '@/composables/useExerciseSession'
import { useLatency } from '@/composables/useLatency'
import {
  LATENCY_BPM,
  LATENCY_CLICKS,
  measureRoundTrip,
  roundTripFault,
  type RoundTrip,
  type RoundTripFault,
} from '@/training/latency'

export type LatencyRunState = 'idle' | 'starting' | 'listening' | 'reading'

/** What a run came to. */
export interface LatencyRun {
  readonly trip: RoundTrip | null
  /** Why it cannot be trusted; null when it was stored. */
  readonly fault: RoundTripFault | null
  /** The devices it was measured on (`deviceKey`). */
  readonly device: string | null
  /** The delays of the analysis on those devices. */
  readonly delays: SessionDelays | null
}

/** Beat 0 is not measured: the transport has only just started. */
const FIRST_CLICK = 1
/** Sound listened to after the last click, beats: a late click still has to come back. */
const TAIL_BEATS = 0.6

/**
 * Measuring the latency of this browser's input and output: eight clicks are played, found in the
 * microphone's samples, and how late they came back beyond what the browser reports is stored for
 * these devices (`useLatency`), so every session counts it from then on. It brings its own session,
 * which records what the microphone hears for as long as the run lasts.
 */
export function useLatencyCalibration() {
  const session = useExerciseSession({
    bpm: ref(LATENCY_BPM),
    beats: ref(4),
    listen: true,
    record: true,
  })
  const { saveLatency } = useLatency()
  const state = ref<LatencyRunState>('idle')
  /** Clicks played so far in this run. */
  const played = ref(0)
  const last = shallowRef<LatencyRun | null>(null)
  let raf = 0
  let run = 0

  function follow(): void {
    const clock = session.clock()
    if (clock !== null) {
      state.value = 'listening'
      const beat = clock.bar * clock.grid.meter.beatsPerBar + clock.beat + clock.phase
      played.value = Math.min(LATENCY_CLICKS, Math.max(0, Math.floor(beat) - FIRST_CLICK + 1))
      if (beat >= FIRST_CLICK + LATENCY_CLICKS - 1 + TAIL_BEATS) {
        void read()
        return
      }
    }
    raf = requestAnimationFrame(follow)
  }

  function stop(): void {
    run++
    cancelAnimationFrame(raf)
    session.playing.value = false
    void session.stopListening()
    played.value = 0
    state.value = 'idle'
  }

  /** Start the clicks; call it from a click, where sound and the microphone may start. */
  function start(): void {
    if (state.value !== 'idle') return
    run++
    last.value = null
    state.value = 'starting'
    session.playing.value = true
    raf = requestAnimationFrame(follow)
  }

  async function read(): Promise<void> {
    const anchor = session.gridAnchor()
    const rate = session.input.value?.sampleRate
    const current = run
    state.value = 'reading'
    session.playing.value = false
    if (anchor === null || rate === undefined) {
      stop()
      return
    }
    // Expected where the browser alone says the clicks come back: without what was measured before.
    const { grid } = anchor.position
    const reported = anchor.offset - anchor.measured
    const expected = Array.from(
      { length: LATENCY_CLICKS },
      (_, i) => grid.beatToSeconds(FIRST_CLICK + i) + reported,
    )
    const reach = grid.secondsPerBeat / 2
    const lastClick = expected[expected.length - 1]!
    await session.notesReady(lastClick + reach)
    const recorded = await session.samplesBetween(expected[0]! - reach, lastClick + reach)
    if (current !== run) return

    const onsets = recorded
      ? pcmOnsets(recorded.samples, rate).map((at) => at + recorded.start)
      : []
    const trip = measureRoundTrip(expected, onsets)
    const fault = roundTripFault(trip)
    const device = session.device.value
    if (fault === null && trip !== null && device !== null) saveLatency(device, trip.seconds)
    last.value = { trip, fault, device, delays: session.delays.value }
    stop()
  }

  // Playback that stops by itself — the microphone was refused, the sound failed — ends the run.
  watch(session.playing, (on) => {
    if (!on && (state.value === 'starting' || state.value === 'listening')) stop()
  })

  onScopeDispose(() => {
    run++
    cancelAnimationFrame(raf)
  })

  return {
    state,
    played,
    /** The last run's outcome. */
    last,
    error: session.error,
    start,
    cancel: stop,
  }
}
