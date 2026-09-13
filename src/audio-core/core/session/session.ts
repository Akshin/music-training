/**
 * A practice session is one tape plus named takes (exercises) on that tape.
 *
 * The app marks takes; the core only stores their sample range. Gaps between takes stay on the
 * tape until the host drops them (quota). An open take has `endSample === undefined`.
 */

import type { PcmTape } from './pcm-tape'

export interface Take {
  readonly id: number
  readonly label: string
  readonly startSample: number
  readonly endSample: number | undefined
}

export class Session {
  readonly tape: PcmTape
  private readonly recorded: Take[] = []
  private nextId = 1

  constructor(tape: PcmTape) {
    this.tape = tape
  }

  get takes(): readonly Take[] {
    return this.recorded
  }

  /** Starts a take at `startSample` (default: current tape head). */
  beginTake(label = '', startSample = this.tape.length): Take {
    const take: Take = { id: this.nextId++, label, startSample, endSample: undefined }
    this.recorded.push(take)
    return take
  }

  /** Closes the open take, or the take with `id`, at `endSample` (default: tape head). */
  endTake(id?: number, endSample = this.tape.length): Take {
    const take =
      id === undefined
        ? this.recorded.findLast((entry) => entry.endSample === undefined)
        : this.recorded.find((entry) => entry.id === id)
    if (take === undefined) throw new Error('No open take to close')
    const closed: Take = { ...take, endSample }
    const index = this.recorded.indexOf(take)
    this.recorded[index] = closed
    return closed
  }
}
