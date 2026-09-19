<script setup lang="ts">
import { ref } from 'vue'
import { PhEye, PhEyeSlash } from '@phosphor-icons/vue'

defineProps<{
  /** Id of the input, for its label. */
  id: string
  /** `new-password` on a form that sets one, so a password manager offers to make it. */
  autocomplete: 'current-password' | 'new-password'
  minlength?: number
  /** Small note on the label row, e.g. the shortest length. */
  hint?: string
}>()

const password = defineModel<string>({ required: true })
const shown = ref(false)
</script>

<template>
  <div class="field">
    <div class="field__head">
      <label class="ctrl-title" :for="id">Пароль</label>
      <span v-if="hint" class="field__count">{{ hint }}</span>
    </div>
    <div class="secret">
      <input
        :id="id"
        v-model="password"
        class="field__input secret__input"
        :type="shown ? 'text' : 'password'"
        name="password"
        :autocomplete="autocomplete"
        :minlength="minlength"
        required
      />
      <button
        type="button"
        class="secret__peek"
        :aria-label="shown ? 'Скрыть пароль' : 'Показать пароль'"
        :aria-pressed="shown"
        @click="shown = !shown"
      >
        <PhEyeSlash v-if="shown" :size="18" weight="light" aria-hidden="true" />
        <PhEye v-else :size="18" weight="light" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.secret {
  position: relative;
}

.secret__input {
  padding-right: 2.9rem;
}

.secret__peek {
  position: absolute;
  top: 50%;
  right: 0.35rem;
  display: grid;
  place-items: center;
  width: 2.1rem;
  height: 2.1rem;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transform: translateY(-50%);
  transition: color 280ms var(--ease);
}

.secret__peek:hover {
  color: var(--ink);
}

.secret__peek:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
