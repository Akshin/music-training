import { onScopeDispose, watch, type Ref } from 'vue'
import { BeatGrid } from '@audio-core/core/clock/beat-grid'
import type { MapPosition } from '@audio-core/core/clock/tempo-map'
import { WebTransport } from '@audio-core/host/web/web-transport'
import { meterFor } from '@/training/tempo'

/** Musical position the trainee is hearing right now, or `null` while the metronome is silent. */
export type MetronomeClock = () => MapPosition | null

/**
 * Metronome for a training screen on audio-core's lookahead transport.
 *
 * Starts and stops with `playing`, follows tempo and meter without restarting, and returns a clock
 * on the audio timeline so visuals can change on the beat that is actually heard.
 */
export function useMetronome(
  playing: Ref<boolean>,
  bpm: Ref<number>,
  beats: Ref<number>,
): MetronomeClock {
  let context: AudioContext | null = null
  let transport: WebTransport | null = null

  async function start(): Promise<void> {
    context ??= new AudioContext({ latencyHint: 'interactive' })
    transport ??= new WebTransport(context)
    await transport.start({ grid: new BeatGrid({ bpm: bpm.value, meter: meterFor(beats.value) }) })
    // Stopped again while the context was resuming.
    if (!playing.value) transport.stop()
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

  onScopeDispose(() => {
    transport?.stop()
    void context?.close()
  })

  return () => {
    if (context === null || transport === null || !transport.running) return null
    return transport.positionAt(audibleTime(context)) ?? null
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
