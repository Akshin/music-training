import { describe, expect, it } from 'vitest'
import type { GridNote } from '@audio-core/core/index'
import { barCapacity, barFill, type BarElement } from '@/training/builder'
import { barsFromSung, sixteenthBeats } from '@/training/sungBars'

function note(midi: number, startStep: number, steps: number, slideTo?: number): GridNote {
  return {
    midi,
    startStep,
    steps,
    startBeat: startStep / 4,
    durationBeats: steps / 4,
    slideTo,
    offsetSeconds: 0,
    source: 0,
  }
}

/** A bar as text: `60:4` a quarter C4, `60~4` one that slides on, `-2` an eighth rest. */
function written(bar: readonly BarElement[]): string {
  return bar
    .map((element) =>
      element.type === 'note'
        ? `${element.midi}${element.kind === 'slide' ? '~' : ':'}${element.sixteenths}`
        : `-${element.sixteenths}`,
    )
    .join(' ')
}

describe('sixteenthBeats', () => {
  it('is a quarter of a quarter beat and half of an eighth beat', () => {
    expect(sixteenthBeats(4)).toBe(0.25)
    expect(sixteenthBeats(3)).toBe(0.25)
    expect(sixteenthBeats(6)).toBe(0.5)
  })
})

describe('barsFromSung', () => {
  it('fills a bar with notes and the rests between them', () => {
    const bars = barsFromSung([note(60, 0, 4), note(62, 4, 2), note(64, 8, 8)], 4)
    expect(bars.map(written)).toEqual(['60:4 62:2 -2 64:8'])
  })

  it('writes rests as long as their place in the bar allows', () => {
    expect(barsFromSung([note(60, 1, 1), note(62, 7, 1)], 4).map(written)).toEqual([
      '-1 60:1 -2 -2 -1 62:1 -8',
    ])
  })

  it('keeps the onset of a note the bar cannot write and rests for what is left', () => {
    // A dotted quarter, then a dotted eighth.
    expect(barsFromSung([note(60, 0, 6), note(62, 6, 3), note(64, 12, 4)], 4).map(written)).toEqual(
      ['60:4 -2 62:2 -4 64:4'],
    )
  })

  it('ends a note at the bar line', () => {
    const bars = barsFromSung([note(60, 12, 8), note(62, 24, 8)], 4)
    expect(bars.map(written)).toEqual(['-8 -4 60:4', '-8 62:8'])
  })

  it('leaves out empty bars around the notes and keeps the ones between', () => {
    const bars = barsFromSung([note(60, 16, 16), note(62, 48, 16)], 4)
    expect(bars.map(written)).toEqual(['60:16', '-16', '62:16'])
    expect(barsFromSung([], 4)).toEqual([])
  })

  it('counts bars from the first step and ignores what was sung before it', () => {
    const bars = barsFromSung([note(59, 14, 2), note(60, 16, 4), note(62, 36, 4)], 4, 16)
    expect(bars.map(written)).toEqual(['60:4 -4 -8', '-4 62:4 -8'])
  })

  it('keeps a slide only when the note is written whole', () => {
    const bars = barsFromSung([note(60, 0, 4, 67), note(67, 4, 6, 60), note(60, 10, 6)], 4)
    expect(bars.map(written)).toEqual(['60~4 67:4 -2 60:4 -2'])
  })

  it('fills bars of 3/4 and 6/8 to their own length', () => {
    for (const beats of [3, 6]) {
      const bars = barsFromSung([note(60, 0, 3), note(62, 13, 2)], beats)
      expect(bars).toHaveLength(2)
      for (const bar of bars) expect(barFill(bar)).toBe(barCapacity(beats))
    }
    expect(barsFromSung([note(60, 0, 12)], 6).map(written)).toEqual(['60:8 -4'])
  })
})
