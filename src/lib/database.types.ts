// Generated from the project's schema (Supabase MCP `generate_typescript_types`); regenerate after a
// migration in supabase/migrations instead of editing by hand.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          avatar_path: string | null
          bio: string
          created_at: string
          id: string
          role: Database['public']['Enums']['user_role']
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          bio?: string
          created_at?: string
          id: string
          role?: Database['public']['Enums']['user_role']
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          bio?: string
          created_at?: string
          id?: string
          role?: Database['public']['Enums']['user_role']
          updated_at?: string
        }
        Relationships: []
      }
      trainings: {
        Row: {
          draft: Json
          id: string
          saved_at: string
          user_id: string
          version: number
        }
        Insert: {
          draft: Json
          id?: string
          saved_at?: string
          user_id?: string
          version?: number
        }
        Update: {
          draft?: Json
          id?: string
          saved_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      user_role: 'student' | 'teacher'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
