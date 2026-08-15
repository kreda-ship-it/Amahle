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
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          changes: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          ip_address: string | null
          org_id: string
          tier: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          ip_address?: string | null
          org_id: string
          tier: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          changes?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: string | null
          org_id?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_services: {
        Row: {
          created_at: string
          deleted_at: string | null
          employee_id: string
          id: string
          org_id: string
          service_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          employee_id: string
          id?: string
          org_id: string
          service_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          employee_id?: string
          id?: string
          org_id?: string
          service_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_services_employee_same_org"
            columns: ["employee_id", "org_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "employee_services_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_services_service_same_org"
            columns: ["service_id", "org_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      employees: {
        Row: {
          bio: string | null
          created_at: string
          deleted_at: string | null
          display_order: number
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          is_bookable: boolean
          org_id: string
          phone: string | null
          photo_url: string | null
          position: string | null
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          is_bookable?: boolean
          org_id: string
          phone?: string | null
          photo_url?: string | null
          position?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          is_bookable?: boolean
          org_id?: string
          phone?: string | null
          photo_url?: string | null
          position?: string | null
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_profile_same_org"
            columns: ["profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          private_settings: Json
          public_settings: Json
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          private_settings?: Json
          public_settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          private_settings?: Json
          public_settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          key: string
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          id?: string
          key: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          key?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean
          org_id: string
          phone: string | null
          role_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          email: string
          full_name: string
          id?: string
          is_active?: boolean
          org_id: string
          phone?: string | null
          role_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          org_id?: string
          phone?: string | null
          role_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_role_id_fkey"
            columns: ["role_id", "org_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          org_id: string
          permission_id: string
          role_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          org_id: string
          permission_id: string
          role_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          org_id?: string
          permission_id?: string
          role_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id", "org_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          deleted_at: string | null
          display_name: string
          id: string
          is_system: boolean
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          display_name: string
          id?: string
          is_system?: boolean
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          display_name?: string
          id?: string
          is_system?: boolean
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          buffer_minutes: number
          category: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          display_order: number
          duration_minutes: number
          id: string
          image_url: string | null
          is_active: boolean
          is_bookable_online: boolean
          name: string
          org_id: string
          price: number
          price_display: string
          updated_at: string
        }
        Insert: {
          buffer_minutes?: number
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          duration_minutes: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_bookable_online?: boolean
          name: string
          org_id: string
          price?: number
          price_display?: string
          updated_at?: string
        }
        Update: {
          buffer_minutes?: number
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          duration_minutes?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_bookable_online?: boolean
          name?: string
          org_id?: string
          price?: number
          price_display?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_organization: {
        Args: {
          p_address?: string
          p_currency: string
          p_email?: string
          p_name: string
          p_phone?: string
          p_slug: string
          p_timezone: string
        }
        Returns: string
      }
      create_profile: {
        Args: {
          p_email: string
          p_full_name: string
          p_org_id: string
          p_phone?: string
          p_role_name: string
          p_user_id: string
        }
        Returns: string
      }
      current_org_id: { Args: never; Returns: string }
      current_profile_id: { Args: never; Returns: string }
      has_permission: { Args: { p_key: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
