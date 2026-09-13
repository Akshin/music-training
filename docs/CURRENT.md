# Текущий статус

Идёт рефакторинг звуковой архитектуры и структуры тренировок; изменения на
2026-09-13 ещё не закоммичены (см. `git status`).

## В работе прямо сейчас

- `audio-core` переезжает из корня репозитория в `src/audio-core` (все
  файлы движка помечены как renamed).
- Легаси-звук на Tone.js выпиливается целиком:
  `src/audio/{backingTrack,melody,metronome}.ts`, компоненты
  `BackingTrackToggle`, `MelodyToggle`, `MetronomeToggle`, Pinia-стораты
  `stores/{counter,metronome}.ts`, аудиофайлы backing tracks
  (`src/assets/audio/backing_tracks/strings/*.mp3`) — всё удалено.
- `HomeView.vue` → `views/tetrachord/IssueView.vue`, `PlayView.vue` →
  `views/tetrachord/ResolveView.vue`.
- Добавлены `TrainingsView.vue` (список тренировок на `/`),
  `TetrachordTrainingView.vue` (обёртка маршрута тетрахордов),
  `src/training/tempo.ts` (чистая логика темпа без звука).
- Правки конфигов: `eslint.config.ts`, все tsconfig (root + `audio-core/*`),
  `vite.config.ts`, `package.json`/`package-lock.json` — под новое
  расположение `audio-core` и обновлённые границы линтера.

## Следующий шаг

Закоммитить перенос `audio-core` и чистку легаси-звука, затем подключить
звук тетрахордной тренировки (BPM/метроном/референс) к `audio-core` вместо
старого Tone.js-стека. Сейчас у приложения нет своего звука — это
переходное состояние.

## Примечание

До переноса (коммит `24714ca`, 2026-09-09) движок `audio-core` жил в корне
репозитория и содержал только v1-функциональность (M1–M7): mic → worklet →
worker tape/OPFS → `/lab`. За рамками v1 в бэклоге: аккорды, WASM,
mp3-в-ядре.
