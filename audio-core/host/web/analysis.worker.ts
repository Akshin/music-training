/**
 * Dedicated worker that runs the `Analyzer` and, optionally, a PCM tape.
 *
 * Receives PCM either from the host (`pcm` messages) or straight from the capture worklet through a
 * `MessagePort` handed over with `connect`. After every push, new timeline frames are shipped to
 * the host as `frames` batches; buffers return through `recycle-frames`, PCM buffers return to the
 * worklet through `recycle-pcm`. Incoming samples are copied onto the tape before the worklet
 * buffer is recycled.
 */

import { createAnalyzer, type Analyzer } from '../../core/analysis/analyzer'
import { spectrum } from '../../core/analysis/extractors/spectrum'
import { resolveFeatureIds } from '../../core/analysis/registry'
import { PcmTape } from '../../core/session/pcm-tape'
import { tapeToWav } from '../../core/session/offline'
import { FrameBatcher } from '../../core/transport/frame-batcher'
import type {
  CaptureOutgoing,
  HostToWorker,
  InitMessage,
  PcmMessage,
  WorkerToHost,
} from '../../core/transport/protocol'
import { openOpfsColdStore, type OpfsColdStore } from './opfs-pcm-store'

/** PCM buffers returned to the worklet per message; keeps the recycle traffic at a fraction of PCM. */
const PCM_RECYCLE_BATCH = 8

let analyzer: Analyzer | undefined
let batcher: FrameBatcher | undefined
let tape: PcmTape | undefined
let opfs: OpfsColdStore | undefined
let capturePort: MessagePort | undefined
let pcmToRecycle: ArrayBuffer[] = []

function post(message: WorkerToHost, transfer: Transferable[] = []): void {
  postMessage(message, transfer)
}

function fail(error: unknown): void {
  post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
}

function init(message: InitMessage): void {
  opfs?.close()
  opfs = undefined
  tape = undefined

  const features = resolveFeatureIds(message.features)
  const config = {
    sampleRate: message.sampleRate,
    ...(message.frameSize === undefined ? {} : { frameSize: message.frameSize }),
    ...(message.hopSize === undefined ? {} : { hopSize: message.hopSize }),
  }
  const created = createAnalyzer(config, features, message.options ?? {})
  analyzer = created

  const hasSpectrum = created.extractors.some((extractor) => extractor.id === spectrum.id)
  batcher = new FrameBatcher(created, {
    ...(message.batchCapacity === undefined ? {} : { capacity: message.batchCapacity }),
    ...(message.spectrumSnapshot === true && hasSpectrum
      ? {
          spectrum: () =>
            created.results.has(spectrum) ? created.results.get(spectrum).magnitude : undefined,
        }
      : {}),
  })

  if (message.record !== false) {
    const createdTape = new PcmTape({ sampleRate: message.sampleRate })
    tape = createdTape
    void attachOpfs(createdTape)
  }

  post({
    type: 'ready',
    columns: created.timeline.columns,
    sampleRate: created.context.sampleRate,
    frameSize: created.context.frameSize,
    hopSize: created.context.hopSize,
  })
}

async function attachOpfs(target: PcmTape): Promise<void> {
  try {
    const store = await openOpfsColdStore(target.chunkSamples)
    if (tape !== target) {
      store.close()
      return
    }
    target.useCold(store)
    opfs = store
  } catch {
    // Memory cold store stays; OPFS is a capacity upgrade, not a requirement.
  }
}

function shipFrames(): void {
  if (batcher === undefined) return
  for (let batch = batcher.take(); batch !== null; batch = batcher.take()) {
    post(batch.message, batch.transfer)
  }
}

function onPcm(message: PcmMessage, from: MessagePort | undefined): void {
  if (analyzer === undefined) return
  const samples = new Float32Array(message.samples)
  tape?.append(samples, message.startSample)
  analyzer.push({
    samples,
    startSample: message.startSample,
    sampleRate: message.sampleRate,
  })
  shipFrames()

  if (from !== undefined) {
    pcmToRecycle.push(message.samples)
    if (pcmToRecycle.length >= PCM_RECYCLE_BATCH) {
      const buffers = pcmToRecycle
      pcmToRecycle = []
      from.postMessage({ type: 'recycle-pcm', buffers }, buffers)
    }
  }
}

function connectCapture(port: MessagePort): void {
  capturePort?.close()
  capturePort = port
  port.onmessage = (event: MessageEvent<CaptureOutgoing>) => {
    try {
      if (event.data.type === 'pcm') onPcm(event.data, port)
    } catch (error) {
      fail(error)
    }
  }
}

function handle(event: MessageEvent<HostToWorker>): void {
  const message = event.data
  switch (message.type) {
    case 'init':
      init(message)
      break
    case 'connect': {
      const port = event.ports[0]
      if (port === undefined) throw new Error('connect message carries no MessagePort')
      connectCapture(port)
      break
    }
    case 'pcm':
      onPcm(message, undefined)
      break
    case 'recycle-frames':
      batcher?.recycle(message.buffers)
      break
    case 'stats':
      if (analyzer !== undefined && batcher !== undefined) {
        post({
          type: 'stats',
          analyzer: analyzer.getStats(),
          transport: batcher.getStats(),
          ...(tape === undefined ? {} : { recorder: tape.getStats() }),
        })
      }
      break
    case 'export-wav': {
      if (tape === undefined) throw new Error('Recording is off')
      const start = message.startSample ?? 0
      const count = message.count ?? tape.length - start
      const buffer = tapeToWav(tape, start, count)
      post({ type: 'wav', requestId: message.requestId, buffer }, [buffer])
      break
    }
    case 'read-pcm': {
      if (tape === undefined) throw new Error('Recording is off')
      const samples = tape.read(message.startSample, message.count)
      post(
        {
          type: 'pcm-slice',
          requestId: message.requestId,
          startSample: message.startSample,
          count: message.count,
          samples: samples.buffer as ArrayBuffer,
        },
        [samples.buffer as ArrayBuffer],
      )
      break
    }
  }
}

self.onmessage = (event: MessageEvent<HostToWorker>) => {
  try {
    handle(event)
  } catch (error) {
    fail(error)
  }
}
