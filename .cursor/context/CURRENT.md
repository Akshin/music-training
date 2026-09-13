# Current: tetrachord guitar training

Vue 3 + Vite play view at `/play`. Install with `--legacy-peer-deps`.

## Audio core

`audio-core/` is a separate, platform-agnostic engine (capture → analysis → scoring → synthesis)
for vocal training; the app is one consumer. Decisions, data model, algorithms and roadmap live in
`audio-core/docs/ARCHITECTURE.md` — read it before touching the core. `core/` compiles without DOM
(`audio-core/tsconfig.core.json`) and may not import `io/`, `host/`, `@/` or `vue`/`tone`.
Tests: `npm run test:core`. Docs in Russian, code in English. **Engine v1 complete (M1–M7):**
mic → worklet → worker tape/OPFS → `/lab` (pitch/level/spectrum, Mauch notes, gestures, WAV,
metronome/reference, scoring, vibrato/formants/LUFS, pYIN, CPP, Superflux, file/stream
sources). Beyond v1: chords, WASM, mp3-in-core.
Five tsconfigs in `audio-core/` (core/test/web/worker/worklet); the app consumes the engine via a
project reference to `tsconfig.web.json` (d.ts only), never by re-checking its sources.

## Product

Tetrachord training: two schemes joined by ТС make a лад. Colors: tone green, semitone yellow, ТС gray. Practice schemes: **S1** TTS, **S2** TST, **S3** STT. Combo like `S1 + S3` sits above the card.

## Play audio

- Default key **A**. Control label: **Тональный центр**. Melody and backing off.
- Melody is a fat-triangle lead with chorus + hall reverb. Graph stays alive between stop/play; mute on silence.
- Backing tracks in `src/assets/audio/backing_tracks/strings/`: naturals `A.mp3`, sharps `As.mp3` (Vite cannot import `#` in filenames). UI still shows `A#`.
- Metronome clicks can mute while beat clock still runs (schemes + melody stay in time).

## Play UI

Footer: one console (Ритм / Упражнение / Звук), then Play. Console can be stowed with the top-right X; a caret restores it.

## Mode backdrops

PNGs in `src/assets/bg/`, mapped in `src/training/modeBackgrounds.ts`. Eagerly imported; PlayView crossfades them (full width, bottom-aligned, low opacity). 0 = unnamed pair, then DIATONIC_MODES order:

0 unknown · 1 ionian · 2 dorian · 3 phrygian · 4 lydian · 5 mixolydian · 6 aeolian · 7 locrian

## Home

`HomeView` is the method page: training loop first, then what a card is (plus a **Табы** tip), three schemes (narrow cards, not full bleed), named modes (plus a quiz tip: hide names via **Отображение лада**), up/down, play controls.

## Tab helper

`TabHelper` / `PianoHelper` sit under each `ModeScheme` card. Switch via **Табы**: Нет (default, helpers hidden), Гитара, or Пианино. **Отображение лада** hides only the diatonic name; the name is overlaid so the scheme card does not shift. Right card caption is a live countdown to the next scheme change (BPM × meter × bars until change).
