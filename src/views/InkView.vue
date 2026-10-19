<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { TakeNote, TakeSource } from '@/components/pitch/inkTake'
import InkScroll from '@/components/pitch/InkScroll.vue'
import { useExerciseSession } from '@/composables/useExerciseSession'
import { INK_PHRASE } from './inkPhrase'

// The test, on the phone: a phrase to hear, then to sing into the microphone while its notes drift
// past the line; then the sheet is the card. The phrase is kept as notes (found by the engine in the
// a cappella recording of 19 October) and heard by synthesis. Nothing is kept beyond the page.

type Stage = 'loading' | 'ready' | 'hearing' | 'singing' | 'done'
const target = shallowRef<TakeNote[]>(
  INK_PHRASE.map(([midi, start, end]) => ({ midi, start, end })),
)
const stage = ref<Stage>('ready')
const status = ref(`${target.value.length} нот · сначала услышь, потом спой`)
const now = ref(0)
const score = ref(0)
const verdict = ref('')
const detail = ref('')

const session = useExerciseSession({})
const { micState, error, pitch } = session

/**
 * The take, gathered from the microphone's recent frames as they come while singing. Frame times
 * are on the trace clock.
 */
const takeMidi: number[] = []
const takeLevel: number[] = []
let takeFirst = 0
let takeRate = 50
let takeLast = -Infinity
const take = {
  length: () => takeMidi.length,
  frameRate: () => takeRate,
  timeOf: (index: number) => takeFirst + index / takeRate,
  read(begin: number, end: number, midi: Float32Array, lvl: Float32Array) {
    for (let i = begin; i < end; i++) {
      midi[i - begin] = takeMidi[i] ?? NaN
      lvl[i - begin] = takeLevel[i] ?? 0
    }
  },
}
function clearTake(): void {
  takeMidi.length = 0
  takeLevel.length = 0
  takeLast = -Infinity
  origin = NaN
}
watch(pitch, (trace) => {
  if (stage.value !== 'singing' || trace.length === 0) return
  const rate = trace.frameRate
  for (let k = 0; k < trace.length; k++) {
    const time = trace.endTime - (trace.length - 1 - k) / rate
    if (time <= takeLast + 0.5 / rate) continue
    if (takeMidi.length === 0) {
      takeFirst = time
      takeRate = rate
      // The phrase starts half a second after the first frame heard.
      origin = time + 0.5
    }
    takeMidi.push(trace.midi[k] ?? NaN)
    takeLevel.push(trace.level[k] ?? 0)
    takeLast = time
  }
})

/**
 * Exercise time: seconds of the phrase, 0 where its recording starts. The microphone's frames are
 * on the trace clock; `origin` is the trace-clock moment the phrase was started from.
 */
let origin = NaN
const live: TakeSource = {
  length: () => take.length(),
  frameRate: () => take.frameRate(),
  timeOf: (index) => take.timeOf(index) - origin,
  read: (begin, end, midi, lvl) => take.read(begin, end, midi, lvl),
}
/** What the sheet reads: the microphone while singing, a copy of the take once it is the card. */
const source = shallowRef<TakeSource>(live)

/** The phrase's span in exercise time, with a breath before and after. */
const span = computed(() => ({
  from: Math.max(0, (target.value[0]?.start ?? 0) - 0.6),
  to: (target.value[target.value.length - 1]?.end ?? 15) + 0.6,
}))

let raf = 0
/** The synth that plays the phrase, made on the first tap so the phone lets it sound. */
let audio: AudioContext | null = null

const PC = ['до', 'до♯', 'ре', 'ми♭', 'ми', 'фа', 'фа♯', 'соль', 'ля♭', 'ля', 'си♭', 'си']
const nameOf = (midi: number) => PC[((Math.round(midi) % 12) + 12) % 12]!

/** The phrase plays while the sheet drifts past the line, so the singer knows what comes. */
function hear(): void {
  stage.value = 'hearing'
  status.value = 'Слушай: так звучит фраза'
  audio ??= new AudioContext()
  const ctx = audio
  void ctx.resume().catch(() => {
    status.value = 'Звук не включился — проверь, что телефон не на беззвучном'
  })
  const t0 = ctx.currentTime + 0.1
  for (const note of target.value) {
    const freq = 440 * 2 ** ((note.midi - 69) / 12)
    const begin = t0 + note.start
    const end = t0 + note.end
    for (const [type, peak] of [
      ['triangle', 0.35],
      ['sine', 0.25],
    ] as const) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, begin)
      gain.gain.linearRampToValueAtTime(peak, begin + 0.02)
      gain.gain.setValueAtTime(peak, Math.max(begin + 0.02, end))
      gain.gain.linearRampToValueAtTime(0, Math.max(begin + 0.02, end) + 0.06)
      osc.connect(gain).connect(ctx.destination)
      osc.start(begin)
      osc.stop(Math.max(begin + 0.02, end) + 0.08)
    }
  }
  const tick = () => {
    now.value = Math.max(0, ctx.currentTime - t0)
    if (ctx.currentTime - t0 >= span.value.to) {
      now.value = 0
      stage.value = 'ready'
      status.value = 'Теперь спой'
    } else raf = requestAnimationFrame(tick)
  }
  tick()
}

/** The microphone opens; the phrase starts half a second later, its first note a breath after. */
async function sing(): Promise<void> {
  if (stage.value === 'singing') {
    finish()
    return
  }
  status.value = 'Открываю микрофон…'
  try {
    await session.startListening()
  } catch {
    status.value = error.value ?? 'Микрофон не открылся'
    return
  }
  source.value = live
  clearTake()
  stage.value = 'singing'
  status.value = 'Пой'
  const tick = () => {
    const n = take.length()
    now.value = n ? take.timeOf(n - 1) - origin : 0
    if (now.value >= span.value.to) finish()
    else raf = requestAnimationFrame(tick)
  }
  tick()
}

/** The take as sung, copied so the card keeps it once the microphone is closed. */
function snapshot(): TakeSource {
  const rate = live.frameRate()
  const count = live.length()
  const midi = new Float32Array(count)
  const lvl = new Float32Array(count)
  live.read(0, count, midi, lvl)
  const first = live.timeOf(0)
  return {
    length: () => count,
    frameRate: () => rate,
    timeOf: (index) => first + index / rate,
    read(begin, end, m, l) {
      m.set(midi.subarray(begin, end))
      l.set(lvl.subarray(begin, end))
    },
  }
}

/** The share of each note the voice sat on, and the verdict from it. */
function finish(): void {
  cancelAnimationFrame(raf)
  const sung = snapshot()
  source.value = sung
  void session.stopListening()
  const rate = sung.frameRate()
  const first = sung.timeOf(0)
  const all = new Float32Array(sung.length())
  sung.read(0, sung.length(), all, new Float32Array(sung.length()))
  let held = 0
  let hit = 0
  const misses: { note: TakeNote; cents: number }[] = []
  for (const note of target.value) {
    const from = Math.max(0, Math.floor((note.start - first) * rate))
    const to = Math.min(all.length, Math.ceil((note.end - first) * rate))
    const values: number[] = []
    for (let i = from; i < to; i++) {
      const value = all[i] ?? NaN
      if (!Number.isFinite(value)) continue
      held++
      values.push(value)
      if (Math.abs(value - note.midi) <= 0.25) hit++
    }
    if (values.length >= 4) {
      // The median: a stray octave does not pull it.
      values.sort((a, b) => a - b)
      const cents = Math.round((values[values.length >> 1]! - note.midi) * 100)
      if (Math.abs(cents) > 25) misses.push({ note, cents })
    }
  }
  score.value = held ? Math.round((100 * hit) / held) : 0
  misses.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))
  verdict.value =
    held === 0
      ? 'не слышу голоса'
      : misses.length === 0
        ? score.value >= 85
          ? 'чисто'
          : 'почти чисто'
        : misses.length <= 2
          ? `чисто, кроме ${misses.length === 1 ? 'одной ноты' : 'двух нот'}`
          : score.value >= 50
            ? 'держишь мелодию, ноты плавают'
            : 'интонация плывёт — это тренируется'
  detail.value = misses
    .slice(0, 3)
    .map((m) =>
      Math.abs(m.cents) >= 150
        ? `${nameOf(m.note.midi)} — не та нота`
        : `${nameOf(m.note.midi)} ${m.cents < 0 ? 'ниже' : 'выше'} на ${Math.abs(m.cents)} ц`,
    )
    .join(' · ')
  now.value = Infinity
  stage.value = 'done'
  status.value = 'Готово'
}

function again(): void {
  now.value = 0
  source.value = live
  stage.value = 'ready'
  status.value = 'Услышь ещё раз или пой'
}

const mode = computed(() => (stage.value === 'done' ? 'card' : 'live'))
const button = computed(() =>
  stage.value === 'ready'
    ? 'Петь'
    : stage.value === 'singing'
      ? 'Стоп'
      : stage.value === 'done'
        ? 'Ещё раз'
        : 'Петь',
)

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  void audio?.close()
  void session.stopListening()
})

const link = document.createElement('link')
link.rel = 'stylesheet'
link.href =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Sans:wght@400;500&display=swap'
document.head.appendChild(link)
</script>

<template>
  <main id="main" class="test">
    <header class="top">
      <h1 class="title">Тушь</h1>
      <p class="status" :class="{ error: error !== null }">{{ error ?? status }}</p>
    </header>
    <div class="sheet">
      <InkScroll
        :source="source"
        :target="target"
        :now="now"
        :mode="mode"
        :span="span"
        :voice="stage !== 'hearing'"
        font='"Cormorant Garamond", Georgia, serif'
        label="Ноты плывут к линии, голос — мазок на ней"
      />
    </div>
    <div v-if="stage === 'done'" class="result">
      <p class="verdict">{{ verdict }}</p>
      <p v-if="detail" class="detail">{{ detail }}</p>
      <p class="detail">в ноте {{ score }}% времени · золотом — как надо, тушью — как у тебя</p>
      <div class="seal" aria-label="Оценка">{{ score }}</div>
    </div>
    <div class="actions">
      <button type="button" class="action ghost" :disabled="stage !== 'ready'" @click="hear">
        Услышать
      </button>
      <button
        type="button"
        class="action"
        :disabled="stage === 'loading' || stage === 'hearing' || micState === 'starting'"
        @click="stage === 'done' ? again() : sing()"
      >
        {{ button }}
      </button>
    </div>
  </main>
</template>

<style scoped>
/* Paper and ink, the screen's own look. */
.test {
  --paper: #e6e4df;
  --ink: #1c1b19;
  --muted: #6a665f;
  --seal: #a8361c;
  display: grid;
  grid-template-rows: auto auto auto auto;
  min-height: 100dvh;
  width: 100%;
  max-width: 100vw;
  overflow-x: hidden;
  padding: 0.75rem 1rem max(1rem, env(safe-area-inset-bottom));
  box-sizing: border-box;
  gap: 0.75rem;
  background: var(--paper);
  color: var(--ink);
  font-family: 'Cormorant Garamond', Georgia, serif;
}
.top {
  display: flex;
  align-items: baseline;
  gap: 1rem;
}
.title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}
.status {
  margin: 0;
  color: var(--muted);
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 0.85rem;
  flex: 1;
}
.status.error {
  color: var(--seal);
}
.sheet {
  position: relative;
  min-height: 0;
  height: min(62dvh, 600px);
  border-radius: 4px;
  overflow: hidden;
  box-shadow:
    0 1px 0 rgb(28 27 25 / 16%),
    0 10px 30px rgb(0 0 0 / 12%);
}
.result {
  position: relative;
  padding: 0.2rem 4.2rem 0.2rem 0.2rem;
  display: grid;
  gap: 0.15rem;
}
.verdict {
  margin: 0;
  font-size: 1.6rem;
  line-height: 1.1;
}
.detail {
  margin: 0;
  color: var(--muted);
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-size: 0.85rem;
}
.seal {
  position: absolute;
  right: 0.2rem;
  top: 0.1rem;
  width: 3.2rem;
  height: 3.2rem;
  display: grid;
  place-items: center;
  background: var(--seal);
  color: #f3ebdd;
  font-family: 'IBM Plex Sans', system-ui, sans-serif;
  font-weight: 600;
  font-size: 1.5rem;
  transform: rotate(-3deg);
  box-shadow:
    inset 0 0 0 3px var(--seal),
    inset 0 0 0 4px rgb(243 235 221 / 70%);
}
.actions {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 0.6rem;
}
.action {
  min-height: 3rem;
  border-radius: 6px;
  border: 1px solid var(--ink);
  background: var(--ink);
  color: #f2efe9;
  font: inherit;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
}
.action.ghost {
  background: transparent;
  color: var(--ink);
}
.action:disabled {
  opacity: 0.45;
}
</style>
