import { onScopeDispose, watch, type Ref } from 'vue'
import { BeatGrid } from '@audio-core/core/clock/beat-grid'
import type { MapPosition } from '@audio-core/core/clock/tempo-map'
import type { NoteEvent } from '@audio-core/core/model/note'
import { WebTransport } from '@audio-core/host/web/web-transport'
import { meterFor } from '@/training/tempo'

/** Musical position the trainee is hearing right now, or `null` while the transport is stopped. */
export type MetronomeClock = () => MapPosition | null

export interface MetronomeOptions {
  readonly playing: Ref<boolean>
  readonly bpm: Ref<number>
  readonly beats: Ref<number>
  /** Audible clicks; the clock keeps running without them. */
  readonly clicks: Ref<boolean>
}

export interface Metronome {
  readonly clock: MetronomeClock
  /** Reference notes to play along the clicks, their beats counted within tempo-map `epoch`. */
  setNotes(notes: readonly NoteEvent[], epoch: number): void
}

/**
 * Sound of a training screen on audio-core's lookahead transport: clicks and a reference melody on
 * one grid.
 *
 * Starts and stops with `playing`, follows tempo and meter without restarting, and returns a clock
 * on the audio timeline so visuals can change on the beat that is actually heard.
 */
export function useMetronome({ playing, bpm, beats, clicks }: MetronomeOptions): Metronome {
  let context: AudioContext | null = null
  let transport: WebTransport | null = null
  let notes: readonly NoteEvent[] = []
  let notesEpoch = 0

  async function start(): Promise<void> {
    context ??= new AudioContext({ latencyHint: 'interactive' })
    transport ??= new WebTransport(context)
    await transport.start({
      grid: new BeatGrid({ bpm: bpm.value, meter: meterFor(beats.value) }),
      metronome: clicks.value,
    })
    // Stopped again while the context was resuming.
    if (!playing.value) {
      transport.stop()
      return
    }
    // Notes set while the context was resuming; beat 0 is still ahead, so they start on time.
    transport.setNotes(notes, notesEpoch)
  }

  // Sync flush keeps the AudioContext inside the Play click, where autoplay policies allow sound.
  watch(
    playing,
    (on) => {
      if (!on) {
        transport?.stop()
        return
      }
      start().catch((error: unknown) => {
        console.error('Metronome failed to start', error)
        playing.value = false
      })
    },
    { flush: 'sync' },
  )

  watch([bpm, beats], ([nextBpm, nextBeats]) => {
    if (transport?.running) transport.retime({ bpm: nextBpm, meter: meterFor(nextBeats) })
  })

  watch(clicks, (on) => transport?.setMetronome(on))

  onScopeDispose(() => {
    transport?.stop()
    void context?.close()
  })

  return {
    clock: () => {
      if (context === null || transport === null || !transport.running) return null
      return transport.positionAt(audibleTime(context)) ?? null
    },
    setNotes(next, epoch) {
      notes = next
      notesEpoch = epoch
      if (transport?.running) transport.setNotes(next, epoch)
    },
  }
}

/** The context time now reaching the speakers; `currentTime` runs ahead by the output latency. */
function audibleTime(context: AudioContext): number {
  const { contextTime, performanceTime } = context.getOutputTimestamp()
  if (contextTime === undefined || performanceTime === undefined || performanceTime === 0) {
    return context.currentTime - (context.outputLatency || 0)
  }
  return contextTime + (performance.now() - performanceTime) / 1000
}
