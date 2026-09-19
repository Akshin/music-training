import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { PitchTrace } from '@/components/pitch/trace'
import type { ExerciseSession } from '@/composables/useExerciseSession'
import type { LoudnessZone } from '@/training/builder'
import {
  PITCH_TOLERANCE_CENTS,
  RHYTHM_TOLERANCE_SECONDS,
  inLoudnessZone,
  judgeNote,
  passOf,
  runBarNotes,
  summarize,
  type NoteResult,
  type PassSummary,
  type RunPlan,
} from '@/training/customRun'

export interface TrainingScoreOptions {
  readonly session: ExerciseSession
  readonly plan: RunPlan
  /** Loudness the training asks for; null leaves loudness unjudged. */
  readonly loudness: LoudnessZone | null
  /** Bar of the training across passes, −1 while counting in or stopped. */
  readonly sequence: Readonly<Ref<number>>
  /** Tempo-map epoch the bars are counted in. */
  readonly epoch: Readonly<Ref<number>>
}

/** Wait after a bar ends before scoring it: analysis runs a little behind the sound. */
const SCORE_DELAY_MS = 450
/** How far a sung onset may sit from its note and still be matched to it, seconds. */
const MATCH_WINDOW_SECONDS = 0.35
/** Passes kept in the summary list. */
const PASSES_KEPT = 6

/**
 * Judging a built training as it is sung: when a bar ends, each of its notes is scored for pitch,
 * timing and — if the training sets a zone — loudness; when a pass ends, it is summed up. Results
 * start over with every Play.
 */
export function useTrainingScore(options: TrainingScoreOptions) {
  const { session, plan, loudness, sequence, epoch } = options
  const results = ref<NoteResult[]>([])
  const passes = ref<PassSummary[]>([])
  const timers = new Set<number>()

  function clearTimers(): void {
    for (const timer of timers) window.clearTimeout(timer)
    timers.clear()
  }

  watch(session.playing, (on) => {
    clearTimers()
    if (on) {
      results.value = []
      passes.value = []
    }
  })

  // A bar is scored once the next one starts, a little later so its last frames are analysed.
  watch([sequence, epoch], ([next, nextEpoch], [previous, previousEpoch]) => {
    if (!session.playing.value || nextEpoch !== previousEpoch) return
    if (next !== previous + 1 || previous < 0) return
    const timer = window.setTimeout(() => {
      timers.delete(timer)
      scoreBar(previous, nextEpoch)
    }, SCORE_DELAY_MS)
    timers.add(timer)
  })

  function scoreBar(bar: number, barEpoch: number): void {
    const targets = runBarNotes(plan, bar)
    const grid = session.clock()?.grid
    const take =
      targets.length > 0
        ? session.scoreNotes(targets, barEpoch, {
            pitchToleranceCents: PITCH_TOLERANCE_CENTS,
            rhythmToleranceSeconds: RHYTHM_TOLERANCE_SECONDS,
            matchWindowSeconds: MATCH_WINDOW_SECONDS,
          })
        : null
    const judged = targets.map((target, index) => {
      const sung = take?.notes[index]
      let level: number | null = null
      if (grid !== undefined && loudness !== null) {
        const from = session.traceTimeOf(grid.beatToSeconds(target.startBeat))
        const to = session.traceTimeOf(grid.beatToSeconds(target.startBeat + target.durationBeats))
        if (from !== null && to !== null) level = meanLevel(session.pitch.value, from, to)
      }
      return judgeNote(
        bar,
        target.midi,
        sung?.pitch?.cents ?? null,
        sung?.rhythm?.offsetSeconds ?? null,
        inLoudnessZone(loudness, level),
      )
    })

    const pass = passOf(plan, bar)
    // Only this pass and the one before are needed: the dots and the pass that just ended.
    results.value = [...results.value, ...judged].filter(
      (result) => passOf(plan, result.sequence) >= pass - 1,
    )
    if (bar % plan.bars === plan.bars - 1) {
      const ofPass = results.value.filter((result) => passOf(plan, result.sequence) === pass)
      passes.value = [summarize(pass, ofPass, loudness !== null), ...passes.value].slice(
        0,
        PASSES_KEPT,
      )
    }
  }

  onScopeDispose(clearTimers)

  return {
    /** Notes judged so far in this pass and the one before, oldest first. */
    results,
    /** Finished passes, newest first. */
    passes,
    /** Notes judged in the pass being sung. */
    currentPass: computed(() =>
      sequence.value < 0
        ? []
        : results.value.filter(
            (result) => passOf(plan, result.sequence) === passOf(plan, sequence.value),
          ),
    ),
    /** The note judged last. */
    last: computed(() => results.value.at(-1) ?? null),
  }
}

/** Mean loudness of the frames with a pitch between two moments on the trace clock. */
function meanLevel(trace: PitchTrace, from: number, to: number): number | null {
  let sum = 0
  let count = 0
  for (let i = 0; i < trace.length; i++) {
    const time = trace.endTime - (trace.length - 1 - i) / trace.frameRate
    if (time < from || time > to) continue
    const midi = trace.midi[i]
    if (midi === undefined || !Number.isFinite(midi)) continue
    sum += trace.level[i] ?? 0
    count++
  }
  return count === 0 ? null : sum / count
}
