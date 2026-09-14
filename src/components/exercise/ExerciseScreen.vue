<script setup lang="ts">
defineProps<{
  /** Heading for assistive technology; the screen itself shows the stage. */
  title: string
}>()
</script>

<template>
  <main id="main" class="screen">
    <slot name="backdrop" />
    <div class="screen__chrome">
      <h1 class="screen__title">{{ title }}</h1>
      <slot />
      <slot name="dock" />
    </div>
  </main>
</template>

<style scoped>
.screen {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - 4.5rem);
}

.screen__chrome {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.screen__title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
