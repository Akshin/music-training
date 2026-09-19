/**
 * What a profile holds: the kind of user, a photo and a few words about oneself. The kind is picked
 * at sign-up and can be changed in the profile; nothing depends on it yet beyond showing it.
 */

/** Someone who learns, or someone who teaches. The values are the `user_role` enum in the database. */
export type UserRole = 'student' | 'teacher'

export interface RoleOption {
  readonly value: UserRole
  readonly label: string
  readonly hint: string
}

export const ROLE_OPTIONS: readonly RoleOption[] = [
  { value: 'student', label: 'Ученик', hint: 'Занимаюсь сам или с учителем' },
  { value: 'teacher', label: 'Учитель', hint: 'Веду учеников' },
]

export const ROLE_DEFAULT: UserRole = 'student'

/** Longest description; the `profiles` table checks the same number. */
export const BIO_MAX = 500

/** Photo formats the bucket takes, and the largest file worth decoding, bytes. */
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const AVATAR_SOURCE_MAX = 12 * 1024 * 1024
