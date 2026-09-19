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
  <main v-else id="main" class="page">
    <section class="page-head">
      <p class="kicker">Тренировка по ссылке</p>
      <h1 class="page-title">
        {{
          state === 'loading'
            ? 'Открываю…'
            : state === 'empty'
              ? training?.title || 'Пустая тренировка'
              : 'Ссылка не открылась'
        }}
      </h1>
      <p v-if="state === 'broken'" class="page-lead">
        В ссылке нет тренировки или она обрезана. Попроси ссылку ещё раз или собери свою в
        <RouterLink to="/builder/edit">конструкторе</RouterLink>.
      </p>
      <p v-else-if="state === 'empty'" class="page-lead">
        В этой тренировке пока нет ни одного такта.
      </p>
    </section>
  </main>
</template>
