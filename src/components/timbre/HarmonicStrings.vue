<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Strength of harmonics 1…3 in [0, 1]: thickness and swing of the strings, H1 at the bottom. */
    strengths: readonly [number, number, number]
    /**
     * How well the ratio fits the task in [0, 1]: the strings draw together and braid as it rises
     * and twist into a ring at 1, staying one while it holds.
     */
    success?: number
    /** Strengths the strings should reach, drawn as dashed guides around H2 and H3. */
    targets?: readonly [number, number, number] | null
    /** Harmonics to ask for (2 and/or 3): their strings and names pulse. */
    lacking?: readonly number[]
    labels?: readonly [string, string, string]
    label?: string
  }>(),
  {
    success: 0,
    targets: null,
    lacking: () => [],
    labels: () => ['основа', 'полнота', 'звон'],
    label: 'Гармоники голоса',
  },
)

const emit = defineEmits<{
  /** The strings have just twisted into a ring. */
  braided: []
}>()

/** Drawing space; the canvas scales it to fit. */
const VIEW_WIDTH = 640
const VIEW_HEIGHT = 220
/** Half-length of a string. */
const HALF = 250
/** Distance between neighbouring strings. */
const GAP = 36
const RING_RADIUS = 80
/** Largest swing of a string at full strength. */
const SWING = 9
/** Success needed to form the ring, and the level it falls apart below. */
const RING_ON = 0.98
const RING_OFF = 0.9
const RING_IN_SECONDS = 0.6
const RING_OUT_SECONDS = 0.7

type Rgb = readonly [number, number, number]

interface Palette {
  ink: Rgb
  muted: Rgb
  accent: Rgb
  tone: Rgb
  font: string
}

interface Particle {
  angle: number
  speed: number
  distance: number
  life: number
  size: number
}

const canvasRef = useTemplateRef<HTMLCanvasElement>('canvas')

let context: CanvasRenderingContext2D | null = null
let width = 0
let height = 0
let palette: Palette | null = null
let raf = 0
let last = 0
let time = 0
const shown: [number, number, number] = [0, 0, 0]
let converge = 0
let ring = false
/** Linear progress of the ring morph, 0–1; drawn eased. */
let morph = 0
let spin = 0
let particles: Particle[] = []
let waves: { radius: number; life: number }[] = []
let reducedMotion = false

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]
const rgba = (c: Rgb, alpha = 1) =>
  `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${alpha})`

/** The app's colour tokens as RGB, resolved through the canvas so any CSS colour works. */
function readPalette(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): Palette {
  const style = getComputedStyle(canvas)
  const resolve = (name: string, fallback: Rgb): Rgb => {
    ctx.fillStyle = '#000'
    ctx.fillStyle = style.getPropertyValue(name).trim() || '#000'
    const value = String(ctx.fillStyle)
    const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1]
    if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb
    const parts = /rgba?\(([^)]+)\)/.exec(value)?.[1]?.split(',').map(Number)
    return parts && parts.length >= 3 ? [parts[0]!, parts[1]!, parts[2]!] : fallback
  }
  return {
    ink: resolve('--ink', [236, 234, 228]),
    muted: resolve('--muted', [154, 160, 168]),
    accent: resolve('--accent', [212, 184, 74]),
    tone: resolve('--tone', [79, 154, 98]),
    font: style.fontFamily,
  }
}

function resize(): void {
  const canvas = canvasRef.value
  if (!canvas || !context) return
  const rect = canvas.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  width = rect.width
  height = rect.height
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
}

function burst(): void {
  waves.push({ radius: 0, life: 1 })
  if (reducedMotion) return
  for (let i = 0; i < 36; i++) {
    particles.push({
      angle: Math.random() * Math.PI * 2,
      speed: 50 + Math.random() * 110,
      distance: 0,
      life: 1,
      size: 1.2 + Math.random() * 1.8,
    })
  }
}

function step(dt: number): void {
  time += dt
  const follow = 1 - Math.exp(-dt * 12)
  for (let k = 0; k < 3; k++) {
    const target = clamp01(props.strengths[k] ?? 0)
    shown[k] = shown[k]! + (target - shown[k]!) * follow
  }
  const success = clamp01(props.success)
  converge += (success - converge) * (1 - Math.exp(-dt * 6))
  if (!ring && success >= RING_ON) {
    ring = true
    burst()
    emit('braided')
  } else if (ring && success < RING_OFF) {
    ring = false
  }
  morph = reducedMotion
    ? Number(ring)
    : ring
      ? Math.min(1, morph + dt / RING_IN_SECONDS)
      : Math.max(0, morph - dt / RING_OUT_SECONDS)
  spin += dt * (0.3 + 1.2 * ease(morph))
  for (const wave of waves) {
    wave.radius += dt * 150
    wave.life -= dt * 0.9
  }
  waves = waves.filter((wave) => wave.life > 0)
  for (const particle of particles) {
    particle.distance += particle.speed * dt
    particle.life -= dt * 0.9
  }
  particles = particles.filter((particle) => particle.life > 0)
}

function draw(): void {
  const ctx = context
  const colors = palette
  if (!ctx || !colors || width === 0) return
  ctx.clearRect(0, 0, width, height)
  const scale = Math.min(width / VIEW_WIDTH, height / VIEW_HEIGHT)
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.scale(scale, scale)

  const ringShape = ease(morph)
  const motion = reducedMotion ? 0 : 1
  const pulse = 0.5 + 0.5 * Math.sin(time * 6)
  const base = [GAP, 0, -GAP].map((y) => y * (1 - 0.85 * converge))
  const asked = (harmonic: number) => !ring && props.lacking.includes(harmonic)

  // Names, pins and target guides belong to the open strings and fade as the ring forms.
  const chrome = 1 - Math.min(1, ringShape / 0.3)
  if (chrome > 0) {
    ctx.globalAlpha = chrome
    ctx.font = `${12 / scale}px ${colors.font}`
    ctx.textAlign = 'left'
    for (let k = 0; k < 3; k++) {
      const y = base[k]!
      // Names would overlap as the strings draw together, so they give way first.
      const named = Math.max(0, 1 - converge * 2.5)
      ctx.fillStyle = asked(k + 1)
        ? rgba(colors.accent, (0.5 + 0.5 * pulse) * named)
        : rgba(colors.muted, named)
      ctx.fillText(props.labels[k] ?? '', -HALF, y - 8 / scale)
      ctx.fillStyle = rgba(colors.muted)
      for (const x of [-HALF, HALF]) {
        ctx.beginPath()
        ctx.arc(x, y, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    const targets = props.targets
    if (targets && converge < 0.5) {
      ctx.setLineDash([3, 5])
      ctx.lineWidth = 1
      ctx.strokeStyle = rgba(colors.muted, 0.45 * (1 - converge * 2))
      for (let k = 1; k < 3; k++) {
        const amplitude = SWING * clamp01(targets[k] ?? 0) + 1
        for (const side of [1, -1]) {
          ctx.beginPath()
          for (let j = 0; j <= 120; j++) {
            const u = j / 120
            const x = -HALF + 2 * HALF * u
            const y = base[k]! + side * amplitude * Math.abs(Math.sin((k + 1) * Math.PI * u))
            if (j === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
      }
      ctx.setLineDash([])
    }
    ctx.globalAlpha = 1
  }

  // Each string vibrates in its own mode — one, two, three loops — like a real string's partials.
  const own = [colors.muted, colors.ink, colors.accent]
  const green = Math.max(ringShape, converge * converge)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let k = 2; k >= 0; k--) {
    const mode = k + 1
    const strength = shown[k]!
    const amplitude = SWING * strength * motion
    const angular = Math.PI * 2 * 1.6 * mode
    ctx.lineWidth = 1 + 3.5 * strength
    ctx.strokeStyle = rgba(mix(own[k]!, colors.tone, green), asked(mode) ? 0.55 + 0.45 * pulse : 1)
    ctx.beginPath()
    for (let j = 0; j <= 180; j++) {
      const u = j / 180
      const wave = amplitude * Math.sin(mode * Math.PI * u) * Math.sin(angular * time + k)
      const braid =
        10 * converge * Math.sin(Math.PI * 4 * u + time * 3 * motion + (k * Math.PI * 2) / 3)
      const lineX = -HALF + 2 * HALF * u
      const lineY = base[k]! + braid + wave
      const angle = -Math.PI / 2 + Math.PI * 2 * u + spin * 0.5
      const radius = RING_RADIUS + braid * 0.8 + wave * 0.6
      const x = lineX + (radius * Math.cos(angle) - lineX) * ringShape
      const y = lineY + (radius * Math.sin(angle) - lineY) * ringShape
      if (j === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  ctx.lineWidth = 1.5
  for (const wave of waves) {
    ctx.strokeStyle = rgba(colors.tone, wave.life)
    ctx.beginPath()
    ctx.arc(0, 0, RING_RADIUS + wave.radius, 0, Math.PI * 2)
    ctx.stroke()
  }
  for (const particle of particles) {
    const distance = RING_RADIUS + particle.distance
    ctx.fillStyle = rgba(particle.size > 2.4 ? colors.accent : colors.tone, particle.life)
    ctx.beginPath()
    ctx.arc(
      Math.cos(particle.angle) * distance,
      Math.sin(particle.angle) * distance,
      particle.size,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
  ctx.restore()
}

function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
  last = now
  step(dt)
  draw()
  raf = requestAnimationFrame(frame)
}

let observer: ResizeObserver | null = null
const schemes = window.matchMedia('(prefers-color-scheme: dark)')
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
const refreshPalette = () => {
  if (canvasRef.value && context) palette = readPalette(canvasRef.value, context)
}
const refreshMotion = () => {
  reducedMotion = motionQuery.matches
}

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  context = canvas.getContext('2d')
  refreshPalette()
  refreshMotion()
  schemes.addEventListener('change', refreshPalette)
  motionQuery.addEventListener('change', refreshMotion)
  observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()
  last = performance.now()
  raf = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  observer?.disconnect()
  schemes.removeEventListener('change', refreshPalette)
  motionQuery.removeEventListener('change', refreshMotion)
})
</script>

<template>
  <canvas ref="canvas" class="strings" role="img" :aria-label="label" />
</template>

<style scoped>
.strings {
  display: block;
  width: 100%;
  aspect-ratio: 640 / 220;
}
</style>
