<script setup lang="ts">
import { DESCRIPTION_MAX, TITLE_MAX } from '@/training/builder'

const title = defineModel<string>('title', { required: true })
const description = defineModel<string>('description', { required: true })
</script>

<template>
  <section class="panel" aria-labelledby="about-title">
    <h2 id="about-title" class="panel__title">О тренировке</h2>
    <label class="field">
      <span class="field__head">
        <span class="ctrl-title">Название</span>
      </span>
      <input
        v-model="title"
        class="field__input"
        type="text"
        placeholder="Например, «Гамма со слайдом»"
        :maxlength="TITLE_MAX"
      />
    </label>
    <label class="field">
      <span class="field__head">
        <span class="ctrl-title">Описание</span>
        <span class="field__count">{{ description.length }} / {{ DESCRIPTION_MAX }}</span>
      </span>
      <textarea
        v-model="description"
        class="field__input field__input--area"
        rows="4"
        placeholder="Что делать и на что обратить внимание. Покажется тому, кто откроет тренировку по ссылке."
        :maxlength="DESCRIPTION_MAX"
      />
    </label>
  </section>
</template>
