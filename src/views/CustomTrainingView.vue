<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { decodeTraining } from '@/training/customTraining'
import type { TrainingDraft } from '@/training/builder'
import CustomTrainingRun from '@/views/custom-training/CustomTrainingRun.vue'

// A training from a link: `?d=` carries it whole (see training/customTraining.ts). Decoding is
// async, and the run builds its audio session once, so it mounts only when the training is known.
const route = useRoute()
const state = ref<'loading' | 'broken' | 'empty' | 'ready'>('loading')
const training = ref<TrainingDraft | null>(null)

watchEffect(async () => {
  const d = route.query.d
  state.value = 'loading'
  const decoded = typeof d === 'string' ? await decodeTraining(d) : null
  training.value = decoded
  state.value = decoded === null ? 'broken' : decoded.bars.length === 0 ? 'empty' : 'ready'
})
</script>

<template>
  <CustomTrainingRun
    v-if="state === 'ready' && training"
    :key="String($route.query.d)"
    :draft="training"
  />
  <main v-else id="main" class="custom">
    <p class="kicker">Тренировка по ссылке</p>
    <h1 class="head__title">
      {{
        state === 'loading'
          ? 'Открываю…'
          : state === 'empty'
            ? training?.title || 'Пустая тренировка'
            : 'Ссылка не открылась'
      }}
    </h1>
    <p v-if="state === 'broken'" class="lead">
      В ссылке нет тренировки или она обрезана. Попроси ссылку ещё раз или собери свою в
      <RouterLink to="/builder/edit">конструкторе</RouterLink>.
    </p>
    <p v-else-if="state === 'empty'" class="lead">В этой тренировке пока нет ни одного такта.</p>
  </main>
</template>

<style scoped>
.custom {
  max-width: 56rem;
  margin: 0 auto;
  padding: 4rem 1rem 5rem;
}

.kicker {
  margin: 0 0 0.75rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

.head__title {
  margin: 0 0 0.85rem;
  font-size: clamp(2rem, 4.6vw, 3.2rem);
  font-weight: 600;
  letter-spacing: -0.045em;
  line-height: 1.1;
  text-wrap: balance;
}

.lead {
  max-width: 50ch;
  margin: 0;
  color: var(--muted);
  font-size: 1.05rem;
  line-height: 1.55;
}
</style>
