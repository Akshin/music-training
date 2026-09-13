/**
 * Plays core-rendered clicks and tones through an AudioContext.
 *
 * Buffers are built from `renderClick` / `renderTone`, so the host does not invent a second
 * metronome sound. Scheduling uses AudioBufferSourceNode.start(when) on the audio clock.
 */

import { renderClick } from '../../core/synthesis/click'
import type { ClickLevel } from '../../core/synthesis/metronome'
import { renderTone } from '../../core/synthesis/tone'

export class WebSynth {
  readonly context: AudioContext
  private readonly clicks = new Map<ClickLevel, AudioBuffer>()
  private readonly tones = new Map<string, AudioBuffer>()
  private readonly live = new Set<AudioBufferSourceNode>()

  constructor(context: AudioContext) {
    this.context = context
  }

  click(when: number, level: ClickLevel): void {
    let buffer = this.clicks.get(level)
    if (buffer === undefined) {
      buffer = this.toBuffer(renderClick(this.context.sampleRate, level))
      this.clicks.set(level, buffer)
    }
    this.play(buffer, when)
  }

  note(when: number, midi: number, duration: number, velocity = 0.7): void {
    const key = `${midi}|${duration.toFixed(3)}|${velocity.toFixed(3)}`
    let buffer = this.tones.get(key)
    if (buffer === undefined) {
      buffer = this.toBuffer(renderTone(this.context.sampleRate, midi, duration, velocity))
      this.tones.set(key, buffer)
    }
    this.play(buffer, when)
  }

  stop(): void {
    for (const source of this.live) {
      try {
        source.stop()
      } catch {
        // already stopped
      }
    }
    this.live.clear()
  }

  private toBuffer(samples: Float32Array): AudioBuffer {
    const buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate)
    buffer.getChannelData(0).set(samples)
    return buffer
  }

  private play(buffer: AudioBuffer, when: number): void {
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(this.context.destination)
    source.onended = () => this.live.delete(source)
    this.live.add(source)
    source.start(Math.max(when, this.context.currentTime))
  }
}
