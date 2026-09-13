import type { TonalKey } from '@/training/keys'

/** A looped strings pad for every tonal centre, one mp3 each: `C.mp3`, `Cs.mp3`, … */
const TRACK_URLS = import.meta.glob<string>('../assets/audio/backing_tracks/strings/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
})

export function backingTrackUrl(key: TonalKey): string | null {
  const file = `/${key.replace('#', 's')}.mp3`
  for (const [path, url] of Object.entries(TRACK_URLS)) {
    if (path.endsWith(file)) return url
  }
  return null
}
