import { computed, ref, type Ref } from 'vue'
import { useExerciseSession } from '@/composables/useExerciseSession'
import { backingTrackUrl } from '@/training/backing'
import type { ExerciseDefinition } from '@/training/exercises'
import { TONAL_KEY_DEFAULT, keyPitchClass, keyTonicMidi, type TonalKey } from '@/training/keys'
import { BEATS_DEFAULT, BPM_DEFAULT } from '@/training/tempo'

/** Settings every exercise shares; `ExerciseConsole` edits them. */
export interface ExerciseSettings {
  readonly bpm: Ref<number>
  readonly beats: Ref<number>
  readonly metronome: Ref<boolean>
  readonly key: Ref<TonalKey>
  readonly backing: Ref<boolean>
}

/**
 * The frame of a training screen: the shared settings, one audio session built from them and what
 * follows from the tonal centre. An exercise adds only its stage and its own logic on top.
 */
export function useExercise(definition: ExerciseDefinition) {
  const defaults = definition.defaults ?? {}
  const settings: ExerciseSettings = {
    bpm: ref(defaults.bpm ?? BPM_DEFAULT),
    beats: ref(defaults.beats ?? BEATS_DEFAULT),
    metronome: ref(defaults.metronome ?? true),
    key: ref<TonalKey>(defaults.key ?? TONAL_KEY_DEFAULT),
    backing: ref(defaults.backing ?? false),
  }
  const backingUrl = computed(() =>
    settings.backing.value ? backingTrackUrl(settings.key.value) : null,
  )
  const session = useExerciseSession({
    bpm: settings.bpm,
    beats: settings.beats,
    clicks: settings.metronome,
    backing: backingUrl,
    listen: definition.listen === true,
  })

  return {
    definition,
    settings,
    session,
    /** Pitch class of the tonal centre, C = 0. */
    tonic: computed(() => keyPitchClass(settings.key.value)),
    /** MIDI tonic of the tonal centre, C4–B4. */
    tonicMidi: computed(() => keyTonicMidi(settings.key.value)),
  }
}

export type Exercise = ReturnType<typeof useExercise>
