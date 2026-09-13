# music-training

Vue 3 + Vite тренажёр для музыкантов. Каждая тренировка — маршрут с двумя
экранами: `/issue` (описание) и `/resolve` (прогон). Первая тренировка —
тетрахорды (`/tetrachord-training`). Отдельный стенд `/lab` — живой анализ
звука.

## Стек

Vue 3.5, Vue Router 5, Vite 8, TypeScript ~6.0, ESLint + oxlint + Prettier,
Vitest (тесты движка).

## Архитектура верхнего уровня

- `src/router` — маршруты тренировок; пары issue/resolve объявлены в
  `meta.nav`, их рендерит `SiteNav`
- `src/views`, `src/views/tetrachord` — экраны
- `src/components` — UI-контролы и визуализации схем
- `src/training` — чистая логика тренировок без звука (напр. `tempo.ts`)
- `src/audio-core` — платформонезависимый звуковой движок
  (capture → analysis → scoring → synthesis), подключается как
  `@audio-core/*`; собственные архитектурные правила —
  `src/audio-core/docs/ARCHITECTURE.md`
- `src/lab` — стенд для движка

Подробности: [docs/architecture.md](docs/architecture.md).
Текущий статус: [docs/CURRENT.md](docs/CURRENT.md).
Решения: [docs/DECISIONS.md](docs/DECISIONS.md).

## Запуск

```sh
npm install --legacy-peer-deps
npm run dev
```

Сборка: `npm run build`. Линт: `npm run lint`. Тесты движка: `npm run test:core`.
