import { onScopeDispose, readonly, ref, shallowRef } from 'vue'
import {
  FaceLandmarker,
  type Classifications,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'

/** Face Landmarker (MediaPipe Face Mesh, 478 points + blendshapes), float16 build. */
const MODEL_URL_DEFAULT =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

/** Face Mesh landmark indices used for the mouth. */
const LIP_UPPER_INNER = 13
const LIP_LOWER_INNER = 14
const MOUTH_CORNER_RIGHT = 61
const MOUTH_CORNER_LEFT = 291
const EYE_OUTER_RIGHT = 33
const EYE_OUTER_LEFT = 263

/** How the mouth looks in one video frame; every value is in [0, 1], ready for `MouthFigure`. */
export interface MouthShape {
  /** How open the mouth is: the `jawOpen` blendshape. */
  readonly open: number
  /** How narrowed (rounded, pursed) the lips are: the larger of `mouthPucker` and `mouthFunnel`. */
  readonly narrow: number
  /** Gap between the inner lips, over the range seen so far. */
  readonly aperture: number
  /** Distance between the mouth corners, over the range seen so far. */
  readonly width: number
  /** Geometry in inter-ocular distances (outer eye corners), before scaling to [0, 1]. */
  readonly raw: { readonly aperture: number; readonly width: number }
  /** `performance.now()` of the frame, ms. */
  readonly time: number
}

/**
 * Starting ranges of the raw geometry, in inter-ocular distances. They widen to whatever the face
 * shows, so the figure reaches its extremes for this face and camera.
 */
const APERTURE_RANGE: Range = { min: 0, max: 0.35 }
const WIDTH_RANGE: Range = { min: 0.4, max: 0.6 }

interface Range {
  min: number
  max: number
}

export type MouthTrackerStatus = 'idle' | 'loading' | 'running' | 'error'

export interface MouthTrackerOptions {
  /** URL of `face_landmarker.task`; defaults to Google's hosted model. */
  modelUrl?: string
  /** Inference backend; GPU falls back to CPU if it fails to start. */
  delegate?: 'GPU' | 'CPU'
  /** Camera constraints; the front camera at 640×480 by default. */
  video?: MediaTrackConstraints
  /** Share of the previous frame kept in each value, [0, 1): 0 is raw, higher is calmer. */
  smoothing?: number
}

/**
 * Webcam + MediaPipe Face Landmarker: tracks one face and reports how open and how narrowed the
 * mouth is on every new camera frame. The model and camera start on `start()`, the camera is
 * released on `stop()` and everything is freed when the owning scope is disposed.
 */
export function useMouthTracker(options: MouthTrackerOptions = {}) {
  const status = ref<MouthTrackerStatus>('idle')
  const error = shallowRef<Error | null>(null)
  /** The latest mouth shape; `null` while no face is in view. */
  const mouth = shallowRef<MouthShape | null>(null)
  /** The camera stream, for a preview `<video>`; `null` while stopped. */
  const stream = shallowRef<MediaStream | null>(null)

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true

  let landmarker: Promise<FaceLandmarker> | null = null
  let run = 0
  let frameRequest: number | null = null
  let lastVideoTime = -1
  let lastTimestamp = 0
  const smoothing = Math.min(0.95, Math.max(0, options.smoothing ?? 0.4))
  const apertureRange = { ...APERTURE_RANGE }
  const widthRange = { ...WIDTH_RANGE }

  function loadLandmarker(): Promise<FaceLandmarker> {
    landmarker ??= createLandmarker(options).catch((cause: unknown) => {
      landmarker = null
      throw cause
    })
    return landmarker
  }

  async function start(): Promise<void> {
    if (status.value === 'loading' || status.value === 'running') return
    const id = ++run
    status.value = 'loading'
    error.value = null
    try {
      const [detector, media] = await Promise.all([
        loadLandmarker(),
        navigator.mediaDevices.getUserMedia({
          video: options.video ?? { facingMode: 'user', width: 640, height: 480 },
          audio: false,
        }),
      ])
      if (id !== run) {
        stopTracks(media)
        return
      }
      stream.value = media
      video.srcObject = media
      await video.play()
      if (id !== run) return
      status.value = 'running'
      lastVideoTime = -1
      scheduleFrame(() => track(detector, id))
    } catch (cause) {
      if (id !== run) return
      release()
      error.value = trackerError(cause)
      status.value = 'error'
    }
  }

  function stop(): void {
    run++
    release()
    status.value = 'idle'
  }

  function track(detector: FaceLandmarker, id: number): void {
    if (id !== run) return
    if (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.currentTime !== lastVideoTime
    ) {
      lastVideoTime = video.currentTime
      // The detector needs strictly increasing timestamps.
      const now = Math.max(performance.now(), lastTimestamp + 1)
      lastTimestamp = now
      const result = detector.detectForVideo(video, now)
      const landmarks = result.faceLandmarks[0]
      mouth.value = landmarks
        ? shape(
            measure(landmarks, result.faceBlendshapes[0], video.videoWidth, video.videoHeight),
            now,
          )
        : null
    }
    scheduleFrame(() => track(detector, id))
  }

  /** Scale the geometry into its ranges and ease every value towards the new frame. */
  function shape(frame: MouthMeasure, time: number): MouthShape {
    const previous = mouth.value
    const ease = (next: number, before: number | undefined) =>
      before === undefined ? next : before + (next - before) * (1 - smoothing)
    return {
      open: ease(frame.open, previous?.open),
      narrow: ease(frame.narrow, previous?.narrow),
      aperture: ease(scale(frame.aperture, apertureRange), previous?.aperture),
      width: ease(scale(frame.width, widthRange), previous?.width),
      raw: { aperture: frame.aperture, width: frame.width },
      time,
    }
  }

  function scheduleFrame(callback: () => void): void {
    frameRequest =
      'requestVideoFrameCallback' in video
        ? video.requestVideoFrameCallback(callback)
        : requestAnimationFrame(callback)
  }

  function release(): void {
    if (frameRequest !== null) {
      if ('cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(frameRequest)
      else cancelAnimationFrame(frameRequest)
      frameRequest = null
    }
    video.pause()
    video.srcObject = null
    if (stream.value) stopTracks(stream.value)
    stream.value = null
    mouth.value = null
  }

  onScopeDispose(() => {
    stop()
    landmarker?.then((detector) => detector.close()).catch(() => {})
    landmarker = null
  })

  return {
    status: readonly(status),
    error: readonly(error),
    mouth: readonly(mouth),
    stream: readonly(stream),
    start,
    stop,
  }
}

export type MouthTracker = ReturnType<typeof useMouthTracker>

async function createLandmarker(options: MouthTrackerOptions): Promise<FaceLandmarker> {
  const fileset = { wasmLoaderPath, wasmBinaryPath }
  const create = (delegate: 'GPU' | 'CPU') =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: options.modelUrl ?? MODEL_URL_DEFAULT, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
    })
  const delegate = options.delegate ?? 'GPU'
  try {
    return await create(delegate)
  } catch (cause) {
    if (delegate === 'CPU') throw cause
    return create('CPU')
  }
}

interface MouthMeasure {
  open: number
  narrow: number
  aperture: number
  width: number
}

function measure(
  landmarks: readonly NormalizedLandmark[],
  blendshapes: Classifications | undefined,
  frameWidth: number,
  frameHeight: number,
): MouthMeasure {
  // Landmarks are normalized per axis; scale back to pixels so distances keep the frame's aspect.
  const distance = (a: number, b: number): number => {
    const p = landmarks[a]
    const q = landmarks[b]
    if (!p || !q) return 0
    return Math.hypot((p.x - q.x) * frameWidth, (p.y - q.y) * frameHeight)
  }
  const eyes = distance(EYE_OUTER_RIGHT, EYE_OUTER_LEFT) || 1
  const score = (name: string): number =>
    blendshapes?.categories.find((category) => category.categoryName === name)?.score ?? 0

  return {
    open: score('jawOpen'),
    narrow: Math.max(score('mouthPucker'), score('mouthFunnel')),
    aperture: distance(LIP_UPPER_INNER, LIP_LOWER_INNER) / eyes,
    width: distance(MOUTH_CORNER_RIGHT, MOUTH_CORNER_LEFT) / eyes,
  }
}

/** Where `value` falls in `range`, widening the range to include it. */
function scale(value: number, range: Range): number {
  range.min = Math.min(range.min, value)
  range.max = Math.max(range.max, value)
  return (value - range.min) / (range.max - range.min || 1)
}

/** A readable error for the screen; the original stays in `cause`. */
function trackerError(cause: unknown): Error {
  const name = cause instanceof DOMException ? cause.name : ''
  const message =
    name === 'NotAllowedError' || name === 'SecurityError'
      ? 'Нет доступа к камере — разреши её в настройках браузера'
      : name === 'NotFoundError' || name === 'OverconstrainedError'
        ? 'Камера не найдена'
        : name === 'NotReadableError' || name === 'AbortError'
          ? 'Камера занята другим приложением'
          : 'Не удалось запустить распознавание лица'
  return new Error(message, { cause })
}

function stopTracks(media: MediaStream): void {
  for (const track of media.getTracks()) track.stop()
}
