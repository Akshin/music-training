import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginOxlint from 'eslint-plugin-oxlint'
import skipFormatting from 'eslint-config-prettier/flat'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  ...pluginOxlint.buildFromOxlintConfigFile('.oxlintrc.json'),

  {
    // The audio core is platform-agnostic: it must not know about adapters, the app or the UI stack.
    // The compiler enforces "no DOM" (audio-core/tsconfig.core.json); this enforces "no imports".
    name: 'audio-core/boundaries',
    files: ['audio-core/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/io/**', '**/host/**'],
              message: 'audio-core/core must not depend on io/ or host/ adapters.',
            },
            {
              group: ['@/**'],
              message: 'audio-core/core must not depend on the application.',
            },
          ],
          paths: ['vue', 'pinia', 'vue-router', 'tone'],
        },
      ],
    },
  },

  skipFormatting,
)
