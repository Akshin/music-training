import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/**
 * The project's Supabase client, or null when the build has no URL or key, so the app still runs
 * on `localStorage` alone. The publishable key is public by design; access is decided by row-level
 * security in the database, never by hiding the key.
 *
 * Sign-in with Google comes back to the page as a `?code=` that the client exchanges for a session
 * by itself; PKCE keeps the tokens out of the URL, which the implicit flow would not.
 */
export const supabase: SupabaseClient<Database> | null =
  url && key ? createClient<Database>(url, key, { auth: { flowType: 'pkce' } }) : null
