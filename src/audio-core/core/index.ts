// Public surface of the platform-agnostic core.

// model
export type { AudioChunk } from './model/audio'
export { chunkSamples, frameCount, samplesToSeconds, secondsToSamples } from './model/audio'
export type { NoteEvent } from './model/note'
export { noteEnd } from './model/note'
export {
  A4_MIDI,
  DEFAULT_A4,
  NOTE_NAMES,
  centsBetween,
  centsOffNearest,
  hzToMidi,
  midiToHz,
  nearestMidi,
  noteName,
} from './model/pitch'
export type { TimelineSpec } from './model/timeline'
export { Column, Timeline } from './model/timeline'

// clock
export type { BarPosition, BeatGridSpec, Meter, NearestBeat } from './clock/beat-grid'
export { BeatGrid, COMMON_TIME } from './clock/beat-grid'
export type { GridChange, GridSegment, GridWindow, MapPosition } from './clock/tempo-map'
export { TempoMap } from './clock/tempo-map'

// synthesis
export type { ClickEvent, ClickLevel } from './synthesis/metronome'
export { beatsPerGroup, metronomeClicks } from './synthesis/metronome'
export type { NoteTrigger } from './synthesis/reference'
export { majorArpeggio, referenceTriggers } from './synthesis/reference'
export { renderClick } from './synthesis/click'
export { TONE_RELEASE_SECONDS, renderTone } from './synthesis/tone'

// scoring
export type { LatencyEstimate, LatencyOptions } from './scoring/latency'
export { estimateLatency } from './scoring/latency'
export type { OnsetOptions } from './scoring/onsets'
export { onsetTimes } from './scoring/onsets'
export type {
  LevelScore,
  NoteScore,
  PitchScore,
  RhythmScore,
  ScoreOptions,
  TakeScore,
} from './scoring/score'
export { scoreTake, velocityToDb } from './scoring/score'

// dsp
export { Fft, RealFft } from './dsp/fft'
export type { WindowType } from './dsp/window'
export {
  applyWindow,
  blackmanHarris,
  gaussian,
  hamming,
  hann,
  makeWindow,
  windowSum,
} from './dsp/window'
export { amplitudeToDb, dbToAmplitude, peak, rms } from './dsp/level'
export { parabolicOffset, parabolicValue, sinc } from './dsp/interpolate'
export { Biquad, SosFilter, biquadMagnitude, lowpassBiquad, resonatorBiquad } from './dsp/biquad'
export type { BiquadCoeffs } from './dsp/biquad'
export { kWeighting, kWeightingGain, kWeightingCoeffs } from './dsp/k-weight'
export { LUFS_OFFSET, meanSquareToLufs, gatedIntegrated, relativeGated } from './dsp/lufs'
export { burg, createBurgScratch, lpcFormants } from './dsp/lpc'
export type { BurgScratch, Formant } from './dsp/lpc'
export { durandKerner } from './dsp/roots'
export type { YinOptions, YinResult } from './dsp/yin'
export { Yin } from './dsp/yin'
export type { PyinOptions, PyinResult } from './dsp/pyin'
export { PyinTracker } from './dsp/pyin'
export { Cepstrum, cepstralPeakProminence } from './dsp/cepstrum'

// analysis
export type {
  AnalysisContext,
  AnyExtractor,
  ColumnWriter,
  Extractor,
  ExtractorInstance,
  FrameInput,
  ResultReader,
} from './analysis/extractor'
export { defineExtractor } from './analysis/extractor'
export type {
  AnalyzerConfig,
  AnalyzerStats,
  ExtractorOptions,
  FrameListener,
} from './analysis/analyzer'
export {
  Analyzer,
  DEFAULT_FRAME_SIZE,
  createAnalyzer,
  defaultHopSize,
  resolveAnalysisContext,
} from './analysis/analyzer'
export { collectColumns, resolveExtractors } from './analysis/graph'
export { extractorRegistry, resolveFeatureIds } from './analysis/registry'
export { FrameBuffer } from './analysis/frame-buffer'
export { analyzeOffline } from './analysis/offline'
export type { SpectrumOptions, SpectrumResult } from './analysis/extractors/spectrum'
export { spectrum } from './analysis/extractors/spectrum'
export type { LevelOptions, LevelResult } from './analysis/extractors/level'
export { level } from './analysis/extractors/level'
export type { F0Options, F0Result } from './analysis/extractors/f0'
export { f0 } from './analysis/extractors/f0'
export type { PitchOptions, PitchResult } from './analysis/extractors/pitch'
export { pitch } from './analysis/extractors/pitch'
export type { VibratoOptions, VibratoResult } from './analysis/extractors/vibrato'
export { vibrato } from './analysis/extractors/vibrato'
export type { FormantsOptions, FormantsResult } from './analysis/extractors/formants'
export { formants } from './analysis/extractors/formants'
export type { LoudnessOptions, LoudnessResult } from './analysis/extractors/loudness'
export { loudness } from './analysis/extractors/loudness'
export type { CppOptions, CppResult } from './analysis/extractors/cpp'
export { cpp } from './analysis/extractors/cpp'
export type {
  OnsetOptions as OnsetExtractorOptions,
  OnsetResult,
} from './analysis/extractors/onset'
export { onset } from './analysis/extractors/onset'
export type { HarmonicsOptions, HarmonicsResult } from './analysis/extractors/harmonics'
export { HARMONIC_COUNT, harmonics } from './analysis/extractors/harmonics'
export type { ContourSummary } from './analysis/contour-stats'
export { summarizeContour } from './analysis/contour-stats'

// session
export type { PcmBackend, PcmColdStore, PcmTapeOptions, PcmTapeStats } from './session/pcm-tape'
export {
  DEFAULT_CHUNK_SECONDS,
  DEFAULT_HOT_SECONDS,
  MemoryColdStore,
  PcmTape,
} from './session/pcm-tape'
export { decodeInt16, encodeInt16, floatToInt16, int16ToFloat, INT16_MAX } from './session/pcm'
export type { WavAudio } from './session/wav'
export { decodeWav, encodeWav, isWav } from './session/wav'
export { analyzeTape, analyzeWav, tapeToWav } from './session/offline'
export type { Take } from './session/session'
export { Session } from './session/session'

// segmentation
export type {
  FrameSpan,
  NoteSegment,
  NoteTransition,
  Phrase,
  Slide,
  TakeSegmentation,
} from './segmentation/types'
export type { SegmentationOptions } from './segmentation/index'
export type { MauchOptions } from './segmentation/mauch'
export type { GestureOptions, NoteGesture, PitchGesture } from './segmentation/gestures'
export { classifyGestures, segmentTake, transcribeNotes } from './segmentation/index'

// transport (host ↔ worker ↔ capture)
export type {
  CaptureIncoming,
  CaptureOutgoing,
  FramesMessage,
  HostToWorker,
  InitMessage,
  PcmMessage,
  PoolStats,
  ReadyMessage,
  RecorderStats,
  TransportStats,
  WorkerToHost,
} from './transport/protocol'
export { CAPTURE_PROCESSOR_NAME } from './transport/protocol'
export { BufferPool } from './transport/buffer-pool'
export type { FrameBatch, FrameBatcherOptions } from './transport/frame-batcher'
export { FrameBatcher } from './transport/frame-batcher'
export type { FramesListener } from './transport/timeline-mirror'
export { TimelineMirror } from './transport/timeline-mirror'
