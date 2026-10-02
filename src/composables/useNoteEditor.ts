import { computed, ref, shallowRef } from 'vue'
import type { LineTool } from '@/composables/useCurveEditor'
import type { Grid, NoteSource, ShapedNote } from '@/training/architect'
import {
  MIN_LENGTH,
  afterNotes,
  isLevel,
  joinNotes,
  markNotes,
  moveNotes,
  placeCopies,
  splitNotes,
  resizeNote,
  shapeOf,
  snapBeat,
  tidy,
  toBeats,
  toSeconds,
  type EditNote,
  type LineShape,
} from '@/training/noteEdit'

/** What the mouse does on the chart; the hand only looks around. */
export type EditTool = 'hand' | 'select' | 'draw' | 'cut' | LineTool

/** The tools that draw on the pitch line rather than on the notes. */
export const LINE_TOOLS: readonly EditTool[] = ['pen', 'line', 'bend', 'erase']

/** A note's line as sung, and held level without vibrato. */
export const AS_SUNG: LineShape = { flatness: 0, vibratoScale: 1 }
export const LEVEL: LineShape = { flatness: 1, vibratoScale: 0 }

/** Undo steps kept. */
const HISTORY = 200

export interface NoteEditorOptions {
  /** Sound a note the moment it is picked, drawn or moved to another pitch. */
  readonly audition?: (midi: number) => void
  /** Told of every change that can be undone, so one undo can serve the line and the notes. */
  readonly onCommit?: () => void
}

/**
 * The architect's note editor: the notes (in beats), which of them are chosen, and undo. Edits
 * made while dragging preview live and land as one undo step when the drag ends.
 */
export function useNoteEditor(options: NoteEditorOptions = {}) {
  const notes = shallowRef<EditNote[]>([])
  const selected = shallowRef<ReadonlySet<number>>(new Set())
  /** Grid step the edits snap to, in beats; 0 moves freely. */
  const snap = ref(1 / 4)
  /** What the mouse does on the chart: choose and move, draw new notes, or cut notes. */
  const tool = ref<EditTool>('select')
  /** The notes were changed by hand since they were loaded. */
  const edited = ref(false)
  const undoStack = shallowRef<EditNote[][]>([])
  const redoStack = shallowRef<EditNote[][]>([])
  let nextId = 1
  let dragBase: EditNote[] | null = null
  let dragPitch = 0
  /**
   * How level each sung note's line was made and how much vibrato it keeps, by which note of the
   * take it was sung as — so the shape stays when the notes are shaped again (quantize, key, tempo).
   */
  const shapes = new Map<number, LineShape>()

  const audition = (midi: number) => options.audition?.(midi)

  const withShape = (note: EditNote): EditNote => {
    const kept = note.source && shapes.get(note.source.index)
    return kept ? { ...note, ...kept } : note
  }

  function rememberShapes(list: readonly EditNote[]): void {
    for (const note of list) if (note.source) shapes.set(note.source.index, shapeOf(note))
  }

  /** A new piece: shapes of the last one forgotten. */
  function forgetShapes(): void {
    shapes.clear()
  }

  /** The shapes given, by which note of the take, to keep; for them to outlive the page. */
  function keptShapes(): [number, LineShape][] {
    return [...shapes.entries()]
  }

  /** Shapes kept from before, for the notes loaded next. */
  function keepShapes(entries: readonly (readonly [number, LineShape])[]): void {
    for (const [index, shape] of entries) shapes.set(index, shape)
  }

  /** Start over from shaped notes: no history, nothing chosen; each keeps the shape it was given. */
  function load(shaped: readonly ShapedNote[], grid: Grid): void {
    notes.value = tidy(toBeats(shaped, grid, nextId).map(withShape))
    nextId += shaped.length
    selected.value = new Set()
    undoStack.value = []
    redoStack.value = []
    edited.value = false
  }

  /** Notes edited earlier put back as they were, without undo history. */
  function adopt(kept: readonly EditNote[]): void {
    notes.value = tidy([...kept])
    rememberShapes(notes.value)
    nextId = Math.max(nextId, ...kept.map((note) => note.id + 1))
    selected.value = new Set()
    undoStack.value = []
    redoStack.value = []
    edited.value = true
  }

  /**
   * A change that can be undone. Unless it only reshapes lines (`byHand` false), the notes are then
   * the editor's own: the shaping — quantize, key — no longer redoes them.
   */
  function commit(next: EditNote[], before = notes.value, byHand = true): void {
    undoStack.value = [...undoStack.value, before].slice(-HISTORY)
    redoStack.value = []
    options.onCommit?.()
    notes.value = tidy(next)
    rememberShapes(notes.value)
    if (byHand) edited.value = true
  }

  function undo(): void {
    const previous = undoStack.value.at(-1)
    if (previous === undefined) return
    redoStack.value = [...redoStack.value, notes.value]
    undoStack.value = undoStack.value.slice(0, -1)
    notes.value = previous
    rememberShapes(previous)
    keepSelection()
  }

  function redo(): void {
    const next = redoStack.value.at(-1)
    if (next === undefined) return
    undoStack.value = [...undoStack.value, notes.value]
    redoStack.value = redoStack.value.slice(0, -1)
    notes.value = next
    rememberShapes(next)
    keepSelection()
  }

  /** Drop chosen notes that no longer exist. */
  function keepSelection(): void {
    const ids = new Set(notes.value.map((note) => note.id))
    selected.value = new Set([...selected.value].filter((id) => ids.has(id)))
  }

  function select(ids: readonly number[], add = false): void {
    selected.value = new Set(add ? [...selected.value, ...ids] : ids)
    const first = notes.value.find((note) => ids.includes(note.id))
    if (first !== undefined) audition(first.midi)
  }

  function toggle(id: number): void {
    const next = new Set(selected.value)
    if (!next.delete(id)) next.add(id)
    selected.value = next
  }

  /** The notes a test picks, added to the choice or instead of it; quiet, for dragging a frame. */
  function selectWhere(
    test: (note: EditNote) => boolean,
    base: ReadonlySet<number> = new Set(),
  ): void {
    const ids = new Set(base)
    for (const note of notes.value) if (test(note)) ids.add(note.id)
    selected.value = ids
  }

  function selectAll(): void {
    selected.value = new Set(notes.value.map((note) => note.id))
  }

  function clearSelection(): void {
    if (selected.value.size > 0) selected.value = new Set()
  }

  /**
   * A new note at `beat` and `midi`, chosen: one grid step long (a quarter when free), or `length`
   * beats and sung where `source` says, for a loose piece of the voice made a note.
   */
  function add(
    midi: number,
    beat: number,
    sung: { length: number; source: NoteSource } | null = null,
  ): void {
    const step = snap.value > 0 ? snap.value : 1
    const id = nextId++
    commit([
      ...notes.value,
      {
        id,
        midi,
        start: sung === null ? snapBeat(beat, snap.value) : beat,
        length: Math.max(MIN_LENGTH, sung?.length ?? step),
        onset: 'plain',
        release: 'plain',
        vibrato: false,
        ...(sung === null ? {} : { source: sung.source }),
      },
    ])
    selected.value = new Set([id])
    audition(midi)
  }

  function removeSelected(): void {
    if (selected.value.size === 0) return
    commit(notes.value.filter((note) => !selected.value.has(note.id)))
    selected.value = new Set()
  }

  /** One note taken away, chosen or not. */
  function remove(id: number): void {
    if (!notes.value.some((note) => note.id === id)) return
    commit(notes.value.filter((note) => note.id !== id))
    selected.value = new Set([...selected.value].filter((chosen) => chosen !== id))
  }

  /** The chosen notes, or all of them when none are chosen, moved by semitones. */
  function transpose(semitones: number): void {
    const ids = selected.value.size > 0 ? selected.value : new Set(notes.value.map((n) => n.id))
    if (ids.size === 0) return
    commit(moveNotes(notes.value, ids, 0, semitones))
    const first = notes.value.find((note) => ids.has(note.id))
    if (first !== undefined) audition(first.midi)
  }

  /** The chosen notes moved by grid steps (a sixteenth when free). */
  function nudge(steps: number): void {
    if (selected.value.size === 0) return
    const step = snap.value > 0 ? snap.value : 1 / 4
    commit(moveNotes(notes.value, selected.value, steps * step, 0))
  }

  /** The chosen notes' entry, exit or vibrato changed. */
  function mark(change: Partial<Pick<EditNote, 'onset' | 'release' | 'vibrato'>>): void {
    if (selected.value.size === 0) return
    commit(markNotes(notes.value, selected.value, change))
  }

  // ---- Copy and paste, duplicate, cut and join ----

  let clipboard: EditNote[] = []
  const chosenNotes = () => notes.value.filter((note) => selected.value.has(note.id))

  function copy(): void {
    const chosen = chosenNotes()
    if (chosen.length > 0) clipboard = chosen
  }

  function cut(): void {
    copy()
    removeSelected()
  }

  /** The copied notes placed from `beat` on (snapped), and chosen. */
  function paste(beat: number): void {
    if (clipboard.length === 0) return
    const copies = placeCopies(clipboard, snapBeat(beat, snap.value), nextId)
    nextId += copies.length
    commit([...notes.value, ...copies])
    selected.value = new Set(copies.map((note) => note.id))
  }

  /** The chosen notes copied right after themselves, the copies chosen. */
  function duplicate(): void {
    const chosen = chosenNotes()
    if (chosen.length === 0) return
    const copies = placeCopies(chosen, afterNotes(chosen, snap.value), nextId)
    nextId += copies.length
    commit([...notes.value, ...copies])
    selected.value = new Set(copies.map((note) => note.id))
  }

  /** The chosen notes cut in two at `beat`. */
  function split(beat: number): void {
    if (selected.value.size === 0) return
    const next = splitNotes(notes.value, selected.value, beat, nextId)
    if (next.length === notes.value.length) return
    nextId += next.length - notes.value.length
    commit(next)
  }

  /** One note cut in two at `beat`, with the scissors; the right half is chosen. */
  function cutAt(id: number, beat: number): void {
    const next = splitNotes(notes.value, new Set([id]), beat, nextId)
    if (next.length === notes.value.length) return
    const right = nextId
    nextId += 1
    commit(next)
    selected.value = new Set([right])
  }

  /** The chosen notes up or down by semitones; unlike `transpose`, nothing happens without a choice. */
  function shiftChosen(semitones: number): void {
    if (selected.value.size === 0) return
    transpose(semitones)
  }

  /** The chosen notes joined into one. */
  function join(): void {
    if (selected.value.size < 2) return
    const next = joinNotes(notes.value, selected.value)
    commit(next)
    keepSelection()
  }

  // ---- The notes' lines: how level, how much vibrato ----

  /** Notes `ids` given the shape `change` makes of theirs. Not a hand edit: shaping still applies. */
  function reshape(ids: ReadonlySet<number>, change: (shape: LineShape) => LineShape): void {
    if (!notes.value.some((note) => ids.has(note.id))) return
    const next = notes.value.map((note) =>
      ids.has(note.id) ? { ...note, ...change(shapeOf(note)) } : note,
    )
    commit(next, notes.value, false)
  }

  /** The chosen notes level and without vibrato — or, when they all are, back as sung. */
  function toggleLevel(ids: ReadonlySet<number> = selected.value): void {
    const chosen = notes.value.filter((note) => ids.has(note.id))
    if (chosen.length === 0) return
    const level = chosen.every(isLevel)
    reshape(ids, () => (level ? AS_SUNG : LEVEL))
  }

  let shapeBase: EditNote[] | null = null

  /** A handle on a note grabbed: its shape previews while dragged and lands as one undo step. */
  function beginShape(): void {
    shapeBase = notes.value
  }

  /** The shape `change` makes, from the one the notes had when the handle (or slider) was grabbed. */
  function dragShape(ids: ReadonlySet<number>, change: (shape: LineShape) => LineShape): void {
    const base = (shapeBase ??= notes.value)
    notes.value = base.map((note) =>
      ids.has(note.id) ? { ...note, ...change(shapeOf(note)) } : note,
    )
  }

  function endShape(): void {
    const base = shapeBase
    shapeBase = null
    if (base === null || base === notes.value) return
    commit(notes.value, base, false)
  }

  // ---- Dragging: previews on every move, one undo step at the end ----

  function beginDrag(): void {
    dragBase = notes.value
    dragPitch = 0
  }

  /** The chosen notes moved by `beats` and `semitones` from where the drag began. */
  function dragMove(beats: number, semitones: number): void {
    if (dragBase === null) return
    notes.value = moveNotes(dragBase, selected.value, beats, semitones)
    if (semitones !== dragPitch) {
      dragPitch = semitones
      const first = notes.value.find((note) => selected.value.has(note.id))
      if (first !== undefined) audition(first.midi)
    }
  }

  function dragResize(id: number, edge: 'start' | 'end', beat: number): void {
    if (dragBase === null) return
    notes.value = resizeNote(dragBase, id, edge, beat)
  }

  function endDrag(): void {
    const base = dragBase
    dragBase = null
    if (base === null || base === notes.value) return
    const changed = notes.value.some((note, index) => note !== base[index])
    if (changed) commit(notes.value, base)
    else notes.value = base
  }

  /**
   * The editor's keys: Delete removes, ⌘Z undoes, ⇧⌘Z or ⌘Y redoes, ⌘C ⌘X ⌘V copy, cut and paste
   * (at the cursor), ⌘D duplicates, J joins the chosen notes, F makes them level (or back as sung),
   * arrows move them (⇧ by an octave up and down), ⌘A chooses all; H, V, N and S pick the hand,
   * the arrow, the pencil and the scissors, P, L, B and E the pen, the line, the bend and the
   * eraser; Esc goes back to the arrow and then lets go. `cursor` is the cursor in beats, or null
   * without one. True when the key was used.
   */
  function handleKey(event: KeyboardEvent, cursor: number | null = null): boolean {
    const command = event.metaKey || event.ctrlKey
    if (command && event.code === 'KeyC') {
      copy()
      return true
    }
    if (command && event.code === 'KeyX') {
      cut()
      return true
    }
    if (command && event.code === 'KeyV') {
      const last = notes.value.length ? afterNotes(notes.value, snap.value) : 0
      paste(cursor ?? last)
      return true
    }
    if (command && event.code === 'KeyD') {
      duplicate()
      return true
    }
    if (command && event.code === 'KeyZ') {
      if (event.shiftKey) redo()
      else undo()
      return true
    }
    if (command && event.code === 'KeyY') {
      redo()
      return true
    }
    if (command && event.code === 'KeyA') {
      selectAll()
      return true
    }
    if (command) return false
    switch (event.code) {
      case 'Delete':
      case 'Backspace':
        removeSelected()
        return true
      case 'Escape':
        if (tool.value !== 'select') tool.value = 'select'
        else clearSelection()
        return true
      case 'KeyV':
        tool.value = 'select'
        return true
      case 'KeyH':
        tool.value = tool.value === 'hand' ? 'select' : 'hand'
        return true
      case 'KeyN':
        tool.value = tool.value === 'draw' ? 'select' : 'draw'
        return true
      case 'KeyP':
        tool.value = tool.value === 'pen' ? 'select' : 'pen'
        return true
      case 'KeyF':
        if (selected.value.size === 0) return false
        toggleLevel()
        return true
      case 'KeyB':
        tool.value = tool.value === 'bend' ? 'select' : 'bend'
        return true
      case 'KeyL':
        tool.value = tool.value === 'line' ? 'select' : 'line'
        return true
      case 'KeyE':
        tool.value = tool.value === 'erase' ? 'select' : 'erase'
        return true
      case 'KeyS':
        tool.value = tool.value === 'cut' ? 'select' : 'cut'
        return true
      case 'KeyJ':
        if (selected.value.size < 2) return false
        join()
        return true
      case 'ArrowUp':
      case 'ArrowDown':
        if (selected.value.size === 0) return false
        transpose((event.code === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 12 : 1))
        return true
      case 'ArrowLeft':
      case 'ArrowRight':
        if (selected.value.size === 0) return false
        nudge(event.code === 'ArrowRight' ? 1 : -1)
        return true
    }
    return false
  }

  return {
    notes,
    selected,
    snap,
    tool,
    edited,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    load,
    adopt,
    forgetShapes,
    keptShapes,
    keepShapes,
    undo,
    redo,
    select,
    toggle,
    selectWhere,
    selectAll,
    clearSelection,
    add,
    removeSelected,
    remove,
    transpose,
    mark,
    copy,
    cut,
    paste,
    duplicate,
    split,
    cutAt,
    shiftChosen,
    join,
    nudge,
    reshape,
    toggleLevel,
    beginShape,
    dragShape,
    endShape,
    beginDrag,
    dragMove,
    dragResize,
    endDrag,
    handleKey,
    /** The notes in seconds on the take's clock, for listening and making the exercise. */
    shaped: (grid: Grid) => toSeconds(notes.value, grid),
  }
}

export type NoteEditor = ReturnType<typeof useNoteEditor>
