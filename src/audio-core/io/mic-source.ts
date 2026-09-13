/**
 * Microphone (or any audio input device) → raw PCM.
 *
 * Asks the browser for an unprocessed signal: echo cancellation, noise suppression and automatic
 * gain control are all requested off, because each of them distorts exactly what a vocal analysis
 * measures (level, harmonics, onsets). Browsers may still ignore the request; `MicSourceInfo`
 * reports what was actually applied so the UI can warn.
 *
 * Capture runs in an AudioWorklet. PCM either goes straight to a worker (`createPort()` +
 * `WorkerHost.attachCapture`) or to main-thread listeners (`onChunk`).
 */

import { captureWorkletUrl } from '../host/web/capture-worklet-url'
import type { AudioChunk } from '../core/model/audio'
import {
  CAPTURE_PROCESSOR_NAME,
  type CaptureIncoming,
  type CaptureOutgoing,
} from '../core/transport/protocol'

export interface MicSourceOptions {
  /** `MediaDeviceInfo.deviceId` of an audio input; default device when omitted. */
  readonly deviceId?: string
  /** Share an existing context (e.g. with playback). Otherwise one is created and owned. */
  readonly context?: AudioContext
  /** Samples per PCM message, whole render quanta. Default 512 (10.7 ms at 48 kHz). */
  readonly batchSize?: number
  /** Location of the capture worklet script; defaults to the bundled one. */
  readonly workletUrl?: string | URL
}

export interface MicProcessing {
  readonly echoCancellation: boolean | undefined
  readonly noiseSuppression: boolean | undefined
  readonly autoGainControl: boolean | undefined
}

export interface MicSourceInfo {
  readonly sampleRate: number
  readonly deviceId: string | undefined
  readonly label: string
  readonly channelCount: number | undefined
  /** What the browser reports after applying our constraints. */
  readonly processing: MicProcessing
  /** True when any of AEC/NS/AGC is still on — the signal is not raw. */
  readonly processed: boolean
  /** Context base latency in seconds, when the browser exposes it. */
  readonly baseLatency: number | undefined
  readonly batchSize: number
}

export type MicSourceState = 'idle' | 'starting' | 'running' | 'stopped'
export type ChunkListener = (chunk: AudioChunk) => void

const QUANTUM = 128
const DEFAULT_BATCH = 512

/** Contexts that already loaded the capture worklet module. */
const loadedContexts = new WeakSet<AudioContext>()

/** Newer specs allow string modes (e.g. echoCancellation "remote-only"); anything but off counts as on. */
function asFlag(value: boolean | string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  return value !== 'false' && value !== 'off'
}

export class MicSource {
  private readonly options: MicSourceOptions
  private context: AudioContext | undefined
  private ownsContext = false
  private stream: MediaStream | undefined
  private sourceNode: MediaStreamAudioSourceNode | undefined
  private node: AudioWorkletNode | undefined
  private infoValue: MicSourceInfo | undefined
  private stateValue: MicSourceState = 'idle'
  private readonly listeners = new Set<ChunkListener>()

  constructor(options: MicSourceOptions = {}) {
    this.options = options
  }

  get state(): MicSourceState {
    return this.stateValue
  }

  /** Available after `start()`. */
  get info(): MicSourceInfo | undefined {
    return this.infoValue
  }

  /** The context capturing runs in; available after `start()`. */
  get audioContext(): AudioContext | undefined {
    return this.context
  }

  /** Audio inputs the browser exposes. Labels are empty until permission was granted once. */
  static async listDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((device) => device.kind === 'audioinput')
  }

  async start(): Promise<MicSourceInfo> {
    if (this.stateValue !== 'idle')
      throw new Error(`MicSource cannot start from state "${this.stateValue}"`)
    if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
      throw new Error(
        'getUserMedia is unavailable: audio capture needs a secure context (https or localhost)',
      )
    }
    this.stateValue = 'starting'
    try {
      const { deviceId } = this.options
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          ...(deviceId === undefined ? {} : { deviceId: { exact: deviceId } }),
        },
        video: false,
      })
      this.stream = stream
      const track = stream.getAudioTracks()[0]
      if (track === undefined) throw new Error('The media stream has no audio track')
      const settings = track.getSettings()

      const context = this.options.context ?? new AudioContext({ latencyHint: 'interactive' })
      this.ownsContext = this.options.context === undefined
      this.context = context
      if (context.state !== 'running') await context.resume()

      if (!loadedContexts.has(context)) {
        await context.audioWorklet.addModule(this.options.workletUrl ?? captureWorkletUrl)
        loadedContexts.add(context)
      }

      const requested = this.options.batchSize ?? DEFAULT_BATCH
      const batchSize = Math.max(QUANTUM, Math.round(requested / QUANTUM) * QUANTUM)
      const node = new AudioWorkletNode(context, CAPTURE_PROCESSOR_NAME, {
        numberOfInputs: 1,
        // One silent output connected to the destination keeps the node rendering in every browser.
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { batchSize },
      })
      node.port.onmessage = (event: MessageEvent<CaptureOutgoing>) => this.deliver(event.data)
      node.onprocessorerror = () => {
        console.error('[audio-core] capture worklet crashed')
      }

      const sourceNode = context.createMediaStreamSource(stream)
      sourceNode.connect(node)
      node.connect(context.destination)
      this.sourceNode = sourceNode
      this.node = node

      const processing: MicProcessing = {
        echoCancellation: asFlag(settings.echoCancellation),
        noiseSuppression: asFlag(settings.noiseSuppression),
        autoGainControl: asFlag(settings.autoGainControl),
      }
      this.infoValue = {
        sampleRate: context.sampleRate,
        deviceId: settings.deviceId,
        label: track.label,
        channelCount: settings.channelCount,
        processing,
        processed:
          processing.echoCancellation === true ||
          processing.noiseSuppression === true ||
          processing.autoGainControl === true,
        baseLatency: context.baseLatency,
        batchSize,
      }
      this.stateValue = 'running'
      return this.infoValue
    } catch (error) {
      await this.release()
      this.stateValue = 'stopped'
      throw error
    }
  }

  /**
   * Routes PCM from the audio thread straight to a worker: returns the port to hand to
   * `WorkerHost.attachCapture`. Main-thread `onChunk` listeners stop receiving data.
   */
  createPort(): MessagePort {
    const node = this.requireNode()
    const channel = new MessageChannel()
    this.post(node, { type: 'connect' }, [channel.port1])
    return channel.port2
  }

  /**
   * Receives chunks on the main thread. The chunk's samples are only valid during the callback —
   * the buffer goes back to the worklet afterwards.
   */
  onChunk(listener: ChunkListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async stop(): Promise<void> {
    if (this.stateValue === 'stopped') return
    if (this.node !== undefined) this.post(this.node, { type: 'stop' })
    await this.release()
    this.stateValue = 'stopped'
  }

  private deliver(message: CaptureOutgoing): void {
    if (message.type !== 'pcm') return
    const chunk: AudioChunk = {
      samples: new Float32Array(message.samples),
      startSample: message.startSample,
      sampleRate: message.sampleRate,
    }
    for (const listener of this.listeners) listener(chunk)
    if (this.node !== undefined) {
      this.post(this.node, { type: 'recycle-pcm', buffers: [message.samples] }, [message.samples])
    }
  }

  private post(
    node: AudioWorkletNode,
    message: CaptureIncoming,
    transfer: Transferable[] = [],
  ): void {
    node.port.postMessage(message, transfer)
  }

  private requireNode(): AudioWorkletNode {
    if (this.node === undefined) throw new Error('MicSource is not running; call start() first')
    return this.node
  }

  private async release(): Promise<void> {
    this.sourceNode?.disconnect()
    this.node?.disconnect()
    this.sourceNode = undefined
    this.node = undefined
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = undefined
    if (this.ownsContext && this.context !== undefined && this.context.state !== 'closed') {
      await this.context.close()
    }
    this.context = undefined
  }
}
