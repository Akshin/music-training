/**
 * Plays core-rendered clicks and tones through an AudioContext.
 *
 * Buffers are built from `renderClick` / `renderTone`, so the host does not invent a second
 * metronome sound. Scheduling uses AudioBufferSourceNode.start(when) on the audio clock.
 */

import { renderClick, renderPulse } from '../../core/synthesis/click'
import type { ClickLevel } from '../../core/synthesis/metronome'
import { renderTone } from '../../core/synthesis/tone'

/** Tone buffers kept at once. Every tempo mints new durations, so the cache must not grow freely. */
const TONE_CACHE_LIMIT = 64

/** The metronome's two layers, each on its own gain so it can sit under the voice. */
type Bus = 'click' | 'pulse'

export class WebSynth {
  readonly context: AudioContext
  private readonly clicks = new Map<ClickLevel, AudioBuffer>()
  private readonly tones = new Map<string, AudioBuffer>()
  private readonly pulses = new Map<boolean, AudioBuffer>()
  private readonly live = new Set<AudioBufferSourceNode>()
  private readonly buses = new Map<Bus, GainNode>()
  private readonly volumes: Record<Bus, number> = { click: 1, pulse: 1 }

  constructor(context: AudioContext) {
    this.context = context
  }

  click(when: number, level: ClickLevel): void {
    let buffer = this.clicks.get(level)
    if (buffer === undefined) {
      buffer = this.toBuffer(renderClick(this.context.sampleRate, level))
      this.clicks.set(level, buffer)
    }
    this.play(buffer, when, this.output('click'))
  }

  /** A pulse of the second layer; `first` for the one that starts its cycle. */
  pulse(when: number, first: boolean): void {
    let buffer = this.pulses.get(first)
    if (buffer === undefined) {
      buffer = this.toBuffer(renderPulse(this.context.sampleRate, first))
      this.pulses.set(first, buffer)
    }
    this.play(buffer, when, this.output('pulse'))
  }

  /** Loudness of the beat clicks as a linear gain in [0, 1]; notes are not affected. */
  setClickVolume(volume: number): void {
    this.setVolume('click', volume)
  }

  /** Loudness of the second layer's pulses as a linear gain in [0, 1]. */
  setPulseVolume(volume: number): void {
    this.setVolume('pulse', volume)
  }

  note(when: number, midi: number, duration: number, velocity = 0.7): void {
    const key = `${midi}|${duration.toFixed(3)}|${velocity.toFixed(3)}`
    let buffer = this.tones.get(key)
    if (buffer === undefined) {
      if (this.tones.size >= TONE_CACHE_LIMIT) this.tones.clear()
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

  private setVolume(bus: Bus, volume: number): void {
    this.volumes[bus] = Math.min(1, Math.max(0, volume))
    this.buses.get(bus)?.gain.setTargetAtTime(this.volumes[bus], this.context.currentTime, 0.02)
  }

  private output(bus: Bus): AudioNode {
    let node = this.buses.get(bus)
    if (node === undefined) {
      node = this.context.createGain()
      node.gain.value = this.volumes[bus]
      node.connect(this.context.destination)
      this.buses.set(bus, node)
    }
    return node
  }

  private play(
    buffer: AudioBuffer,
    when: number,
    output: AudioNode = this.context.destination,
  ): void {
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.connect(output)
    source.onended = () => this.live.delete(source)
    this.live.add(source)
    source.start(Math.max(when, this.context.currentTime))
  }
}
