import { onScopeDispose, watch, type Ref } from 'vue'
import { BeatGrid } from '@audio-core/core/clock/beat-grid'
import type { MapPosition } from '@audio-core/core/clock/tempo-map'
import type { NoteEvent } from '@audio-core/core/model/note'
import { WebLoop } from '@audio-core/host/web/web-loop'
import { WebTransport } from '@audio-core/host/web/web-transport'
import { meterFor } from '@/training/tempo'

/** Musical position the trainee is hearing right now, or `null` while the transport is stopped. */
export type TrainingClock = () => MapPosition | null

export interface TrainingSoundOptions {
  readonly playing: Ref<boolean>
  readonly bpm: Ref<number>
  readonly beats: Ref<number>
  /** Audible clicks; the clock keeps running without them. */
  readonly clicks: Ref<boolean>
  /** URL of the recording to loop under the training (a backing pad), or `null` for none. */
  readonly backing: Readonly<Ref<string | null>>
}

export interface TrainingSound {
  readonly clock: TrainingClock
  /** Reference notes to play along the clicks, their beats counted within tempo-map `epoch`. */
  setNotes(notes: readonly NoteEvent[], epoch: number): void
}

/** Encoded backing files kept in memory (a few MB each); decoded audio is kept for one only. */
const FETCHED_LIMIT = 2

/**
 * Sound of a training screen on audio-core: clicks and a reference melody on the lookahead
 * transport, and a looped backing pad on the same AudioContext.
 *
 * Starts and stops with `playing`, follows tempo and meter without restarting, and returns a clock
 * on the audio timeline so visuals can change on the beat that is actually heard.
 */
export function useTrainingSound({
  playing,
  bpm,
  beats,
  clicks,
  backing,
}: TrainingSoundOptions): TrainingSound {
  let context: AudioContext | null = null
  let transport: WebTransport | null = null
  let loop: WebLoop | null = null
  let notes: readonly NoteEvent[] = []
  let notesEpoch = 0
  const fetched = new Map<string, Promise<ArrayBuffer>>()
  let decoded: { url: string; buffer: AudioBuffer } | null = null
  let backingRun = 0

  async function start(): Promise<void> {
    context ??= new AudioContext({ latencyHint: 'interactive' })
    transport ??= new WebTransport(context)
    loop ??= new WebLoop(context)
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
    void syncBacking()
  }

  function fetchTrack(url: string): Promise<ArrayBuffer> {
    const known = fetched.get(url)
    if (known !== undefined) return known
    const data = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Backing track ${url}: HTTP ${response.status}`)
      return response.arrayBuffer()
    })
    data.catch(() => fetched.delete(url))
    fetched.set(url, data)
    for (const other of fetched.keys()) {
      if (fetched.size > FETCHED_LIMIT && other !== url) fetched.delete(other)
    }
    return data
  }

  /** Bring the pad in line with `playing` and `backing`; a later call supersedes an earlier one. */
  async function syncBacking(): Promise<void> {
    const run = ++backingRun
    const pad = loop
    if (pad === null) return
    const running = transport?.running === true ? transport : null
    const url = playing.value ? backing.value : null
    if (running === null || url === null) {
      pad.stop()
      return
    }
    try {
      const track =
        decoded?.url === url ? decoded : { url, buffer: await pad.decode(await fetchTrack(url)) }
      if (run !== backingRun) return
      decoded = track
      if (pad.buffer !== track.buffer) pad.play(track.buffer, running.audioOrigin)
    } catch (error) {
      console.error('Backing track failed', error)
    }
  }

  // Sync flush keeps the AudioContext inside the Play click, where autoplay policies allow sound.
  watch(
    playing,
    (on) => {
      if (!on) {
        transport?.stop()
        void syncBacking()
        return
      }
      start().catch((error: unknown) => {
        console.error('Training sound failed to start', error)
        playing.value = false
      })
    },
    { flush: 'sync' },
  )

  watch([bpm, beats], ([nextBpm, nextBeats]) => {
    if (transport?.running) transport.retime({ bpm: nextBpm, meter: meterFor(nextBeats) })
  })

  watch(clicks, (on) => transport?.setMetronome(on))

  // Download the chosen pad ahead of Play; decoding waits for the AudioContext.
  watch(
    backing,
    (url) => {
      if (url !== null) void fetchTrack(url)
      void syncBacking()
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    transport?.stop()
    loop?.stop()
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
