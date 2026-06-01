export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      announcements: {
        Row: {
          author_profile_id: string
          body: string
          club_id: string
          created_at: string
          expires_at: string | null
          id: string
          pinned: boolean
          team_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          author_profile_id: string
          body: string
          club_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          pinned?: boolean
          team_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          author_profile_id?: string
          body?: string
          club_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          pinned?: boolean
          team_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_profile_id: string
          club_id: string
          id: string
          occurred_at: string
          reason: string
          target_id: string
          target_kind: string
        }
        Insert: {
          action: string
          actor_profile_id: string
          club_id: string
          id?: string
          occurred_at?: string
          reason: string
          target_id: string
          target_kind: string
        }
        Update: {
          action?: string
          actor_profile_id?: string
          club_id?: string
          id?: string
          occurred_at?: string
          reason?: string
          target_id?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      callup_decisions: {
        Row: {
          decided_at: string
          decided_by: string
          decision: Database["public"]["Enums"]["callup_decision_kind"]
          event_id: string
          player_id: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          decided_at?: string
          decided_by: string
          decision: Database["public"]["Enums"]["callup_decision_kind"]
          event_id: string
          player_id: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          decided_at?: string
          decided_by?: string
          decision?: Database["public"]["Enums"]["callup_decision_kind"]
          event_id?: string
          player_id?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "callup_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "callup_decisions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "callup_decisions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      callup_responses: {
        Row: {
          event_id: string
          id: string
          player_id: string
          reason: string | null
          responded_at: string
          responded_by: string
          status: Database["public"]["Enums"]["callup_response_status"]
          updated_at: string
        }
        Insert: {
          event_id: string
          id?: string
          player_id: string
          reason?: string | null
          responded_at?: string
          responded_by: string
          status: Database["public"]["Enums"]["callup_response_status"]
          updated_at?: string
        }
        Update: {
          event_id?: string
          id?: string
          player_id?: string
          reason?: string | null
          responded_at?: string
          responded_by?: string
          status?: Database["public"]["Enums"]["callup_response_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "callup_responses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "callup_responses_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "callup_responses_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      capabilities: {
        Row: {
          capability_name: string
          created_at: string
          granted: boolean
          id: string
          membership_id: string
        }
        Insert: {
          capability_name: string
          created_at?: string
          granted?: boolean
          id?: string
          membership_id: string
        }
        Update: {
          capability_name?: string
          created_at?: string
          granted?: boolean
          id?: string
          membership_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capabilities_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          club_id: string
          created_at: string
          half_duration_minutes: number
          id: string
          name: string
          order_idx: number
          season: string
        }
        Insert: {
          club_id: string
          created_at?: string
          half_duration_minutes?: number
          id?: string
          name: string
          order_idx?: number
          season: string
        }
        Update: {
          club_id?: string
          created_at?: string
          half_duration_minutes?: number
          id?: string
          name?: string
          order_idx?: number
          season?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      clubs: {
        Row: {
          created_at: string
          id: string
          locale: string
          name: string
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          locale?: string
          name: string
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          locale?: string
          name?: string
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      coach_formations: {
        Row: {
          club_id: string
          created_at: string
          format: string
          id: string
          name: string
          owner_profile_id: string
          positions: Json
          updated_at: string
        }
        Insert: {
          club_id: string
          created_at?: string
          format: string
          id?: string
          name: string
          owner_profile_id: string
          positions: Json
          updated_at?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          format?: string
          id?: string
          name?: string
          owner_profile_id?: string
          positions?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_formations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_formations_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          club_id: string
          coach_profile_id: string
          created_at: string
          id: string
          last_message_at: string
          player_id: string
        }
        Insert: {
          club_id: string
          coach_profile_id: string
          created_at?: string
          id?: string
          last_message_at?: string
          player_id: string
        }
        Update: {
          club_id?: string
          coach_profile_id?: string
          created_at?: string
          id?: string
          last_message_at?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_coach_profile_id_fkey"
            columns: ["coach_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          all_day: boolean
          category_id: string | null
          club_id: string
          created_at: string
          created_by: string
          ends_at: string | null
          id: string
          location_address: string | null
          location_name: string | null
          notes: string | null
          opponent_name: string | null
          parent_event_id: string | null
          recurrence_rule: Json | null
          starts_at: string
          team_id: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          category_id?: string | null
          club_id: string
          created_at?: string
          created_by: string
          ends_at?: string | null
          id?: string
          location_address?: string | null
          location_name?: string | null
          notes?: string | null
          opponent_name?: string | null
          parent_event_id?: string | null
          recurrence_rule?: Json | null
          starts_at: string
          team_id?: string | null
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          category_id?: string | null
          club_id?: string
          created_at?: string
          created_by?: string
          ends_at?: string | null
          id?: string
          location_address?: string | null
          location_name?: string | null
          notes?: string | null
          opponent_name?: string | null
          parent_event_id?: string | null
          recurrence_rule?: Json | null
          starts_at?: string
          team_id?: string | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          club_id: string
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          player_id: string | null
          player_relation: string | null
          role: string
          team_id: string | null
          team_staff_role: string | null
          token: string
        }
        Insert: {
          accepted_at?: string | null
          club_id: string
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          player_id?: string | null
          player_relation?: string | null
          role: string
          team_id?: string | null
          team_staff_role?: string | null
          token?: string
        }
        Update: {
          accepted_at?: string | null
          club_id?: string
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          player_id?: string | null
          player_relation?: string | null
          role?: string
          team_id?: string | null
          team_staff_role?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      lineup_positions: {
        Row: {
          created_at: string
          id: string
          lineup_id: string
          location: string
          player_id: string
          position_code: string | null
          updated_at: string
          x_pct: number | null
          y_pct: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          lineup_id: string
          location?: string
          player_id: string
          position_code?: string | null
          updated_at?: string
          x_pct?: number | null
          y_pct?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          lineup_id?: string
          location?: string
          player_id?: string
          position_code?: string | null
          updated_at?: string
          x_pct?: number | null
          y_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lineup_positions_lineup_id_fkey"
            columns: ["lineup_id"]
            isOneToOne: false
            referencedRelation: "lineups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineup_positions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      lineup_tactical_notes: {
        Row: {
          lineup_id: string
          notes: string
          updated_at: string
        }
        Insert: {
          lineup_id: string
          notes: string
          updated_at?: string
        }
        Update: {
          lineup_id?: string
          notes?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lineup_tactical_notes_lineup_id_fkey"
            columns: ["lineup_id"]
            isOneToOne: true
            referencedRelation: "lineups"
            referencedColumns: ["id"]
          },
        ]
      }
      lineups: {
        Row: {
          created_at: string
          created_by: string
          event_id: string
          formation_code: string
          id: string
          is_official: boolean
          name: string
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          created_by: string
          event_id: string
          formation_code: string
          id?: string
          is_official?: boolean
          name: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          event_id?: string
          formation_code?: string
          id?: string
          is_official?: boolean
          name?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "lineups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_callup_meta: {
        Row: {
          created_at: string
          event_id: string
          meeting_address: string | null
          meeting_at: string
          meeting_location: string
          notes_general: string | null
          published_at: string | null
          published_by: string | null
          transport_mode: Database["public"]["Enums"]["transport_mode"] | null
          transport_notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          meeting_address?: string | null
          meeting_at: string
          meeting_location: string
          notes_general?: string | null
          published_at?: string | null
          published_by?: string | null
          transport_mode?: Database["public"]["Enums"]["transport_mode"] | null
          transport_notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          meeting_address?: string | null
          meeting_at?: string
          meeting_location?: string
          notes_general?: string | null
          published_at?: string | null
          published_by?: string | null
          transport_mode?: Database["public"]["Enums"]["transport_mode"] | null
          transport_notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_callup_meta_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_callup_meta_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          club_id: string
          created_at: string
          id: string
          profile_id: string
          role: string
        }
        Insert: {
          club_id: string
          created_at?: string
          id?: string
          profile_id: string
          role: string
        }
        Update: {
          club_id?: string
          created_at?: string
          id?: string
          profile_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          id: string
          read_at: string | null
          sender_profile_id: string
          sent_at: string
        }
        Insert: {
          body: string
          conversation_id: string
          id?: string
          read_at?: string | null
          sender_profile_id: string
          sent_at?: string
        }
        Update: {
          body?: string
          conversation_id?: string
          id?: string
          read_at?: string | null
          sender_profile_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_profile_id_fkey"
            columns: ["sender_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          enabled: boolean
          type: Database["public"]["Enums"]["notification_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"]
          enabled?: boolean
          type: Database["public"]["Enums"]["notification_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          enabled?: boolean
          type?: Database["public"]["Enums"]["notification_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          dedupe_key: string
          id: string
          payload: Json
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          dedupe_key: string
          id?: string
          payload?: Json
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          dedupe_key?: string
          id?: string
          payload?: Json
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      planned_substitutions: {
        Row: {
          created_at: string
          id: string
          lineup_id: string
          minute_planned: number
          player_in_id: string
          player_out_id: string
          position_code_target: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lineup_id: string
          minute_planned: number
          player_in_id: string
          player_out_id: string
          position_code_target?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lineup_id?: string
          minute_planned?: number
          player_in_id?: string
          player_out_id?: string
          position_code_target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "planned_substitutions_lineup_id_fkey"
            columns: ["lineup_id"]
            isOneToOne: false
            referencedRelation: "lineups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planned_substitutions_player_in_id_fkey"
            columns: ["player_in_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planned_substitutions_player_out_id_fkey"
            columns: ["player_out_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_accounts: {
        Row: {
          created_at: string
          id: string
          player_id: string
          profile_id: string
          relation: string
        }
        Insert: {
          created_at?: string
          id?: string
          player_id: string
          profile_id: string
          relation: string
        }
        Update: {
          created_at?: string
          id?: string
          player_id?: string
          profile_id?: string
          relation?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_accounts_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_accounts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          club_id: string
          created_at: string
          date_of_birth: string
          dorsal: number | null
          first_name: string
          foot: string | null
          height_cm: number | null
          id: string
          last_name: string | null
          medical_notes: string | null
          origin: string | null
          photo_url: string | null
          position_main: string | null
          positions_secondary: string[]
          updated_at: string
          weight_kg: number | null
        }
        Insert: {
          club_id: string
          created_at?: string
          date_of_birth: string
          dorsal?: number | null
          first_name: string
          foot?: string | null
          height_cm?: number | null
          id?: string
          last_name?: string | null
          medical_notes?: string | null
          origin?: string | null
          photo_url?: string | null
          position_main?: string | null
          positions_secondary?: string[]
          updated_at?: string
          weight_kg?: number | null
        }
        Update: {
          club_id?: string
          created_at?: string
          date_of_birth?: string
          dorsal?: number | null
          first_name?: string
          foot?: string | null
          height_cm?: number | null
          id?: string
          last_name?: string | null
          medical_notes?: string | null
          origin?: string | null
          photo_url?: string | null
          position_main?: string | null
          positions_secondary?: string[]
          updated_at?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "players_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          date_of_birth: string | null
          full_name: string | null
          id: string
          locale: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          date_of_birth?: string | null
          full_name?: string | null
          id: string
          locale?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          date_of_birth?: string | null
          full_name?: string | null
          id?: string
          locale?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          dorsal_in_team: number | null
          id: string
          joined_at: string
          left_at: string | null
          player_id: string
          position_in_team: string | null
          team_id: string
        }
        Insert: {
          created_at?: string
          dorsal_in_team?: number | null
          id?: string
          joined_at?: string
          left_at?: string | null
          player_id: string
          position_in_team?: string | null
          team_id: string
        }
        Update: {
          created_at?: string
          dorsal_in_team?: number | null
          id?: string
          joined_at?: string
          left_at?: string | null
          player_id?: string
          position_in_team?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_staff: {
        Row: {
          created_at: string
          id: string
          joined_at: string
          left_at: string | null
          membership_id: string
          staff_role: string
          team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          membership_id: string
          staff_role: string
          team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          membership_id?: string
          staff_role?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_staff_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_staff_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          category_id: string
          color: string
          created_at: string
          format: string
          id: string
          name: string
        }
        Insert: {
          category_id: string
          color?: string
          created_at?: string
          format: string
          id?: string
          name: string
        }
        Update: {
          category_id?: string
          color?: string
          created_at?: string
          format?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      training_attendance: {
        Row: {
          code: Database["public"]["Enums"]["attendance_code"]
          event_id: string
          id: string
          notes: string | null
          player_id: string
          recorded_at: string
          recorded_by: string
          updated_at: string
        }
        Insert: {
          code: Database["public"]["Enums"]["attendance_code"]
          event_id: string
          id?: string
          notes?: string | null
          player_id: string
          recorded_at?: string
          recorded_by: string
          updated_at?: string
        }
        Update: {
          code?: Database["public"]["Enums"]["attendance_code"]
          event_id?: string
          id?: string
          notes?: string | null
          player_id?: string
          recorded_at?: string
          recorded_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_attendance_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_attendance_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_attendance_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      audit_get_conversation: {
        Args: { p_conversation_id: string; p_reason: string }
        Returns: {
          body: string
          message_id: string
          read_at: string
          sender_profile_id: string
          sent_at: string
        }[]
      }
      create_club_with_admin: {
        Args: { p_locale?: string; p_name: string; p_slug: string }
        Returns: string
      }
      current_user_email: { Args: never; Returns: string }
      unaccent: { Args: { "": string }; Returns: string }
      user_active_team_for_staff: {
        Args: { p_club_id: string }
        Returns: string
      }
      user_can_create_coach_formations: {
        Args: { p_club_id: string }
        Returns: boolean
      }
      user_can_manage_callup: { Args: { p_event_id: string }; Returns: boolean }
      user_can_manage_event: {
        Args: { p_club_id: string; p_team_id: string }
        Returns: boolean
      }
      user_can_manage_lineup: { Args: { p_event_id: string }; Returns: boolean }
      user_can_manage_player: {
        Args: { p_player_id: string }
        Returns: boolean
      }
      user_can_record_attendance: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      user_can_see_player: { Args: { p_player_id: string }; Returns: boolean }
      user_can_see_player_medical: {
        Args: { p_player_id: string }
        Returns: boolean
      }
      user_can_see_shared_lineup: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      user_has_capability: {
        Args: { p_capability: string; p_membership_id: string }
        Returns: boolean
      }
      user_has_capability_in_club: {
        Args: { p_capability: string; p_club_id: string }
        Returns: boolean
      }
      user_is_conversation_participant: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      user_is_staff_of_team: { Args: { p_team_id: string }; Returns: boolean }
      user_owns_player_account: {
        Args: { p_player_id: string }
        Returns: boolean
      }
      user_role_in_club: { Args: { p_club_id: string }; Returns: string }
      user_unread_conversations_count: { Args: never; Returns: number }
      user_wants_notification: {
        Args: {
          p_channel: Database["public"]["Enums"]["notification_channel"]
          p_type: Database["public"]["Enums"]["notification_type"]
          p_user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      attendance_code:
        | "presente"
        | "ausente"
        | "ausente_con_aviso"
        | "entreno_diferenciado"
        | "lesionado"
        | "enfermo"
        | "partido_oficial"
        | "viaje"
        | "sancionado"
        | "descanso"
      callup_decision_kind: "called_up" | "discarded"
      callup_response_status: "yes" | "maybe" | "no"
      notification_channel: "in_app" | "push" | "email"
      notification_status: "pending" | "sent" | "failed" | "skipped"
      notification_type:
        | "match_callup_reminder"
        | "attendance_pending_reminder"
        | "new_message"
        | "new_announcement"
        | "callup_published"
        | "training_reminder"
        | "callup_updated"
      transport_mode: "club" | "individual" | "mixed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      attendance_code: [
        "presente",
        "ausente",
        "ausente_con_aviso",
        "entreno_diferenciado",
        "lesionado",
        "enfermo",
        "partido_oficial",
        "viaje",
        "sancionado",
        "descanso",
      ],
      callup_decision_kind: ["called_up", "discarded"],
      callup_response_status: ["yes", "maybe", "no"],
      notification_channel: ["in_app", "push", "email"],
      notification_status: ["pending", "sent", "failed", "skipped"],
      notification_type: [
        "match_callup_reminder",
        "attendance_pending_reminder",
        "new_message",
        "new_announcement",
        "callup_published",
        "training_reminder",
        "callup_updated",
      ],
      transport_mode: ["club", "individual", "mixed"],
    },
  },
} as const
