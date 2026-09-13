/**
 * Loops a decoded recording — a backing pad — on the transport's AudioContext.
 *
 * Recordings are not synthesis: the core renders clicks and tones, while a pad recorded as mp3 is
 * decoded by the browser here and only played. A new recording crossfades with the one before it,
 * so changing the key never clicks or drops out.
 */

const FADE_SECONDS = 0.6

interface Voice {
  readonly buffer: AudioBuffer
  readonly source: AudioBufferSourceNode
  readonly gain: GainNode
}

export class WebLoop {
  readonly context: AudioContext
  private readonly level: number
  private voice: Voice | null = null

  constructor(context: AudioContext, level = 0.34) {
    this.context = context
    this.level = level
  }

  /** The recording currently looping, or `null`. */
  get buffer(): AudioBuffer | null {
    return this.voice?.buffer ?? null
  }

  /** Decode an encoded file (mp3, ogg, wav…) for this context; `data` stays usable afterwards. */
  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.context.decodeAudioData(data.slice(0))
  }

  /** Loop `buffer` from `when`, fading in while whatever played before fades out. */
  play(buffer: AudioBuffer, when = this.context.currentTime): void {
    const start = Math.max(when, this.context.currentTime)
    this.fadeOut(start)
    const gain = this.context.createGain()
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(this.level, start + FADE_SECONDS)
    gain.connect(this.context.destination)
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(gain)
    source.start(start)
    this.voice = { buffer, source, gain }
  }

  /** Fade out and stop. */
  stop(): void {
    this.fadeOut(this.context.currentTime)
  }

  private fadeOut(when: number): void {
    const voice = this.voice
    if (voice === null) return
    this.voice = null
    const { gain, source } = voice
    gain.gain.cancelScheduledValues(when)
    gain.gain.setValueAtTime(gain.gain.value, when)
    gain.gain.linearRampToValueAtTime(0, when + FADE_SECONDS)
    source.onended = () => gain.disconnect()
    source.stop(when + FADE_SECONDS)
  }
}
