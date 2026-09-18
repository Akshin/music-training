import { onScopeDispose, readonly, ref, shallowRef, watch, type Ref } from 'vue'
import {
  BeatGrid,
  scoreTake,
  segmentTake,
  type MapPosition,
  type NoteEvent,
  type ScoreOptions,
  type TakeScore,
} from '@audio-core/core/index'
import { WebLoop } from '@audio-core/host/web/web-loop'
import { WebTransport } from '@audio-core/host/web/web-transport'
import { WorkerHost } from '@audio-core/host/web/worker-host'
import { MicSource } from '@audio-core/io/mic-source'
import { EMPTY_PITCH_TRACE, type PitchTrace } from '@/components/pitch/trace'
import { BEATS_DEFAULT, BPM_DEFAULT, meterFor } from '@/training/tempo'
import type { Timbre } from '@/training/timbre'

/** Musical position the listener hears right now, or `null` while the transport is stopped. */
export type TrainingClock = () => MapPosition | null

export type MicState = 'idle' | 'starting' | 'running'

export interface ExerciseSessionOptions {
  readonly bpm?: Ref<number>
  readonly beats?: Ref<number>
  /** Audible clicks; the clock keeps running without them. */
  readonly clicks?: Ref<boolean>
  /** URL of the recording to loop under the exercise (a backing pad), or `null` for none. */
  readonly backing?: Readonly<Ref<string | null>>
  /** Open the microphone when playing starts; playback waits for it so the first bars are heard. */
  readonly listen?: boolean
}

/** dBFS at the bottom of a meter; anything quieter reads as empty. */
const FLOOR_DB = -60
/** Seconds the meter level takes to fall from full to empty once the sound stops. Rises are instant. */
const RELEASE_SECONDS = 1.5
/** Seconds of frames kept for pitch charts. */
const TRACE_SECONDS = 10
/** Frames quieter than this carry no pitch: the tracker still finds periodicity in room noise. */
const PITCH_FLOOR_DB = -55
/** Frames taken around the targets when scoring, seconds each side. */
const SCORE_MARGIN_SECONDS = 0.5
/** Frames averaged into the harmonic levels (80 ms): single frames jitter by a few dB. */
const TIMBRE_FRAMES = 8
/** Encoded backing files kept in memory (a few MB each); decoded audio is kept for one only. */
const FETCHED_LIMIT = 2

/**
 * Everything an exercise hears and plays, on one AudioContext and one clock.
 *
 * Playback — metronome, reference notes, backing pad — runs on audio-core's lookahead transport and
 * starts and stops with `playing`, following tempo and meter without restarting. The microphone runs
 * on the same context: its PCM goes straight to the analysis worker (`level`, `pitch` with pYIN, `harmonics`) and
 * every animation frame copies the newest frames out as a meter level and a pitch trace. Because
 * both share the context, a moment on the playback grid maps onto the trace clock
 * (`traceTimeOf`), which is what `scoreNotes` needs to judge pitch and timing. Start either part from
 * a user gesture.
 */
export function useExerciseSession(options: ExerciseSessionOptions = {}) {
  const bpm = options.bpm ?? ref(BPM_DEFAULT)
  const beats = options.beats ?? ref(BEATS_DEFAULT)
  const clicks = options.clicks ?? ref(true)
  const backing = options.backing ?? ref<string | null>(null)

  const playing = ref(false)
  const micState = ref<MicState>('idle')
  const error = ref<string | null>(null)
  const level = ref(0)
  const pitch = shallowRef<PitchTrace>(EMPTY_PITCH_TRACE)
  const timbre = shallowRef<Timbre | null>(null)

  let context: AudioContext | null = null
  let transport: WebTransport | null = null
  let loop: WebLoop | null = null
  let playRun = 0
  let notes: readonly NoteEvent[] = []
  let notesEpoch = 0

  let mic: MicSource | null = null
  let host: WorkerHost | null = null
  let micStarting: Promise<void> | null = null
  let micRun = 0
  /** AudioContext time of capture sample 0 — the zero of the trace clock. */
  let captureOrigin = 0
  let raf = 0
  let shown = 0
  let lastFrame = 0
  let midiFrames = new Float32Array(0)
  let loudFrames = new Float32Array(0)
  const harmonicFrames = [0, 1, 2].map(() => new Float32Array(TIMBRE_FRAMES))

  const fetched = new Map<string, Promise<ArrayBuffer>>()
  let decoded: { url: string; buffer: AudioBuffer } | null = null
  let backingRun = 0

  /** Created on first use — inside a user gesture — and shared by playback and capture. */
  function audioContext(): AudioContext {
    context ??= new AudioContext({ latencyHint: 'interactive' })
    return context
  }

  async function begin(): Promise<void> {
    const run = ++playRun
    const ctx = audioContext()
    const player = (transport ??= new WebTransport(ctx))
    loop ??= new WebLoop(ctx)
    if (options.listen === true) await startListening()
    if (run !== playRun) return
    await player.start({
      grid: new BeatGrid({ bpm: bpm.value, meter: meterFor(beats.value) }),
      metronome: clicks.value,
    })
    // Stopped again while the context or the microphone was starting.
    if (run !== playRun) {
      player.stop()
      return
    }
    // Notes set in the meantime; beat 0 is still ahead, so they start on time.
    player.setNotes(notes, notesEpoch)
    void syncBacking()
  }

  function end(): void {
    playRun++
    transport?.stop()
    void syncBacking()
  }

  /** Open the microphone on the shared context. Resolves once frames are flowing. */
  function startListening(): Promise<void> {
    if (micState.value === 'running') return Promise.resolve()
    micStarting ??= openMic().finally(() => {
      micStarting = null
    })
    return micStarting
  }

  async function openMic(): Promise<void> {
    const run = ++micRun
    micState.value = 'starting'
    error.value = null
    const ctx = audioContext()
    const source = new MicSource({ context: ctx })
    mic = source
    try {
      const info = await source.start()
      // The capture worklet counts samples from its first render quantum, which is about now.
      const origin = ctx.currentTime
      if (run !== micRun) {
        await source.stop()
        return
      }
      const worker = new WorkerHost({
        sampleRate: info.sampleRate,
        features: ['level', 'pitch', 'harmonics'],
        options: { f0: { tracker: 'pyin' } },
        record: false,
      })
      host = worker
      worker.onError((message) => {
        error.value = message
        void stopListening()
      })
      worker.attachCapture(source.createPort())
      await worker.ready
      if (run !== micRun) return
      captureOrigin = origin
      const capacity = Math.round(TRACE_SECONDS * worker.timeline.frameRate)
      midiFrames = new Float32Array(capacity)
      loudFrames = new Float32Array(capacity)
      micState.value = 'running'
      lastFrame = performance.now()
      raf = requestAnimationFrame(tick)
    } catch (cause) {
      if (run !== micRun) return
      await stopListening()
      error.value = describe(cause)
      throw cause
    }
  }

  async function stopListening(): Promise<void> {
    micRun++
    cancelAnimationFrame(raf)
    raf = 0
    const worker = host
    const source = mic
    host = null
    mic = null
    worker?.dispose()
    await source?.stop()
    shown = 0
    level.value = 0
    pitch.value = EMPTY_PITCH_TRACE
    timbre.value = null
    micState.value = 'idle'
  }

  function tick(now: number): void {
    const worker = host
    if (worker === null) return
    const { timeline } = worker
    const end = timeline.length
    const begin = Math.max(0, end - midiFrames.length)
    const count = end - begin
    timeline.slice('midi', begin, end, midiFrames)
    timeline.slice('dbfs', begin, end, loudFrames)
    for (let i = 0; i < count; i++) {
      const dbfs = loudFrames[i] ?? -Infinity
      if (!(dbfs >= PITCH_FLOOR_DB)) midiFrames[i] = NaN
      loudFrames[i] = toMeter(dbfs)
    }
    pitch.value = {
      midi: midiFrames,
      level: loudFrames,
      length: count,
      frameRate: timeline.frameRate,
      endTime: count === 0 ? 0 : timeline.frameTime(end - 1),
    }

    timbre.value = readTimbre(timeline, end, count)

    const target = count === 0 ? 0 : (loudFrames[count - 1] ?? 0)
    const elapsed = Math.max(0, (now - lastFrame) / 1000)
    lastFrame = now
    shown = Math.max(target, shown - elapsed / RELEASE_SECONDS)
    level.value = shown
    raf = requestAnimationFrame(tick)
  }

  /**
   * Harmonic levels over the newest frames, averaged in power. Frames without a pitch (unvoiced or
   * too quiet) are skipped; null unless at least half of them carry a voice.
   */
  function readTimbre(timeline: WorkerHost['timeline'], end: number, count: number): Timbre | null {
    const frames = Math.min(TIMBRE_FRAMES, count)
    const [first, second, third] = harmonicFrames as [Float32Array, Float32Array, Float32Array]
    timeline.slice('h1', end - frames, end, first)
    timeline.slice('h2', end - frames, end, second)
    timeline.slice('h3', end - frames, end, third)
    let p1 = 0
    let p2 = 0
    let p3 = 0
    let voiced = 0
    for (let i = 0; i < frames; i++) {
      const h1 = first[i] ?? NaN
      const h2 = second[i] ?? NaN
      const h3 = third[i] ?? NaN
      if (Number.isNaN(midiFrames[count - frames + i] ?? NaN)) continue
      if (!Number.isFinite(h1) || !Number.isFinite(h2) || !Number.isFinite(h3)) continue
      p1 += 10 ** (h1 / 10)
      p2 += 10 ** (h2 / 10)
      p3 += 10 ** (h3 / 10)
      voiced++
    }
    if (voiced * 2 < TIMBRE_FRAMES) return null
    const db = (power: number) => 10 * Math.log10(power / voiced)
    return { h1: db(p1), h2: db(p2), h3: db(p3) }
  }

  const clock: TrainingClock = () => {
    if (context === null || transport === null || !transport.running) return null
    return transport.positionAt(audibleTime(context)) ?? null
  }

  /**
   * Seconds from a moment on the playback grid to the trace frame that catches a response to it:
   * how much later the transport started than capture, plus the sound's trip out to the ears and
   * back in through the microphone. Null unless both playback and capture are running.
   */
  function captureOffset(): number | null {
    if (context === null || transport === null || !transport.running) return null
    if (micState.value !== 'running') return null
    const roundTrip = (context.outputLatency || 0) + (context.baseLatency || 0)
    return transport.audioOrigin - captureOrigin + roundTrip
  }

  /** Trace-clock seconds of a grid moment (seconds from the transport's beat 0). */
  function traceTimeOf(gridSeconds: number): number | null {
    const offset = captureOffset()
    return offset === null ? null : gridSeconds + offset
  }

  /**
   * Score what was sung against targets counted in tempo-map `epoch`, from the frames around them.
   * Null unless playing and listening, or when the tempo map has moved on to another epoch.
   */
  function scoreNotes(
    targets: readonly NoteEvent[],
    epoch: number,
    scoring: ScoreOptions = {},
  ): TakeScore | null {
    const worker = host
    const offset = captureOffset()
    const position = clock()
    if (worker === null || offset === null || position === null) return null
    if (position.epoch !== epoch || targets.length === 0) return null
    const { grid } = position
    const from = Math.min(...targets.map((target) => grid.beatToSeconds(target.startBeat)))
    const to = Math.max(
      ...targets.map((target) => grid.beatToSeconds(target.startBeat + target.durationBeats)),
    )
    const { start, end } = worker.timeline.range(
      from + offset - SCORE_MARGIN_SECONDS,
      to + offset + SCORE_MARGIN_SECONDS,
    )
    const { notes: sung } = segmentTake(worker.timeline, start, end)
    return scoreTake(targets, sung, grid, worker.timeline, { latencySeconds: offset, ...scoring })
  }

  /** Reference notes to play along the clicks, their beats counted within tempo-map `epoch`. */
  function setNotes(next: readonly NoteEvent[], epoch: number): void {
    notes = next
    notesEpoch = epoch
    if (transport?.running) transport.setNotes(next, epoch)
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
    } catch (cause) {
      console.error('Backing track failed', cause)
    }
  }

  // Sync flush keeps the AudioContext inside the Play click, where autoplay policies allow sound.
  watch(
    playing,
    (on) => {
      if (!on) {
        end()
        return
      }
      begin().catch((cause: unknown) => {
        error.value = describe(cause)
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
    playRun++
    transport?.stop()
    loop?.stop()
    const ctx = context
    void stopListening().finally(() => ctx?.close())
  })

  const pitchView: Readonly<Ref<PitchTrace>> = pitch
  return {
    /** Playback on or off; bind it to the Play control. */
    playing,
    micState: readonly(micState),
    error: readonly(error),
    /** Microphone loudness for meters, 0…1 over −60…0 dBFS, falling back slowly. */
    level: readonly(level),
    /** Recent microphone frames — pitch and loudness — for pitch charts. */
    pitch: pitchView,
    /** Levels of the voice's first three harmonics over the last 80 ms; null while not singing. */
    timbre: readonly(timbre),
    clock,
    setNotes,
    startListening,
    stopListening,
    traceTimeOf,
    scoreNotes,
  }
}

export type ExerciseSession = ReturnType<typeof useExerciseSession>

function toMeter(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return 0
  return Math.min(1, Math.max(0, (dbfs - FLOOR_DB) / -FLOOR_DB))
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** The context time now reaching the speakers; `currentTime` runs ahead by the output latency. */
function audibleTime(context: AudioContext): number {
  const { contextTime, performanceTime } = context.getOutputTimestamp()
  if (contextTime === undefined || performanceTime === undefined || performanceTime === 0) {
    return context.currentTime - (context.outputLatency || 0)
  }
  return contextTime + (performance.now() - performanceTime) / 1000
}
