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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      appointment_holds: {
        Row: {
          blocked_until: string
          created_at: string
          employee_id: string
          expires_at: string
          id: string
          org_id: string
          party_index: number
          released_at: string | null
          session_token: string
          starts_at: string
        }
        Insert: {
          blocked_until: string
          created_at?: string
          employee_id: string
          expires_at: string
          id?: string
          org_id: string
          party_index?: number
          released_at?: string | null
          session_token: string
          starts_at: string
        }
        Update: {
          blocked_until?: string
          created_at?: string
          employee_id?: string
          expires_at?: string
          id?: string
          org_id?: string
          party_index?: number
          released_at?: string | null
          session_token?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_holds_employee_same_org"
            columns: ["employee_id", "org_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "appointment_holds_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_options: {
        Row: {
          appointment_id: string
          created_at: string
          duration_delta_minutes: number
          group_name: string
          id: string
          option_id: string | null
          option_name: string
          org_id: string
          price_delta: number
        }
        Insert: {
          appointment_id: string
          created_at?: string
          duration_delta_minutes: number
          group_name: string
          id?: string
          option_id?: string | null
          option_name: string
          org_id: string
          price_delta: number
        }
        Update: {
          appointment_id?: string
          created_at?: string
          duration_delta_minutes?: number
          group_name?: string
          id?: string
          option_id?: string | null
          option_name?: string
          org_id?: string
          price_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "appointment_options_appointment_same_org"
            columns: ["appointment_id", "org_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "appointment_options_option_same_org"
            columns: ["option_id", "org_id"]
            isOneToOne: false
            referencedRelation: "service_options"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "appointment_options_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          blocked_until: string
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          employee_id: string
          employee_requested: boolean
          ends_at: string
          for_name: string | null
          id: string
          notes: string | null
          org_id: string
          phase: string
          price: number
          service_id: string
          source: string
          starts_at: string
          status: string
          updated_at: string
          visit_id: string
        }
        Insert: {
          blocked_until: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          deleted_at?: string | null
          employee_id: string
          employee_requested?: boolean
          ends_at: string
          for_name?: string | null
          id?: string
          notes?: string | null
          org_id: string
          phase?: string
          price: number
          service_id: string
          source: string
          starts_at: string
          status?: string
          updated_at?: string
          visit_id?: string
        }
        Update: {
          blocked_until?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deleted_at?: string | null
          employee_id?: string
          employee_requested?: boolean
          ends_at?: string
          for_name?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          phase?: string
          price?: number
          service_id?: string
          source?: string
          starts_at?: string
          status?: string
          updated_at?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_created_by_same_org"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "appointments_customer_same_org"
            columns: ["customer_id", "org_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "appointments_employee_same_org"
            columns: ["employee_id", "org_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "appointments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_same_org"
            columns: ["service_id", "org_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
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
      customer_care_notes: {
        Row: {
          allergies: string | null
          created_at: string
          customer_id: string
          deleted_at: string | null
          hair_formula: string | null
          id: string
          org_id: string
          sensitivities: string | null
          updated_at: string
        }
        Insert: {
          allergies?: string | null
          created_at?: string
          customer_id: string
          deleted_at?: string | null
          hair_formula?: string | null
          id?: string
          org_id: string
          sensitivities?: string | null
          updated_at?: string
        }
        Update: {
          allergies?: string | null
          created_at?: string
          customer_id?: string
          deleted_at?: string | null
          hair_formula?: string | null
          id?: string
          org_id?: string
          sensitivities?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_care_notes_customer_same_org"
            columns: ["customer_id", "org_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "customer_care_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_flags: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          flag_type: string
          id: string
          min_permission: string
          note: string | null
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          deleted_at?: string | null
          flag_type: string
          id?: string
          min_permission?: string
          note?: string | null
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deleted_at?: string | null
          flag_type?: string
          id?: string
          min_permission?: string
          note?: string | null
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_flags_created_by_same_org"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "customer_flags_customer_same_org"
            columns: ["customer_id", "org_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "customer_flags_min_permission_fkey"
            columns: ["min_permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "customer_flags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          birthday: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          first_visit_at: string | null
          full_name: string
          id: string
          last_visit_at: string | null
          notes: string | null
          org_id: string
          phone: string
          phone_digits: string | null
          preferred_employee_id: string | null
          updated_at: string
        }
        Insert: {
          birthday?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_visit_at?: string | null
          full_name: string
          id?: string
          last_visit_at?: string | null
          notes?: string | null
          org_id: string
          phone: string
          phone_digits?: string | null
          preferred_employee_id?: string | null
          updated_at?: string
        }
        Update: {
          birthday?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_visit_at?: string | null
          full_name?: string
          id?: string
          last_visit_at?: string | null
          notes?: string | null
          org_id?: string
          phone?: string
          phone_digits?: string | null
          preferred_employee_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_preferred_employee_same_org"
            columns: ["preferred_employee_id", "org_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "org_id"]
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
          role: string
          service_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          employee_id: string
          id?: string
          org_id: string
          role?: string
          service_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          employee_id?: string
          id?: string
          org_id?: string
          role?: string
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
      employee_time_off: {
        Row: {
          created_at: string
          deleted_at: string | null
          employee_id: string
          ends_at: string
          id: string
          org_id: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          employee_id: string
          ends_at: string
          id?: string
          org_id: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          employee_id?: string
          ends_at?: string
          id?: string
          org_id?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_time_off_employee_same_org"
            columns: ["employee_id", "org_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "employee_time_off_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_working_hours: {
        Row: {
          created_at: string
          day_of_week: number
          deleted_at: string | null
          employee_id: string
          end_time: string
          id: string
          org_id: string
          start_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          deleted_at?: string | null
          employee_id: string
          end_time: string
          id?: string
          org_id: string
          start_time: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          deleted_at?: string | null
          employee_id?: string
          end_time?: string
          id?: string
          org_id?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_working_hours_employee_same_org"
            columns: ["employee_id", "org_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "employee_working_hours_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
          photo_path: string | null
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
          photo_path?: string | null
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
          photo_path?: string | null
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
      gallery_images: {
        Row: {
          alt_text: string
          caption: string | null
          created_at: string
          deleted_at: string | null
          display_order: number
          id: string
          is_active: boolean
          org_id: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          alt_text: string
          caption?: string | null
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          org_id: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          alt_text?: string
          caption?: string | null
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          org_id?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gallery_images_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
          max_overhang_minutes: number
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
          max_overhang_minutes?: number
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
          max_overhang_minutes?: number
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
      service_categories: {
        Row: {
          created_at: string
          deleted_at: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          org_id: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_categories_parent_same_org"
            columns: ["parent_id", "org_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      service_option_group_links: {
        Row: {
          created_at: string
          deleted_at: string | null
          depends_on_option_id: string | null
          display_order: number
          group_id: string
          id: string
          org_id: string
          service_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          depends_on_option_id?: string | null
          display_order?: number
          group_id: string
          id?: string
          org_id: string
          service_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          depends_on_option_id?: string | null
          display_order?: number
          group_id?: string
          id?: string
          org_id?: string
          service_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_option_group_links_depends_same_org"
            columns: ["depends_on_option_id", "org_id"]
            isOneToOne: false
            referencedRelation: "service_options"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "service_option_group_links_group_same_org"
            columns: ["group_id", "org_id"]
            isOneToOne: false
            referencedRelation: "service_option_groups"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "service_option_group_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_option_group_links_service_same_org"
            columns: ["service_id", "org_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      service_option_groups: {
        Row: {
          created_at: string
          deleted_at: string | null
          display_order: number
          id: string
          is_active: boolean
          is_required: boolean
          name: string
          org_id: string
          prompt: string
          selection: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_required?: boolean
          name: string
          org_id: string
          prompt: string
          selection?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_required?: boolean
          name?: string
          org_id?: string
          prompt?: string
          selection?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_option_groups_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_options: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          display_order: number
          duration_delta_minutes: number
          group_id: string
          id: string
          is_active: boolean
          lead_delta_minutes: number
          name: string
          org_id: string
          price_delta: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          duration_delta_minutes?: number
          group_id: string
          id?: string
          is_active?: boolean
          lead_delta_minutes?: number
          name: string
          org_id: string
          price_delta?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          duration_delta_minutes?: number
          group_id?: string
          id?: string
          is_active?: boolean
          lead_delta_minutes?: number
          name?: string
          org_id?: string
          price_delta?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_options_group_same_org"
            columns: ["group_id", "org_id"]
            isOneToOne: false
            referencedRelation: "service_option_groups"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "service_options_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          buffer_minutes: number | null
          category: string | null
          category_id: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          display_order: number
          duration_minutes: number
          id: string
          image_path: string | null
          is_active: boolean
          is_bookable_online: boolean
          is_included_with_others: boolean
          latest_start_time: string | null
          lead_minutes: number | null
          name: string
          org_id: string
          price: number
          price_display: string
          updated_at: string
        }
        Insert: {
          buffer_minutes?: number | null
          category?: string | null
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          duration_minutes: number
          id?: string
          image_path?: string | null
          is_active?: boolean
          is_bookable_online?: boolean
          is_included_with_others?: boolean
          latest_start_time?: string | null
          lead_minutes?: number | null
          name: string
          org_id: string
          price?: number
          price_display?: string
          updated_at?: string
        }
        Update: {
          buffer_minutes?: number | null
          category?: string | null
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          duration_minutes?: number
          id?: string
          image_path?: string | null
          is_active?: boolean
          is_bookable_online?: boolean
          is_included_with_others?: boolean
          latest_start_time?: string | null
          lead_minutes?: number | null
          name?: string
          org_id?: string
          price?: number
          price_display?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_category_same_org"
            columns: ["category_id", "org_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id", "org_id"]
          },
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
      buffer_minutes_for: { Args: { p_service_id: string }; Returns: number }
      create_appointment: {
        Args: {
          p_customer_email?: string
          p_customer_name: string
          p_customer_phone: string
          p_employee_ids: string[]
          p_employee_requested?: boolean
          p_for_name?: string
          p_notes?: string
          p_org_id: string
          p_party_index?: number
          p_selection?: Json
          p_service_ids: string[]
          p_session_token?: string
          p_starts_at: string
          p_visit_id?: string
        }
        Returns: string
      }
      create_organization: {
        Args: {
          p_address?: string
          p_currency?: string
          p_email?: string
          p_name: string
          p_phone?: string
          p_slug: string
          p_timezone?: string
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
      current_employee_id: { Args: never; Returns: string }
      current_org_id: { Args: never; Returns: string }
      current_profile_id: { Args: never; Returns: string }
      employee_is_free: {
        Args: {
          p_allow_overhang?: boolean
          p_employee_id: string
          p_latest_start?: string
          p_minutes: number
          p_org_id: string
          p_party_index?: number
          p_session_token?: string
          p_starts_at: string
        }
        Returns: boolean
      }
      find_or_create_customer: {
        Args: {
          p_email?: string
          p_full_name: string
          p_org_id: string
          p_phone: string
        }
        Returns: string
      }
      get_available_slots: {
        Args: {
          p_employee_id?: string
          p_from_date: string
          p_org_id: string
          p_party_index?: number
          p_service_ids: string[]
          p_session_token?: string
          p_to_date?: string
        }
        Returns: {
          slot_employee_id: string
          slot_starts_at: string
        }[]
      }
      get_booking_confirmation: {
        Args: { p_visit_id: string }
        Returns: {
          employee_name: string
          ends_at: string
          for_name: string
          price: number
          service_name: string
          starts_at: string
          status: string
        }[]
      }
      get_holds: {
        Args: { p_session_token: string }
        Returns: {
          blocked_until: string
          employee_id: string
          expires_at: string
          party_index: number
          starts_at: string
        }[]
      }
      get_visit_slots: {
        Args: {
          p_employee_id?: string
          p_from_date: string
          p_limit?: number
          p_org_id: string
          p_party_index?: number
          p_selection?: Json
          p_service_ids: string[]
          p_session_token?: string
          p_to_date?: string
        }
        Returns: {
          slot_assignment: Json
          slot_employee_id: string
          slot_starts_at: string
        }[]
      }
      has_permission: { Args: { p_key: string }; Returns: boolean }
      hold_slot: {
        Args: {
          p_employee_id: string
          p_org_id: string
          p_party_index?: number
          p_service_ids: string[]
          p_session_token: string
          p_starts_at: string
        }
        Returns: string
      }
      normalize_phone: {
        Args: { p_dial_code?: string; p_phone: string }
        Returns: string
      }
      release_holds: {
        Args: { p_party_index?: number; p_session_token?: string }
        Returns: undefined
      }
      round_up_to_minutes: {
        Args: { p_minutes: number; p_ts: string }
        Returns: string
      }
      schedule_permits: {
        Args: {
          p_allow_overhang?: boolean
          p_employee_id: string
          p_latest_start?: string
          p_minutes: number
          p_org_id: string
          p_starts_at: string
        }
        Returns: boolean
      }
      visit_lines: {
        Args: { p_org_id: string; p_selection: Json }
        Returns: {
          duration_minutes: number
          lead_minutes: number
          ord: number
          price: number
          service_id: string
          was_included: boolean
        }[]
      }
      visit_minutes: {
        Args: { p_org_id: string; p_selection?: Json; p_service_ids: string[] }
        Returns: number
      }
      visit_plan: {
        Args: { p_org_id: string; p_selection?: Json; p_service_ids: string[] }
        Returns: {
          minutes: number
          ord: number
          qualified: number
          service_id: string
        }[]
      }
      visit_totals: {
        Args: { p_org_id: string; p_selection: Json }
        Returns: {
          total_minutes: number
          total_price: number
        }[]
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
