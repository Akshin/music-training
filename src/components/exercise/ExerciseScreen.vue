<script setup lang="ts">
defineProps<{
  /** Heading for assistive technology; the screen itself shows the stage. */
  title: string
}>()
</script>

<template>
  <main id="main" class="screen">
    <slot name="backdrop" />
    <div v-if="$slots.side" class="screen__side">
      <slot name="side" />
    </div>
    <div class="screen__chrome" :class="{ 'screen__chrome--side': $slots.side }">
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

/* A strip down the left edge, the whole height of the screen, under the chrome. */
.screen__side {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 1;
}

.screen__chrome--side {
  padding-left: 3.1rem;
}

.screen__title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
