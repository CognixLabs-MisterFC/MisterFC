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
          id: string
          name: string
          order_idx: number
          season: string
        }
        Insert: {
          club_id: string
          created_at?: string
          id?: string
          name: string
          order_idx?: number
          season: string
        }
        Update: {
          club_id?: string
          created_at?: string
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
          last_name: string
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
          last_name: string
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
          last_name?: string
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
      create_club_with_admin: {
        Args: { p_locale?: string; p_name: string; p_slug: string }
        Returns: string
      }
      current_user_email: { Args: never; Returns: string }
      user_active_team_for_staff: {
        Args: { p_club_id: string }
        Returns: string
      }
      user_can_manage_event: {
        Args: { p_club_id: string; p_team_id: string }
        Returns: boolean
      }
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
      user_has_capability: {
        Args: { p_capability: string; p_membership_id: string }
        Returns: boolean
      }
      user_has_capability_in_club: {
        Args: { p_capability: string; p_club_id: string }
        Returns: boolean
      }
      user_is_staff_of_team: { Args: { p_team_id: string }; Returns: boolean }
      user_role_in_club: { Args: { p_club_id: string }; Returns: string }
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
    },
  },
} as const
