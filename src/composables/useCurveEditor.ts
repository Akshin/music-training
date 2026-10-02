import { computed, ref, shallowRef } from 'vue'
import type { SungNote } from '@/training/architect'
import {
  bend,
  curveNotes,
  glide,
  loosePieces,
  renderLine,
  stroke,
  type CurveNote,
  type LoosePiece,
  type RenderNote,
} from '@/training/curve'

/** The tools that draw on the pitch line by hand, over what the notes make of it. */
export type LineTool = 'pen' | 'line' | 'bend' | 'erase'

/** Undo steps kept. */
const HISTORY = 100

export interface CurveEditorOptions {
  /** The notes the line is drawn from, in frames of the line; read inside a computed. */
  readonly notes: () => readonly RenderNote[]
  /** Told of every change that can be undone, so one undo can serve the line and the notes. */
  readonly onCommit?: () => void
}

interface Snapshot {
  readonly drawn: Float32Array
  readonly cuts: readonly number[]
  readonly forced: readonly LoosePiece[]
}

/**
 * The pitch line of the piece being made into an exercise. The notes are found in the line as
 * sung — cut apart where repeated notes of one pitch meet, and with loose pieces made notes by
 * hand — and the line shown is drawn from the notes (`renderLine`): each note's stretch of the
 * voice at its pitch, as level and with as much vibrato as the note says. What is drawn by hand
 * with the pen, the line, the bend lies over that; the eraser takes it away. Strokes preview while
 * the mouse moves and land as one undo step when it lets go.
 */
export function useCurveEditor(options: CurveEditorOptions) {
  /** The line as sung; never edited. */
  const sung = shallowRef<Float32Array>(new Float32Array(0))
  /** Drawn by hand, NaN where nothing is. */
  const drawn = shallowRef<Float32Array>(new Float32Array(0))
  /** Frames where one note ends and the next begins though the pitch holds (repeated notes). */
  const cuts = shallowRef<readonly number[]>([])
  /** Loose pieces of the voice made notes by hand. */
  const forced = shallowRef<readonly LoosePiece[]>([])
  /** Trace-clock seconds of frame 0, and frames per second. */
  const firstTime = ref(0)
  const frameRate = ref(100)
  /** Round drawn pitches to the semitone. */
  const snap = ref(true)
  /** Width of the bend and the eraser, seconds. */
  const brush = ref(0.35)
  const undoStack = shallowRef<Snapshot[]>([])
  const redoStack = shallowRef<Snapshot[]>([])

  /** The notes found in the voice, loose pieces made notes included. */
  const found = computed<CurveNote[]>(() => {
    if (sung.value.length === 0) return []
    const notes = curveNotes(sung.value, frameRate.value, cuts.value)
    const extra = forced.value.map((piece): CurveNote => ({
      start: piece.start,
      end: piece.end,
      midi: piece.midi,
      onset: 'plain',
      release: 'plain',
      vibrato: false,
    }))
    return [...notes, ...extra].sort((a, b) => a.start - b.start)
  })
  /** The notes found, as the shaping takes them: seconds on the trace clock. */
  const sungNotes = computed<SungNote[]>(() =>
    found.value.map((note) => ({
      midi: note.midi,
      start: firstTime.value + note.start / frameRate.value,
      end: firstTime.value + note.end / frameRate.value,
      slide: note.release === 'glide',
      scoop: note.onset === 'scoop',
      fall: note.release === 'fall',
      vibrato: note.vibrato,
    })),
  )
  /** Sung stretches that are no note, for the chart to offer. */
  const loose = computed<LoosePiece[]>(() =>
    sung.value.length === 0 ? [] : loosePieces(sung.value, found.value, frameRate.value),
  )
  /** The line shown: drawn from the notes, with what was drawn by hand over it. */
  const target = computed<Float32Array>(() =>
    sung.value.length === 0
      ? new Float32Array(0)
      : renderLine(sung.value, options.notes(), drawn.value, frameRate.value),
  )
  const edited = computed(() => undoStack.value.length > 0)
  const hasDrawing = computed(() => drawn.value.some((value) => Number.isFinite(value)))

  /** A new piece: its line as sung, the cuts between repeated notes, where it starts. */
  function load(
    values: Float32Array,
    repeatCuts: readonly number[],
    start: number,
    rate: number,
  ): void {
    sung.value = values.slice()
    drawn.value = new Float32Array(values.length).fill(NaN)
    cuts.value = [...repeatCuts]
    forced.value = []
    firstTime.value = start
    frameRate.value = rate
    undoStack.value = []
    redoStack.value = []
  }

  /** What was drawn and cut earlier put back over the loaded line, without undo history. */
  function adopt(kept: {
    drawn: Float32Array
    cuts: readonly number[]
    forced: readonly LoosePiece[]
  }): void {
    if (kept.drawn.length !== sung.value.length) return
    drawn.value = kept.drawn.slice()
    cuts.value = [...kept.cuts]
    forced.value = [...kept.forced]
  }

  const snapshot = (): Snapshot => ({
    drawn: drawn.value,
    cuts: cuts.value,
    forced: forced.value,
  })

  function restore(state: Snapshot): void {
    drawn.value = state.drawn
    cuts.value = state.cuts
    forced.value = state.forced
  }

  function commit(before: Snapshot): void {
    undoStack.value = [...undoStack.value, before].slice(-HISTORY)
    redoStack.value = []
    options.onCommit?.()
  }

  function undo(): void {
    const previous = undoStack.value.at(-1)
    if (previous === undefined) return
    redoStack.value = [...redoStack.value, snapshot()]
    undoStack.value = undoStack.value.slice(0, -1)
    restore(previous)
  }

  function redo(): void {
    const next = redoStack.value.at(-1)
    if (next === undefined) return
    undoStack.value = [...undoStack.value, snapshot()]
    redoStack.value = redoStack.value.slice(0, -1)
    restore(next)
  }

  /** Everything drawn by hand taken away, as one undo step. */
  function clearDrawing(): void {
    if (!hasDrawing.value) return
    const before = snapshot()
    drawn.value = new Float32Array(sung.value.length).fill(NaN)
    commit(before)
  }

  /** A cut at `frame`: the note there becomes two, even at one pitch. */
  function cutAt(frame: number): void {
    const before = snapshot()
    cuts.value = [...cuts.value.filter((cut) => cut !== frame), frame].sort((a, b) => a - b)
    commit(before)
  }

  /** A loose piece of the voice made a note. */
  function force(piece: LoosePiece): void {
    const before = snapshot()
    forced.value = [...forced.value, piece]
    commit(before)
  }

  // ---- Strokes: begin, move while dragging, end ----

  let drag: {
    tool: LineTool
    before: Snapshot
    /** The line shown when the stroke began, for bending it. */
    base: Float32Array
    frame: number
    pitch: number
    last: { frame: number; pitch: number }
  } | null = null
  /** The straight line being drawn with the line tool, for the chart to show. */
  const preview = shallowRef<{
    from: number
    fromPitch: number
    to: number
    toPitch: number
  } | null>(null)

  const brushFrames = () => Math.max(1, Math.round(brush.value * frameRate.value))
  const place = (pitch: number, snapped: boolean) => (snapped ? Math.round(pitch) : pitch)

  /** A stroke starts at `frame` and `pitch`; `snapped` rounds drawn pitches to the semitone. */
  function begin(tool: LineTool, frame: number, pitch: number, snapped: boolean): void {
    const at = { frame, pitch: place(pitch, snapped) }
    drag = { tool, before: snapshot(), base: target.value, frame, pitch: at.pitch, last: at }
    move(frame, pitch, snapped)
  }

  function move(frame: number, pitch: number, snapped: boolean): void {
    const stroking = drag
    if (stroking === null) return
    const half = Math.round(brushFrames() / 2)
    switch (stroking.tool) {
      case 'pen': {
        const at = place(pitch, snapped)
        drawn.value = stroke(drawn.value, stroking.last.frame, stroking.last.pitch, frame, at)
        stroking.last = { frame, pitch: at }
        break
      }
      case 'line':
        preview.value = {
          from: stroking.frame,
          fromPitch: stroking.pitch,
          to: frame,
          toPitch: place(pitch, snapped),
        }
        break
      case 'bend': {
        // The shown line bent, laid over what was drawn before the stroke.
        const radius = brushFrames()
        const bent = bend(stroking.base, stroking.frame, radius, pitch - stroking.pitch)
        const next = stroking.before.drawn.slice()
        const reach = Math.ceil(radius * 1.5)
        const low = Math.max(0, stroking.frame - reach)
        const high = Math.min(next.length, stroking.frame + reach)
        for (let i = low; i < high; i++) if (Number.isFinite(bent[i])) next[i] = bent[i]!
        drawn.value = next
        break
      }
      case 'erase': {
        const next = drawn.value.slice()
        next.fill(NaN, Math.max(0, frame - half), Math.min(next.length, frame + half))
        drawn.value = next
        break
      }
    }
  }

  function end(): void {
    const stroking = drag
    drag = null
    if (stroking === null) return
    const line = preview.value
    if (stroking.tool === 'line' && line !== null) {
      drawn.value = glide(drawn.value, line.from, line.fromPitch, line.to, line.toPitch)
    }
    preview.value = null
    if (drawn.value !== stroking.before.drawn) commit(stroking.before)
  }

  return {
    sung,
    target,
    drawn,
    cuts,
    forced,
    found,
    sungNotes,
    loose,
    firstTime,
    frameRate,
    snap,
    brush,
    preview,
    edited,
    hasDrawing,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    /** The line as sung, for drawing it under the target. */
    sungLine: () => sung.value,
    load,
    adopt,
    undo,
    redo,
    clearDrawing,
    cutAt,
    force,
    begin,
    move,
    end,
  }
}

export type CurveEditor = ReturnType<typeof useCurveEditor>
