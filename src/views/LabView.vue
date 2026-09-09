<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import {
  BeatGrid,
  classifyGestures,
  estimateLatency,
  frameCount,
  majorArpeggio,
  noteName,
  onsetTimes,
  scoreTake,
  segmentTake,
  summarizeContour,
  type ContourSummary,
  type NoteEvent,
  type NoteGesture,
  type TakeScore,
  type TakeSegmentation,
} from '@audio-core/core/index'
import { WorkerHost, type WorkerHostStats } from '@audio-core/host/web/worker-host'
import { WebTransport } from '@audio-core/host/web/web-transport'
import { fileFromBlob } from '@audio-core/io/file-source'
import { MicSource, type MicSourceInfo } from '@audio-core/io/mic-source'
import {
  drawLevel,
  drawPitch,
  drawSpectrum,
  followPitchRange,
  readTheme,
  type LabTheme,
  type PitchRange,
} from '@/lab/draw'

type LabState = 'idle' | 'starting' | 'running' | 'stopped'

const WINDOW_SECONDS = 6
const FEATURES = [
  'pitch',
  'level',
  'spectrum',
  'vibrato',
  'formants',
  'loudness',
  'cpp',
  'onset',
] as const

const MAUCH = { method: 'mauch' as const }

const state = ref<LabState>('idle')
const error = ref<string | null>(null)
const info = ref<MicSourceInfo | null>(null)
const devices = ref<MediaDeviceInfo[]>([])
const deviceId = ref('')
const stats = ref<WorkerHostStats | null>(null)
const segmentation = ref<TakeSegmentation | null>(null)
const exporting = ref(false)
const canExport = ref(false)
const bpm = ref(80)
const beatsPerBar = ref(4)
const metroOn = ref(false)
const calibrating = ref(false)
const alignSeconds = ref(0)
const alignSource = ref<'clock' | 'mic' | null>(null)
const takeScore = ref<TakeScore | null>(null)
const contour = ref<ContourSummary | null>(null)
const gestures = ref<NoteGesture[]>([])
const fileLabel = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const readout = reactive({
  note: '—',
  cents: NaN,
  hz: NaN,
  confidence: 0,
  dbfs: -Infinity,
  vibratoRate: NaN,
  vibratoExtent: NaN,
  f1: NaN,
  f2: NaN,
  f3: NaN,
  lufs: NaN,
  lufsIntegrated: NaN,
  cpp: NaN,
  frames: 0,
  seconds: 0,
})

const pitchCanvas = ref<HTMLCanvasElement | null>(null)
const levelCanvas = ref<HTMLCanvasElement | null>(null)
const spectrumCanvas = ref<HTMLCanvasElement | null>(null)

let mic: MicSource | null = null
let host: WorkerHost | null = null
let transport: WebTransport | null = null
let reference: NoteEvent[] = []
let raf = 0
let statsTimer = 0
let theme: LabTheme | null = null
let midiBuffer = new Float32Array(0)
let capacity = 0
const pitchRange: PitchRange = { lo: 48, hi: 72 }
let peakDb = -Infinity

async function start(): Promise<void> {
  if (state.value === 'starting') return
  error.value = null
  state.value = 'starting'
  await disposeSession()
  try {
    const source = new MicSource(deviceId.value === '' ? {} : { deviceId: deviceId.value })
    mic = source
    const micInfo = await source.start()

    const worker = new WorkerHost({
      sampleRate: micInfo.sampleRate,
      features: FEATURES,
      spectrumSnapshot: true,
      options: { f0: { tracker: 'pyin' } },
    })
    host = worker
    worker.onError((message) => {
      error.value = message
    })
    worker.attachCapture(source.createPort())
    await worker.ready

    capacity = Math.round(WINDOW_SECONDS * worker.timeline.frameRate)
    midiBuffer = new Float32Array(capacity)
    peakDb = -Infinity
    segmentation.value = null
    info.value = micInfo
    canExport.value = true
    takeScore.value = null
    contour.value = null
    gestures.value = []
    fileLabel.value = null
    reference = []
    alignSeconds.value = 0
    alignSource.value = null
    metroOn.value = false
    const ctx = source.audioContext
    transport = ctx === undefined ? null : new WebTransport(ctx)
    state.value = 'running'
    theme = readTheme()
    devices.value = await MicSource.listDevices()
    statsTimer = window.setInterval(refreshStats, 500)
    raf = requestAnimationFrame(loop)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    await disposeSession()
    state.value = 'stopped'
  }
}

async function stop(): Promise<void> {
  cancelAnimationFrame(raf)
  raf = 0
  window.clearInterval(statsTimer)
  statsTimer = 0
  transport?.stop()
  metroOn.value = false
  const source = mic
  mic = null
  await source?.stop()
  if (host !== null) {
    finishTake(host)
    stats.value = await host.getStats()
    paint()
  }
  state.value = 'stopped'
}

async function restart(): Promise<void> {
  await start()
}

async function disposeSession(): Promise<void> {
  cancelAnimationFrame(raf)
  raf = 0
  window.clearInterval(statsTimer)
  statsTimer = 0
  const source = mic
  const worker = host
  transport?.stop()
  transport = null
  metroOn.value = false
  mic = null
  host = null
  canExport.value = false
  fileLabel.value = null
  worker?.dispose()
  await source?.stop()
}

async function refreshStats(): Promise<void> {
  if (host === null) return
  stats.value = await host.getStats()
  segmentation.value = segmentTake(host.timeline)
}

function finishTake(worker: WorkerHost): void {
  segmentation.value = segmentTake(worker.timeline, 0, worker.timeline.length, MAUCH)
  gestures.value = classifyGestures(worker.timeline, segmentation.value.notes)
  contour.value = summarizeContour(worker.timeline)
  takeScore.value = scoreCurrent()
}

function waitForFrames(worker: WorkerHost, expected: number, timeoutMs = 60_000): Promise<void> {
  if (expected <= 0 || worker.timeline.length >= expected) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      stopListening()
      reject(new Error('Анализ файла не завершился'))
    }, timeoutMs)
    const stopListening = worker.onFrames(() => {
      if (worker.timeline.length >= expected) {
        window.clearTimeout(timer)
        stopListening()
        resolve()
      }
    })
  })
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined) return
  await analyzeFile(file)
}

async function analyzeFile(file: File): Promise<void> {
  if (state.value === 'starting') return
  error.value = null
  state.value = 'starting'
  await disposeSession()
  try {
    const source = await fileFromBlob(file)
    const worker = new WorkerHost({
      sampleRate: source.sampleRate,
      features: FEATURES,
      spectrumSnapshot: true,
      options: { f0: { tracker: 'pyin', pyinDelay: 0 } },
    })
    host = worker
    worker.onError((message) => {
      error.value = message
    })
    await worker.ready

    capacity = Math.round(WINDOW_SECONDS * worker.timeline.frameRate)
    midiBuffer = new Float32Array(capacity)
    peakDb = -Infinity
    segmentation.value = null
    gestures.value = []
    info.value = null
    fileLabel.value = source.label
    canExport.value = true
    takeScore.value = null
    contour.value = null
    reference = []
    alignSeconds.value = 0
    alignSource.value = null
    metroOn.value = false
    theme = readTheme()
    state.value = 'running'
    raf = requestAnimationFrame(loop)

    const expected = frameCount(
      source.samples.length,
      worker.context.frameSize,
      worker.context.hopSize,
    )
    const done = waitForFrames(worker, expected)
    for (const chunk of source.chunks()) worker.push(chunk)
    await done

    cancelAnimationFrame(raf)
    raf = 0
    finishTake(worker)
    stats.value = await worker.getStats()
    paint()
    state.value = 'stopped'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    await disposeSession()
    state.value = 'stopped'
  }
}

async function downloadWav(): Promise<void> {
  if (host === null || exporting.value) return
  exporting.value = true
  try {
    const buffer = await host.exportWav()
    const blob = new Blob([buffer], { type: 'audio/wav' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `lab-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`
    link.click()
    URL.revokeObjectURL(url)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    exporting.value = false
  }
}

function loop(): void {
  paint()
  if (state.value === 'running') raf = requestAnimationFrame(loop)
}

function paint(): void {
  const worker = host
  if (worker === null || theme === null) return
  const { timeline } = worker
  const length = timeline.length
  const windowStart = Math.max(0, length - capacity)
  const count = length - windowStart
  timeline.slice('midi', windowStart, length, midiBuffer)

  followPitchRange(pitchRange, midiBuffer, count, 0)
  if (pitchCanvas.value !== null) {
    drawPitch(
      pitchCanvas.value,
      {
        midi: midiBuffer,
        count,
        capacity,
        frameRate: timeline.frameRate,
        range: pitchRange,
        windowStart,
        notes: segmentation.value?.notes,
      },
      theme,
    )
  }

  const dbfs = timeline.latest('dbfs')
  peakDb = Math.max(dbfs, peakDb - 0.4)
  if (levelCanvas.value !== null) drawLevel(levelCanvas.value, { dbfs, peakDb }, theme)

  const magnitude = worker.latestSpectrum
  if (spectrumCanvas.value !== null && magnitude !== undefined) {
    drawSpectrum(
      spectrumCanvas.value,
      { magnitude, binHz: timeline.sampleRate / worker.context.frameSize },
      theme,
    )
  }

  const note = timeline.latest('note')
  readout.note = Number.isNaN(note) ? '—' : noteName(note)
  readout.cents = timeline.latest('cents')
  readout.hz = timeline.latest('f0')
  readout.confidence = timeline.latest('f0Confidence')
  readout.dbfs = dbfs
  readout.vibratoRate = timeline.latest('vibratoRate')
  readout.vibratoExtent = timeline.latest('vibratoExtent')
  readout.f1 = timeline.latest('f1')
  readout.f2 = timeline.latest('f2')
  readout.f3 = timeline.latest('f3')
  readout.lufs = timeline.latest('lufsMomentary')
  readout.lufsIntegrated = timeline.latest('lufsIntegrated')
  readout.cpp = timeline.latest('cpp')
  readout.frames = length
  readout.seconds = length === 0 ? 0 : timeline.frameTime(length - 1)
}

function currentGrid(): BeatGrid {
  return new BeatGrid({
    bpm: bpm.value,
    meter: { beatsPerBar: beatsPerBar.value, beatUnit: 4 },
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function refreshAlign(): void {
  const ctx = mic?.audioContext
  if (host === null || transport === null || ctx === undefined) return
  const clicks = transport.clicksScheduled
  if (clicks.length === 0) return
  const click = clicks.at(-1)
  if (click === undefined) return
  const sessionNow =
    host.timeline.length === 0 ? 0 : host.timeline.frameTime(host.timeline.length - 1)
  const sessionAtClick = sessionNow + (transport.audioOrigin + click.time - ctx.currentTime)
  alignSeconds.value = sessionAtClick - click.time
  if (alignSource.value === null) alignSource.value = 'clock'
}

function scoreCurrent(): TakeScore | null {
  if (host === null || reference.length === 0 || segmentation.value === null) return null
  return scoreTake(reference, segmentation.value.notes, currentGrid(), host.timeline, {
    latencySeconds: alignSeconds.value,
  })
}

async function toggleMetronome(): Promise<void> {
  if (state.value !== 'running' || transport === null) return
  if (metroOn.value) {
    transport.stop()
    metroOn.value = false
    return
  }
  await transport.start({
    grid: currentGrid(),
    metronome: true,
    onClick: refreshAlign,
  })
  metroOn.value = true
}

async function playReference(): Promise<void> {
  if (state.value !== 'running' || transport === null) return
  reference = majorArpeggio()
  takeScore.value = null
  await transport.start({
    grid: currentGrid(),
    metronome: true,
    notes: reference,
    onClick: refreshAlign,
  })
  metroOn.value = true
  const ms = (currentGrid().secondsPerBeat * 4 + 0.35) * 1000
  await sleep(ms)
  if (transport?.running) {
    transport.stop()
    metroOn.value = false
  }
}

async function calibrate(): Promise<void> {
  if (state.value !== 'running' || transport === null || host === null || calibrating.value) return
  calibrating.value = true
  try {
    await transport.start({
      grid: currentGrid(),
      metronome: true,
      onClick: refreshAlign,
    })
    metroOn.value = true
    await sleep((currentGrid().secondsPerBeat * 4 + 0.45) * 1000)
    refreshAlign()
    const expected = transport.clicksScheduled.map((click) => click.time)
    const detected = onsetTimes(host.timeline)
    const acoustic = estimateLatency(expected, detected)
    if (acoustic !== undefined && acoustic.hits >= 2) {
      alignSeconds.value = acoustic.seconds
      alignSource.value = 'mic'
    } else {
      alignSource.value = 'clock'
    }
    transport.stop()
    metroOn.value = false
  } finally {
    calibrating.value = false
  }
}

function flag(value: boolean | undefined): string {
  if (value === undefined) return 'n/a'
  return value ? 'ON' : 'off'
}

function formatHz(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—'
  return digits === 0 ? `${Math.round(value)}` : value.toFixed(digits)
}

function formatLufs(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} LUFS` : '—'
}

function formatCents(cents: number): string {
  if (Number.isNaN(cents)) return ''
  const rounded = Math.round(cents)
  return rounded > 0 ? `+${rounded}` : `${rounded}`
}

function gestureOf(index: number): string {
  return gestures.value[index]?.gesture ?? ''
}

onMounted(async () => {
  theme = readTheme()
  try {
    devices.value = await MicSource.listDevices()
  } catch {
    devices.value = []
  }
})

onBeforeUnmount(() => {
  void disposeSession()
})
</script>

<template>
  <main id="main" class="lab">
    <header class="lab__head">
      <div>
        <p class="kicker">audio-core · lab</p>
        <h1>Живой анализ</h1>
      </div>
      <div class="controls">
        <select
          v-model="deviceId"
          class="select"
          :disabled="state === 'starting'"
          aria-label="Устройство ввода"
          @change="state === 'running' && restart()"
        >
          <option value="">Микрофон по умолчанию</option>
          <option v-for="device in devices" :key="device.deviceId" :value="device.deviceId">
            {{ device.label || `Вход ${device.deviceId.slice(0, 6)}` }}
          </option>
        </select>
        <button
          v-if="state !== 'running'"
          type="button"
          class="btn btn--primary"
          :disabled="state === 'starting'"
          @click="start"
        >
          {{ state === 'starting' ? 'Запуск…' : 'Старт' }}
        </button>
        <button v-else type="button" class="btn" @click="stop">Стоп</button>
        <button
          v-if="canExport"
          type="button"
          class="btn"
          :disabled="exporting"
          @click="downloadWav"
        >
          {{ exporting ? 'WAV…' : 'Скачать WAV' }}
        </button>
        <input
          ref="fileInput"
          class="sr-only"
          type="file"
          accept="audio/*,.wav"
          aria-label="Аудиофайл"
          @change="onFile"
        />
        <button
          type="button"
          class="btn"
          :disabled="state === 'starting'"
          @click="fileInput?.click()"
        >
          Файл
        </button>
      </div>
    </header>

    <section class="music" aria-label="Метроном и референс">
      <label class="music__bpm">
        BPM
        <input v-model.number="bpm" type="number" min="40" max="208" :disabled="metroOn" />
      </label>
      <label class="music__meter">
        Размер
        <select v-model.number="beatsPerBar" :disabled="metroOn">
          <option :value="2">2/4</option>
          <option :value="3">3/4</option>
          <option :value="4">4/4</option>
          <option :value="5">5/4</option>
          <option :value="6">6/8</option>
        </select>
      </label>
      <button
        type="button"
        class="btn"
        :disabled="state !== 'running'"
        :aria-pressed="metroOn"
        @click="toggleMetronome"
      >
        Метроном
      </button>
      <button type="button" class="btn" :disabled="state !== 'running'" @click="playReference">
        Референс
      </button>
      <button
        type="button"
        class="btn"
        :disabled="state !== 'running' || calibrating"
        @click="calibrate"
      >
        {{ calibrating ? 'Калибровка…' : 'Калибровка' }}
      </button>
      <span v-if="alignSource" class="chip">
        align {{ (alignSeconds * 1000).toFixed(0) }} ms · {{ alignSource }}
      </span>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section v-if="info || fileLabel" class="status" aria-label="Состояние захвата">
      <span v-if="fileLabel" class="chip">{{ fileLabel }}</span>
      <template v-if="info">
        <span class="chip">{{ info.label || 'вход' }}</span>
        <span class="chip">{{ info.sampleRate }} Hz</span>
        <span class="chip" :class="{ 'chip--bad': info.processing.echoCancellation }">
          AEC {{ flag(info.processing.echoCancellation) }}
        </span>
        <span class="chip" :class="{ 'chip--bad': info.processing.noiseSuppression }">
          NS {{ flag(info.processing.noiseSuppression) }}
        </span>
        <span class="chip" :class="{ 'chip--bad': info.processing.autoGainControl }">
          AGC {{ flag(info.processing.autoGainControl) }}
        </span>
        <span v-if="info.baseLatency !== undefined" class="chip">
          latency {{ (info.baseLatency * 1000).toFixed(1) }} ms
        </span>
        <span class="chip">batch {{ info.batchSize }}</span>
        <span v-if="info.processed" class="chip chip--bad">сигнал обработан браузером</span>
      </template>
      <span v-if="stats?.recorder" class="chip">
        pcm {{ stats.recorder.seconds.toFixed(1) }} s · {{ stats.recorder.backend }}
      </span>
    </section>

    <section class="stage">
      <div class="panel panel--pitch">
        <div class="readout">
          <span class="readout__note">{{ readout.note }}</span>
          <span class="readout__cents">{{ formatCents(readout.cents) }}</span>
          <span class="readout__hz">
            {{ Number.isNaN(readout.hz) ? '' : `${readout.hz.toFixed(1)} Hz` }}
          </span>
          <span class="readout__conf">conf {{ readout.confidence.toFixed(2) }}</span>
        </div>
        <div class="readout readout--foot">
          <span v-if="Number.isFinite(readout.vibratoRate)">
            vib {{ readout.vibratoRate.toFixed(1) }} Hz ±{{ readout.vibratoExtent.toFixed(0) }}
          </span>
          <span v-else>vib —</span>
          <span
            >F1 {{ formatHz(readout.f1) }} · F2 {{ formatHz(readout.f2) }} · F3
            {{ formatHz(readout.f3) }}</span
          >
          <span>{{ formatLufs(readout.lufs) }}</span>
          <span v-if="Number.isFinite(readout.cpp)">cpp {{ readout.cpp.toFixed(1) }} dB</span>
        </div>
        <canvas ref="pitchCanvas" class="canvas canvas--pitch" aria-label="Кривая высоты" />
      </div>
      <div class="panel panel--level">
        <canvas ref="levelCanvas" class="canvas canvas--level" aria-label="Уровень" />
      </div>
      <div class="panel panel--spectrum">
        <canvas ref="spectrumCanvas" class="canvas canvas--spectrum" aria-label="Спектр" />
      </div>
    </section>

    <section class="meta" aria-label="Статистика">
      <span>frames {{ readout.frames }}</span>
      <span>{{ readout.seconds.toFixed(1) }} s</span>
      <span class="meta__level">
        level {{ Number.isFinite(readout.dbfs) ? `${readout.dbfs.toFixed(1)} dB` : '—' }}
      </span>
      <span>{{ formatLufs(readout.lufs) }}</span>
      <template v-if="stats">
        <span>gap {{ stats.analyzer.gapSamples }}</span>
        <span>overlap {{ stats.analyzer.overlapSamples }}</span>
        <span>pending {{ stats.transport.pendingFrames }}</span>
        <span>
          pool {{ stats.transport.columns.free }}/{{ stats.transport.columns.allocated }}
          <template v-if="stats.transport.spectra">
            · spectra {{ stats.transport.spectra.free }}/{{ stats.transport.spectra.allocated }}
          </template>
        </span>
        <span v-if="stats.recorder">
          tape {{ stats.recorder.hotSamples }} hot · {{ stats.recorder.coldChunks }} chunks
        </span>
      </template>
    </section>

    <section v-if="contour" class="score" aria-label="Контур">
      <header>
        <h2>Контур</h2>
        <p>{{ contour.voiced }} / {{ contour.frames }} voiced</p>
      </header>
      <p class="contour">
        <span>{{ formatLufs(contour.lufsMomentary) }}</span>
        <span v-if="Number.isFinite(contour.lufsIntegrated)">
          I {{ formatLufs(contour.lufsIntegrated) }}
        </span>
        <span v-if="Number.isFinite(contour.cpp)">cpp {{ contour.cpp.toFixed(1) }} dB</span>
        <span v-if="Number.isFinite(contour.vibratoRate)">
          vib {{ contour.vibratoRate.toFixed(1) }} Hz ±{{ contour.vibratoExtent.toFixed(0) }}
        </span>
        <span
          >F1 {{ formatHz(contour.f1) }} · F2 {{ formatHz(contour.f2) }} · F3
          {{ formatHz(contour.f3) }}</span
        >
      </p>
    </section>

    <section v-if="takeScore" class="score" aria-label="Оценка">
      <header>
        <h2>Оценка</h2>
        <p>
          {{ Math.round(takeScore.overall * 100) }}% · питч
          {{ Math.round(takeScore.pitch * 100) }} · ритм {{ Math.round(takeScore.rhythm * 100) }} ·
          {{ takeScore.matched }}/{{ takeScore.notes.length }}
        </p>
      </header>
      <ol>
        <li v-for="(note, index) in takeScore.notes" :key="index">
          <span class="score__name">{{ noteName(note.target.midi) }}</span>
          <span v-if="note.pitch" class="score__cents">{{ formatCents(note.pitch.cents) }}</span>
          <span v-else class="score__miss">нет</span>
          <span v-if="note.rhythm" class="score__ms">
            {{ (note.rhythm.offsetSeconds * 1000).toFixed(0) }} ms
          </span>
        </li>
      </ol>
    </section>

    <section v-if="segmentation && segmentation.notes.length > 0" class="notes" aria-label="Ноты">
      <header>
        <h2>Сегментация</h2>
        <p>
          {{ segmentation.phrases.length }} фр. · {{ segmentation.notes.length }} нот ·
          {{ segmentation.slides.length }} слайдов
        </p>
      </header>
      <ol>
        <li v-for="(note, index) in segmentation.notes" :key="`${note.startFrame}-${index}`">
          <span class="notes__name">{{ noteName(note.note) }}</span>
          <span class="notes__cents">{{ formatCents(note.cents) }}</span>
          <span class="notes__dur">{{ note.duration.toFixed(2) }} s</span>
          <span class="notes__how">{{ note.transition }}</span>
          <span v-if="gestureOf(index)" class="notes__how">{{ gestureOf(index) }}</span>
        </li>
      </ol>
    </section>
  </main>
</template>

<style scoped>
.lab {
  max-width: 1400px;
  margin: 0 auto;
  padding: 2rem 1rem 4rem;
}

.lab__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.kicker {
  margin: 0 0 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

h1 {
  margin: 0;
  font-size: clamp(1.6rem, 3vw, 2.2rem);
  font-weight: 600;
  letter-spacing: -0.035em;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.select {
  max-width: 20rem;
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--bg-raised);
  color: var(--ink);
  font: inherit;
}

.btn {
  padding: 0.55rem 1.25rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.btn--primary {
  border-color: transparent;
  background: var(--accent);
  color: var(--accent-ink);
}

.btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.error {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-core);
  background: color-mix(in srgb, var(--tonic) 22%, var(--bg-raised));
  color: var(--ink);
}

.status {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1rem;
}

.chip {
  padding: 0.25rem 0.7rem;
  border-radius: var(--radius-pill);
  background: var(--bg-raised);
  color: var(--muted);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.chip--bad {
  background: color-mix(in srgb, var(--tonic) 30%, var(--bg-raised));
  color: var(--ink);
}

.stage {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}

@media (min-width: 900px) {
  .stage {
    grid-template-columns: minmax(0, 1fr) 6.5rem;
    grid-template-rows: minmax(0, 1fr) 14rem;
  }

  .panel--pitch {
    grid-column: 1;
    grid-row: 1;
  }

  .panel--level {
    grid-column: 2;
    grid-row: 1 / span 2;
  }

  .panel--spectrum {
    grid-column: 1;
    grid-row: 2;
  }
}

.panel {
  position: relative;
  padding: 0.6rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-core);
  background: var(--bg-raised);
}

.canvas {
  display: block;
  width: 100%;
}

.canvas--pitch {
  height: 22rem;
}

.canvas--level {
  height: 100%;
  min-height: 14rem;
}

.canvas--spectrum {
  height: 12.5rem;
}

.readout {
  position: absolute;
  top: 0.9rem;
  right: 1.1rem;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}

.readout__note {
  font-size: 2.4rem;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1;
}

.readout__cents {
  min-width: 2.2rem;
  font-size: 1.1rem;
  color: var(--accent);
}

.readout__hz,
.readout__conf {
  font-size: 0.85rem;
  color: var(--muted);
}

.readout--foot {
  top: auto;
  bottom: 0.75rem;
  left: 1.1rem;
  right: 1.1rem;
  justify-content: flex-start;
  flex-wrap: wrap;
  font-size: 0.8rem;
  color: var(--muted);
}

.contour {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 0.9rem;
  color: var(--muted);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.notes {
  margin-top: 1.75rem;
  max-width: 36rem;
}

.notes header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.6rem;
}

.notes h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
}

.notes p {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
}

.notes ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

.notes li {
  display: grid;
  grid-template-columns: 3.2rem 2.4rem 4.2rem 4.2rem 1fr;
  gap: 0.75rem;
  padding: 0.45rem 0;
  border-top: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}

.notes__name {
  font-weight: 600;
}

.notes__cents {
  color: var(--accent);
}

.notes__dur,
.notes__how {
  color: var(--muted);
  font-size: 0.9rem;
}

.music {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
  margin: 0 0 1rem;
}

.music__bpm,
.music__meter {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--muted);
  font-size: 0.85rem;
}

.music input,
.music select {
  width: 4.5rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--bg-raised);
  color: var(--ink);
  font: inherit;
}

.btn[aria-pressed='true'] {
  border-color: transparent;
  background: var(--ink);
  color: var(--bg);
}

.score {
  margin-top: 1.75rem;
  max-width: 36rem;
}

.score header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.6rem;
}

.score h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
}

.score p {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
}

.score ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

.score li {
  display: grid;
  grid-template-columns: 3.2rem 2.8rem 5rem;
  gap: 0.75rem;
  padding: 0.45rem 0;
  border-top: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}

.score__name {
  font-weight: 600;
}

.score__cents {
  color: var(--accent);
}

.score__ms,
.score__miss {
  color: var(--muted);
  font-size: 0.9rem;
}
</style>
