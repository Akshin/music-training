<template>
  <!-- Keyed by the full path, so switching from one saved training to another starts afresh. -->
  <RouterView :key="$route.fullPath" />
</template>
