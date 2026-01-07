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
    PostgrestVersion: "13.0.5"
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
      account: {
        Row: {
          access_token: string | null
          access_token_expires_at: string | null
          account_id: string
          created_at: string
          id: string
          id_token: string | null
          password: string | null
          provider_id: string
          refresh_token: string | null
          refresh_token_expires_at: string | null
          scope: string | null
          updated_at: string
          user_id: string
          whalesync_postgres_id: string
        }
        Insert: {
          access_token?: string | null
          access_token_expires_at?: string | null
          account_id: string
          created_at?: string
          id: string
          id_token?: string | null
          password?: string | null
          provider_id: string
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          scope?: string | null
          updated_at: string
          user_id: string
          whalesync_postgres_id?: string
        }
        Update: {
          access_token?: string | null
          access_token_expires_at?: string | null
          account_id?: string
          created_at?: string
          id?: string
          id_token?: string | null
          password?: string | null
          provider_id?: string
          refresh_token?: string | null
          refresh_token_expires_at?: string | null
          scope?: string | null
          updated_at?: string
          user_id?: string
          whalesync_postgres_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_user_id_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_job_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          job_id: string
          type: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          job_id: string
          type: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          job_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_job_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "agent_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_jobs: {
        Row: {
          branch_name: string
          client_id: string
          code_branch_id: string | null
          code_pull_request_id: string | null
          completed_at: string | null
          created_at: string | null
          created_by_team_member_id: string | null
          error: string | null
          exit_code: number | null
          feature_id: string | null
          files_changed: number | null
          id: string
          job_type: string | null
          pid: number | null
          pr_number: number | null
          pr_url: string | null
          prompt: string
          repository_id: string | null
          started_at: string | null
          status: string
          title: string | null
          updated_at: string | null
          worktree_path: string | null
        }
        Insert: {
          branch_name: string
          client_id: string
          code_branch_id?: string | null
          code_pull_request_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by_team_member_id?: string | null
          error?: string | null
          exit_code?: number | null
          feature_id?: string | null
          files_changed?: number | null
          id?: string
          job_type?: string | null
          pid?: number | null
          pr_number?: number | null
          pr_url?: string | null
          prompt: string
          repository_id?: string | null
          started_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string | null
          worktree_path?: string | null
        }
        Update: {
          branch_name?: string
          client_id?: string
          code_branch_id?: string | null
          code_pull_request_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by_team_member_id?: string | null
          error?: string | null
          exit_code?: number | null
          feature_id?: string | null
          files_changed?: number | null
          id?: string
          job_type?: string | null
          pid?: number | null
          pr_number?: number | null
          pr_url?: string | null
          prompt?: string
          repository_id?: string | null
          started_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string | null
          worktree_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_code_branch_id_fkey"
            columns: ["code_branch_id"]
            isOneToOne: false
            referencedRelation: "code_branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_code_pull_request_id_fkey"
            columns: ["code_pull_request_id"]
            isOneToOne: false
            referencedRelation: "code_pull_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_created_by_team_member_id_fkey"
            columns: ["created_by_team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_jobs_repository_id_fkey"
            columns: ["repository_id"]
            isOneToOne: false
            referencedRelation: "code_repositories"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string | null
          entity_id: string
          entity_type: string
          file_name: string | null
          id: string
          metadata: Json | null
          mime_type: string | null
          storage_path: string | null
          uploaded_by_client_id: string | null
          uploaded_by_team_id: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          entity_id: string
          entity_type: string
          file_name?: string | null
          id?: string
          metadata?: Json | null
          mime_type?: string | null
          storage_path?: string | null
          uploaded_by_client_id?: string | null
          uploaded_by_team_id?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          file_name?: string | null
          id?: string
          metadata?: Json | null
          mime_type?: string | null
          storage_path?: string | null
          uploaded_by_client_id?: string | null
          uploaded_by_team_id?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_uploaded_by_client_id_fkey"
            columns: ["uploaded_by_client_id"]
            isOneToOne: false
            referencedRelation: "client_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_team_id_fkey"
            columns: ["uploaded_by_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      client_assignments: {
        Row: {
          assignment_type: string | null
          client_id: string | null
          created_at: string
          id: number
          team_member_id: string | null
        }
        Insert: {
          assignment_type?: string | null
          client_id?: string | null
          created_at?: string
          id?: number
          team_member_id?: string | null
        }
        Update: {
          assignment_type?: string | null
          client_id?: string | null
          created_at?: string
          id?: number
          team_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assignments_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      client_offers: {
        Row: {
          client_id: string | null
          created_at: string
          id: number
          offer_id: number | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: number
          offer_id?: number | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: number
          offer_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_offers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_offers_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tools: {
        Row: {
          client_id: string
          created_at: string | null
          external_id: string | null
          id: string
          metadata: Json | null
          name: string | null
          tool_type: string
          updated_at: string | null
          url: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          external_id?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          tool_type: string
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          external_id?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          tool_type?: string
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_tools_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_users: {
        Row: {
          auth_user_id: string | null
          client_id: string
          created_at: string | null
          email: string | null
          full_name: string
          id: string
          is_key_contact: boolean | null
          notes: string | null
          slack_user_id: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          auth_user_id?: string | null
          client_id: string
          created_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_key_contact?: boolean | null
          notes?: string | null
          slack_user_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          auth_user_id?: string | null
          client_id?: string
          created_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_key_contact?: boolean | null
          notes?: string | null
          slack_user_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_users_auth_user_id_fkey"
            columns: ["auth_user_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_users_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          assigned_business_analyst: string | null
          assigned_developer: string | null
          assumed_first_payment_date: string | null
          billing_workflow_stage_id: string | null
          client_source: string | null
          created_at: string | null
          id: string
          industry: string | null
          max_story_point_per_sprint: number | null
          name: string
          notes: string | null
          onboarding_workflow_stage_id: string | null
          sales_call_notes: string | null
          sales_strategy: string | null
          sprint_prefix: string | null
          subjective_happiness: number | null
          updated_at: string | null
        }
        Insert: {
          assigned_business_analyst?: string | null
          assigned_developer?: string | null
          assumed_first_payment_date?: string | null
          billing_workflow_stage_id?: string | null
          client_source?: string | null
          created_at?: string | null
          id?: string
          industry?: string | null
          max_story_point_per_sprint?: number | null
          name: string
          notes?: string | null
          onboarding_workflow_stage_id?: string | null
          sales_call_notes?: string | null
          sales_strategy?: string | null
          sprint_prefix?: string | null
          subjective_happiness?: number | null
          updated_at?: string | null
        }
        Update: {
          assigned_business_analyst?: string | null
          assigned_developer?: string | null
          assumed_first_payment_date?: string | null
          billing_workflow_stage_id?: string | null
          client_source?: string | null
          created_at?: string | null
          id?: string
          industry?: string | null
          max_story_point_per_sprint?: number | null
          name?: string
          notes?: string | null
          onboarding_workflow_stage_id?: string | null
          sales_call_notes?: string | null
          sales_strategy?: string | null
          sprint_prefix?: string | null
          subjective_happiness?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_assigned_business_analyst_fkey"
            columns: ["assigned_business_analyst"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_assigned_developer_fkey"
            columns: ["assigned_developer"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_billing_workflow_stage_id_fkey"
            columns: ["billing_workflow_stage_id"]
            isOneToOne: false
            referencedRelation: "workflow_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_onboarding_workflow_stage_id_fkey"
            columns: ["onboarding_workflow_stage_id"]
            isOneToOne: false
            referencedRelation: "workflow_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      code_branches: {
        Row: {
          created_at: string | null
          created_by_team_id: string | null
          external_id: string | null
          feature_id: string | null
          id: string
          name: string
          repository_id: string
          url: string | null
        }
        Insert: {
          created_at?: string | null
          created_by_team_id?: string | null
          external_id?: string | null
          feature_id?: string | null
          id?: string
          name: string
          repository_id: string
          url?: string | null
        }
        Update: {
          created_at?: string | null
          created_by_team_id?: string | null
          external_id?: string | null
          feature_id?: string | null
          id?: string
          name?: string
          repository_id?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "code_branches_created_by_team_id_fkey"
            columns: ["created_by_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_branches_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_branches_repository_id_fkey"
            columns: ["repository_id"]
            isOneToOne: false
            referencedRelation: "code_repositories"
            referencedColumns: ["id"]
          },
        ]
      }
      code_pull_requests: {
        Row: {
          branch_id: string | null
          closed_at: string | null
          created_at: string | null
          external_id: string | null
          feature_id: string | null
          id: string
          merged_at: string | null
          number: number | null
          opened_by_team_id: string | null
          repository_id: string
          status: string | null
          title: string | null
          updated_at: string | null
          url: string | null
        }
        Insert: {
          branch_id?: string | null
          closed_at?: string | null
          created_at?: string | null
          external_id?: string | null
          feature_id?: string | null
          id?: string
          merged_at?: string | null
          number?: number | null
          opened_by_team_id?: string | null
          repository_id: string
          status?: string | null
          title?: string | null
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          branch_id?: string | null
          closed_at?: string | null
          created_at?: string | null
          external_id?: string | null
          feature_id?: string | null
          id?: string
          merged_at?: string | null
          number?: number | null
          opened_by_team_id?: string | null
          repository_id?: string
          status?: string | null
          title?: string | null
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "code_pull_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "code_branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_pull_requests_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_pull_requests_opened_by_team_id_fkey"
            columns: ["opened_by_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_pull_requests_repository_id_fkey"
            columns: ["repository_id"]
            isOneToOne: false
            referencedRelation: "code_repositories"
            referencedColumns: ["id"]
          },
        ]
      }
      code_repositories: {
        Row: {
          client_id: string | null
          created_at: string | null
          default_branch: string | null
          external_id: string | null
          id: string
          owner_name: string
          provider: string
          repo_name: string
          updated_at: string | null
          url: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          default_branch?: string | null
          external_id?: string | null
          id?: string
          owner_name: string
          provider: string
          repo_name: string
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          default_branch?: string | null
          external_id?: string | null
          id?: string
          owner_name?: string
          provider?: string
          repo_name?: string
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "code_repositories_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_reactions: {
        Row: {
          comment_id: string
          created_at: string | null
          id: string
          reaction_type: string
          team_member_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string | null
          id?: string
          reaction_type: string
          team_member_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string | null
          id?: string
          reaction_type?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_reactions_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          body: string
          created_at: string | null
          created_by_client_id: string | null
          created_by_team_id: string | null
          id: string
          parent_comment_id: string | null
          parent_id: string
          parent_type: string
        }
        Insert: {
          body: string
          created_at?: string | null
          created_by_client_id?: string | null
          created_by_team_id?: string | null
          id?: string
          parent_comment_id?: string | null
          parent_id: string
          parent_type: string
        }
        Update: {
          body?: string
          created_at?: string | null
          created_by_client_id?: string | null
          created_by_team_id?: string | null
          id?: string
          parent_comment_id?: string | null
          parent_id?: string
          parent_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_created_by_client_id_fkey"
            columns: ["created_by_client_id"]
            isOneToOne: false
            referencedRelation: "client_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_created_by_team_id_fkey"
            columns: ["created_by_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
        ]
      }
      department_roles: {
        Row: {
          created_at: string
          department_id: string | null
          id: string
          role_name: string | null
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          id?: string
          role_name?: string | null
        }
        Update: {
          created_at?: string
          department_id?: string | null
          id?: string
          role_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "department_roles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          department_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          department_name?: string | null
          id?: string
        }
        Update: {
          created_at?: string
          department_name?: string | null
          id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          client_id: string
          content: Json | null
          created_at: string | null
          created_by_team_id: string | null
          doc_type: string | null
          feature_id: string | null
          id: string
          initiative_id: string | null
          sprint_id: string | null
          storage_path: string | null
          title: string
          updated_at: string | null
          url: string | null
        }
        Insert: {
          client_id: string
          content?: Json | null
          created_at?: string | null
          created_by_team_id?: string | null
          doc_type?: string | null
          feature_id?: string | null
          id?: string
          initiative_id?: string | null
          sprint_id?: string | null
          storage_path?: string | null
          title: string
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          client_id?: string
          content?: Json | null
          created_at?: string | null
          created_by_team_id?: string | null
          doc_type?: string | null
          feature_id?: string | null
          id?: string
          initiative_id?: string | null
          sprint_id?: string | null
          storage_path?: string | null
          title?: string
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_created_by_team_id_fkey"
            columns: ["created_by_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_initiative_id_fkey"
            columns: ["initiative_id"]
            isOneToOne: false
            referencedRelation: "initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_followers: {
        Row: {
          created_at: string | null
          entity_id: string
          entity_type: string
          id: string
          role: string | null
          team_member_id: string
        }
        Insert: {
          created_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          role?: string | null
          team_member_id: string
        }
        Update: {
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          role?: string | null
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_followers_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_labels: {
        Row: {
          created_at: string | null
          created_by_team_id: string | null
          entity_id: string
          entity_type: string
          id: string
          label_id: string
        }
        Insert: {
          created_at?: string | null
          created_by_team_id?: string | null
          entity_id: string
          entity_type: string
          id?: string
          label_id: string
        }
        Update: {
          created_at?: string | null
          created_by_team_id?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_labels_created_by_team_id_fkey"
            columns: ["created_by_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_deliverables: {
        Row: {
          created_at: string | null
          deliverable_type: string | null
          environment: string | null
          feature_id: string
          id: string
          internal_notes: string | null
          name: string
          released_at: string | null
          status: string
          updated_at: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          deliverable_type?: string | null
          environment?: string | null
          feature_id: string
          id?: string
          internal_notes?: string | null
          name: string
          released_at?: string | null
          status?: string
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          deliverable_type?: string | null
          environment?: string | null
          feature_id?: string
          id?: string
          internal_notes?: string | null
          name?: string
          released_at?: string | null
          status?: string
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_deliverables_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_types: {
        Row: {
          counts_in_load: boolean | null
          created_at: string
          label_color_code: string | null
          type_id: string
          type_name: string | null
        }
        Insert: {
          counts_in_load?: boolean | null
          created_at?: string
          label_color_code?: string | null
          type_id?: string
          type_name?: string | null
        }
        Update: {
          counts_in_load?: boolean | null
          created_at?: string
          label_color_code?: string | null
          type_id?: string
          type_name?: string | null
        }
        Relationships: []
      }
      feature_versions: {
        Row: {
          change_log: string | null
          created_at: string | null
          created_by_team_id: string | null
          feature_id: string
          id: string
          spec_doc_id: string | null
          spec_summary: string | null
          status: string
          version_number: number
        }
        Insert: {
          change_log?: string | null
          created_at?: string | null
          created_by_team_id?: string | null
          feature_id: string
          id?: string
          spec_doc_id?: string | null
          spec_summary?: string | null
          status?: string
          version_number: number
        }
        Update: {
          change_log?: string | null
          created_at?: string | null
          created_by_team_id?: string | null
          feature_id?: string
          id?: string
          spec_doc_id?: string | null
          spec_summary?: string | null
          status?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "feature_versions_created_by_team_id_fkey"
            columns: ["created_by_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_versions_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_versions_spec_doc_fk"
            columns: ["spec_doc_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      features: {
        Row: {
          actual_ship_date: string | null
          branch_name: string | null
          branch_name_hint: string | null
          client_context: string | null
          client_id: string
          created_at: string | null
          created_by_team_member_id: string | null
          estimate_points: number | null
          estimated_ship_date: string | null
          feature_type_id: string | null
          feature_workflow_stage_id: string | null
          functionality_notes: string | null
          id: string
          initiative_id: string | null
          key: string | null
          originating_request_id: string | null
          owner_team_member_id: string | null
          sort_index: number | null
          sprint_id: string | null
          title: string
          updated_at: string | null
          workflow_stage_id: string | null
        }
        Insert: {
          actual_ship_date?: string | null
          branch_name?: string | null
          branch_name_hint?: string | null
          client_context?: string | null
          client_id: string
          created_at?: string | null
          created_by_team_member_id?: string | null
          estimate_points?: number | null
          estimated_ship_date?: string | null
          feature_type_id?: string | null
          feature_workflow_stage_id?: string | null
          functionality_notes?: string | null
          id?: string
          initiative_id?: string | null
          key?: string | null
          originating_request_id?: string | null
          owner_team_member_id?: string | null
          sort_index?: number | null
          sprint_id?: string | null
          title: string
          updated_at?: string | null
          workflow_stage_id?: string | null
        }
        Update: {
          actual_ship_date?: string | null
          branch_name?: string | null
          branch_name_hint?: string | null
          client_context?: string | null
          client_id?: string
          created_at?: string | null
          created_by_team_member_id?: string | null
          estimate_points?: number | null
          estimated_ship_date?: string | null
          feature_type_id?: string | null
          feature_workflow_stage_id?: string | null
          functionality_notes?: string | null
          id?: string
          initiative_id?: string | null
          key?: string | null
          originating_request_id?: string | null
          owner_team_member_id?: string | null
          sort_index?: number | null
          sprint_id?: string | null
          title?: string
          updated_at?: string | null
          workflow_stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "features_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "features_created_by_team_member_id_fkey"
            columns: ["created_by_team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "features_feature_type_id_fkey"
            columns: ["feature_type_id"]
            isOneToOne: false
            referencedRelation: "feature_types"
            referencedColumns: ["type_id"]
          },
          {
            foreignKeyName: "features_feature_workflow_stage_id_fkey"
            columns: ["feature_workflow_stage_id"]
            isOneToOne: false
            referencedRelation: "workflow_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "features_initiative_id_fkey"
            columns: ["initiative_id"]
            isOneToOne: false
            referencedRelation: "initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "features_originating_request_id_fkey"
            columns: ["originating_request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "features_owner_team_member_id_fkey"
            columns: ["owner_team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "features_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "features_workflow_stage_id_fkey"
            columns: ["workflow_stage_id"]
            isOneToOne: false
            referencedRelation: "workflow_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_assignments: {
        Row: {
          created_at: string | null
          department_id: string | null
          department_role_id: string | null
          id: string
          inbox_id: string
          is_default: boolean | null
          priority: number
          team_member_id: string | null
        }
        Insert: {
          created_at?: string | null
          department_id?: string | null
          department_role_id?: string | null
          id?: string
          inbox_id: string
          is_default?: boolean | null
          priority?: number
          team_member_id?: string | null
        }
        Update: {
          created_at?: string | null
          department_id?: string | null
          department_role_id?: string | null
          id?: string
          inbox_id?: string
          is_default?: boolean | null
          priority?: number
          team_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbox_assignments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_assignments_department_role_id_fkey"
            columns: ["department_role_id"]
            isOneToOne: false
            referencedRelation: "department_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_assignments_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "inboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_assignments_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      inboxes: {
        Row: {
          config: Json
          created_at: string | null
          created_by_team_id: string | null
          description: string | null
          icon: string | null
          id: string
          is_system: boolean | null
          name: string
          slug: string
          updated_at: string | null
        }
        Insert: {
          config?: Json
          created_at?: string | null
          created_by_team_id?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          slug: string
          updated_at?: string | null
        }
        Update: {
          config?: Json
          created_at?: string | null
          created_by_team_id?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          slug?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inboxes_created_by_team_id_fkey"
            columns: ["created_by_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      initiatives: {
        Row: {
          client_id: string
          created_at: string | null
          description: string | null
          id: string
          initiative_workflow_stage_id: string | null
          name: string
          originating_request_id: string | null
          owner_team_member_id: string | null
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          description?: string | null
          id?: string
          initiative_workflow_stage_id?: string | null
          name: string
          originating_request_id?: string | null
          owner_team_member_id?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          description?: string | null
          id?: string
          initiative_workflow_stage_id?: string | null
          name?: string
          originating_request_id?: string | null
          owner_team_member_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "initiatives_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initiatives_initiative_workflow_stage_id_fkey"
            columns: ["initiative_workflow_stage_id"]
            isOneToOne: false
            referencedRelation: "workflow_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initiatives_originating_request_id_fkey"
            columns: ["originating_request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initiatives_owner_team_member_id_fkey"
            columns: ["owner_team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      jwks: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          private_key: string
          public_key: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id: string
          private_key: string
          public_key: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          private_key?: string
          public_key?: string
        }
        Relationships: []
      }
      labels: {
        Row: {
          code: string
          color: string | null
          created_at: string | null
          created_by_team_id: string | null
          description: string | null
          entity_type: string
          id: string
          name: string
          order_index: number | null
          updated_at: string | null
        }
        Insert: {
          code: string
          color?: string | null
          created_at?: string | null
          created_by_team_id?: string | null
          description?: string | null
          entity_type: string
          id?: string
          name: string
          order_index?: number | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          color?: string | null
          created_at?: string | null
          created_by_team_id?: string | null
          description?: string | null
          entity_type?: string
          id?: string
          name?: string
          order_index?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "labels_created_by_team_id_fkey"
            columns: ["created_by_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      logged_actions: {
        Row: {
          action: string | null
          action_tstamp_tx: string
          diff_data: Json | null
          id: number
          new_data: Json | null
          original_data: Json | null
          pk_data: Json | null
          query: string | null
          schema_name: string | null
          table_name: string | null
          user_email: string | null
          user_full_name: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action?: string | null
          action_tstamp_tx?: string
          diff_data?: Json | null
          id?: number
          new_data?: Json | null
          original_data?: Json | null
          pk_data?: Json | null
          query?: string | null
          schema_name?: string | null
          table_name?: string | null
          user_email?: string | null
          user_full_name?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string | null
          action_tstamp_tx?: string
          diff_data?: Json | null
          id?: number
          new_data?: Json | null
          original_data?: Json | null
          pk_data?: Json | null
          query?: string | null
          schema_name?: string | null
          table_name?: string | null
          user_email?: string | null
          user_full_name?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      meetings: {
        Row: {
          client_id: string | null
          created_at: string | null
          created_by_team_id: string | null
          duration: number | null
          ended_at: string | null
          external_link: string | null
          feature_id: string | null
          fireflies_meeting_id: string | null
          host_team_member_id: string | null
          id: string
          initiative_id: string | null
          matched_participants: Json | null
          meeting_type: string | null
          organizer_email: string | null
          participants: Json | null
          sprint_id: string | null
          started_at: string | null
          summary: string | null
          title: string | null
          transcript: Json | null
          transcript_url: string | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          created_by_team_id?: string | null
          duration?: number | null
          ended_at?: string | null
          external_link?: string | null
          feature_id?: string | null
          fireflies_meeting_id?: string | null
          host_team_member_id?: string | null
          id?: string
          initiative_id?: string | null
          matched_participants?: Json | null
          meeting_type?: string | null
          organizer_email?: string | null
          participants?: Json | null
          sprint_id?: string | null
          started_at?: string | null
          summary?: string | null
          title?: string | null
          transcript?: Json | null
          transcript_url?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          created_by_team_id?: string | null
          duration?: number | null
          ended_at?: string | null
          external_link?: string | null
          feature_id?: string | null
          fireflies_meeting_id?: string | null
          host_team_member_id?: string | null
          id?: string
          initiative_id?: string | null
          matched_participants?: Json | null
          meeting_type?: string | null
          organizer_email?: string | null
          participants?: Json | null
          sprint_id?: string | null
          started_at?: string | null
          summary?: string | null
          title?: string | null
          transcript?: Json | null
          transcript_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meetings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_created_by_team_id_fkey"
            columns: ["created_by_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_host_team_member_id_fkey"
            columns: ["host_team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_initiative_id_fkey"
            columns: ["initiative_id"]
            isOneToOne: false
            referencedRelation: "initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
        ]
      }
      mentions: {
        Row: {
          created_at: string
          id: number
          mentioned_by: string | null
          mentioned_user_id: string | null
          read: boolean | null
          source_entity: string | null
          source_entity_id: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          mentioned_by?: string | null
          mentioned_user_id?: string | null
          read?: boolean | null
          source_entity?: string | null
          source_entity_id?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          mentioned_by?: string | null
          mentioned_user_id?: string | null
          read?: boolean | null
          source_entity?: string | null
          source_entity_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mentions_mentioned_by_fkey"
            columns: ["mentioned_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentions_mentioned_user_id_fkey"
            columns: ["mentioned_user_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          created_at: string
          id: number
          offer_name: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          offer_name?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          offer_name?: string | null
        }
        Relationships: []
      }
      passkey: {
        Row: {
          aaguid: string | null
          backed_up: boolean
          counter: number
          created_at: string | null
          credential_id: string
          device_type: string
          id: string
          name: string | null
          public_key: string
          transports: string | null
          user_id: string
        }
        Insert: {
          aaguid?: string | null
          backed_up: boolean
          counter: number
          created_at?: string | null
          credential_id: string
          device_type: string
          id: string
          name?: string | null
          public_key: string
          transports?: string | null
          user_id: string
        }
        Update: {
          aaguid?: string | null
          backed_up?: boolean
          counter?: number
          created_at?: string | null
          credential_id?: string
          device_type?: string
          id?: string
          name?: string | null
          public_key?: string
          transports?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "passkey_user_id_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      related_features: {
        Row: {
          created_at: string
          id: number
          related_feature_id: string | null
          source_feature_id: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          related_feature_id?: string | null
          source_feature_id?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          related_feature_id?: string | null
          source_feature_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "related_features_related_feature_id_fkey"
            columns: ["related_feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "related_features_source_feature_id_fkey"
            columns: ["source_feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
        ]
      }
      request_assignments: {
        Row: {
          id: string
          is_primary: boolean | null
          request_id: string
          team_member_id: string
          track: string | null
        }
        Insert: {
          id?: string
          is_primary?: boolean | null
          request_id: string
          team_member_id: string
          track?: string | null
        }
        Update: {
          id?: string
          is_primary?: boolean | null
          request_id?: string
          team_member_id?: string
          track?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_assignments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_assignments_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      request_features: {
        Row: {
          created_at: string
          feature_id: string | null
          id: number
          request_id: string | null
        }
        Insert: {
          created_at?: string
          feature_id?: string | null
          id?: number
          request_id?: string | null
        }
        Update: {
          created_at?: string
          feature_id?: string | null
          id?: number
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_features_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_features_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          client_id: string
          created_at: string | null
          created_by_client_id: string | null
          created_by_team_id: string | null
          description: string | null
          id: string
          priority: string | null
          source: string | null
          source_metadata: Json | null
          title: string
          triage_status: string | null
          triaged_at: string | null
          triaged_by_team_id: string | null
          updated_at: string | null
          workflow_stage_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          created_by_client_id?: string | null
          created_by_team_id?: string | null
          description?: string | null
          id?: string
          priority?: string | null
          source?: string | null
          source_metadata?: Json | null
          title: string
          triage_status?: string | null
          triaged_at?: string | null
          triaged_by_team_id?: string | null
          updated_at?: string | null
          workflow_stage_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          created_by_client_id?: string | null
          created_by_team_id?: string | null
          description?: string | null
          id?: string
          priority?: string | null
          source?: string | null
          source_metadata?: Json | null
          title?: string
          triage_status?: string | null
          triaged_at?: string | null
          triaged_by_team_id?: string | null
          updated_at?: string | null
          workflow_stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_created_by_client_id_fkey"
            columns: ["created_by_client_id"]
            isOneToOne: false
            referencedRelation: "client_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_created_by_team_id_fkey"
            columns: ["created_by_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_triaged_by_team_id_fkey"
            columns: ["triaged_by_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_workflow_stage_id_fkey"
            columns: ["workflow_stage_id"]
            isOneToOne: false
            referencedRelation: "workflow_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      session: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          impersonated_by: string | null
          ip_address: string | null
          token: string
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id: string
          impersonated_by?: string | null
          ip_address?: string | null
          token: string
          updated_at: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          impersonated_by?: string | null
          ip_address?: string | null
          token?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_user_id_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_channels: {
        Row: {
          channel_id: string | null
          channel_name: string | null
          channel_type: string | null
          client_id: string | null
          created_at: string
          id: string
        }
        Insert: {
          channel_id?: string | null
          channel_name?: string | null
          channel_type?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
        }
        Update: {
          channel_id?: string | null
          channel_name?: string | null
          channel_type?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_channels_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      sprint_initiatives: {
        Row: {
          created_at: string | null
          initiative_id: string
          is_primary: boolean | null
          sprint_id: string
        }
        Insert: {
          created_at?: string | null
          initiative_id: string
          is_primary?: boolean | null
          sprint_id: string
        }
        Update: {
          created_at?: string | null
          initiative_id?: string
          is_primary?: boolean | null
          sprint_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sprint_initiatives_initiative_id_fkey"
            columns: ["initiative_id"]
            isOneToOne: false
            referencedRelation: "initiatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprint_initiatives_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
        ]
      }
      sprints: {
        Row: {
          client_id: string
          created_at: string | null
          end_date: string | null
          goal: string | null
          id: string
          max_sprint_load_override: number | null
          name: string
          overload_approved: boolean | null
          sprint_status_workflow_stage_id: string | null
          start_date: string | null
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          max_sprint_load_override?: number | null
          name: string
          overload_approved?: boolean | null
          sprint_status_workflow_stage_id?: string | null
          start_date?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          max_sprint_load_override?: number | null
          name?: string
          overload_approved?: boolean | null
          sprint_status_workflow_stage_id?: string | null
          start_date?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sprints_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sprints_sprint_status_workflow_stage_id_fkey"
            columns: ["sprint_status_workflow_stage_id"]
            isOneToOne: false
            referencedRelation: "workflow_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          auth_user_id: string | null
          created_at: string | null
          department: string | null
          full_name: string
          id: string
          is_active: boolean | null
          role_title: string | null
          updated_at: string | null
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string | null
          department?: string | null
          full_name: string
          id?: string
          is_active?: boolean | null
          role_title?: string | null
          updated_at?: string | null
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string | null
          department?: string | null
          full_name?: string
          id?: string
          is_active?: boolean | null
          role_title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_members_auth_user_id_fkey"
            columns: ["auth_user_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_department_fkey"
            columns: ["department"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_role_title_fkey"
            columns: ["role_title"]
            isOneToOne: false
            referencedRelation: "department_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      todos: {
        Row: {
          assigned_team_id: string | null
          created_at: string | null
          description: string | null
          due_date: string | null
          feature_id: string
          id: string
          order_index: number | null
          sprint_id: string | null
          status: string
          title: string
          updated_at: string | null
          workflow_stage_id: string | null
        }
        Insert: {
          assigned_team_id?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          feature_id: string
          id?: string
          order_index?: number | null
          sprint_id?: string | null
          status?: string
          title: string
          updated_at?: string | null
          workflow_stage_id?: string | null
        }
        Update: {
          assigned_team_id?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          feature_id?: string
          id?: string
          order_index?: number | null
          sprint_id?: string | null
          status?: string
          title?: string
          updated_at?: string | null
          workflow_stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "todos_assigned_team_id_fkey"
            columns: ["assigned_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "sprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todos_workflow_stage_id_fkey"
            columns: ["workflow_stage_id"]
            isOneToOne: false
            referencedRelation: "workflow_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      user: {
        Row: {
          ban_expires: string | null
          ban_reason: string | null
          banned: boolean | null
          created_at: string
          email: string
          email_verified: boolean
          id: string
          image: string | null
          name: string
          role: string | null
          updated_at: string
          whalesync_postgres_id: string
        }
        Insert: {
          ban_expires?: string | null
          ban_reason?: string | null
          banned?: boolean | null
          created_at?: string
          email: string
          email_verified?: boolean
          id: string
          image?: string | null
          name: string
          role?: string | null
          updated_at?: string
          whalesync_postgres_id?: string
        }
        Update: {
          ban_expires?: string | null
          ban_reason?: string | null
          banned?: boolean | null
          created_at?: string
          email?: string
          email_verified?: boolean
          id?: string
          image?: string | null
          name?: string
          role?: string | null
          updated_at?: string
          whalesync_postgres_id?: string
        }
        Relationships: []
      }
      verification: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          identifier: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id: string
          identifier: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          identifier?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      views: {
        Row: {
          created_at: string
          display_name: string | null
          icon: string | null
          id: number
          json_state_definition: Json | null
          page_title: string | null
          slug: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          icon?: string | null
          id?: number
          json_state_definition?: Json | null
          page_title?: string | null
          slug?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          icon?: string | null
          id?: number
          json_state_definition?: Json | null
          page_title?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      workflow_stages: {
        Row: {
          category: string | null
          code: string
          color: string | null
          created_at: string | null
          icon: string | null
          id: string
          is_terminal: boolean | null
          name: string
          order_index: number
          updated_at: string | null
          workflow_id: string
        }
        Insert: {
          category?: string | null
          code: string
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          is_terminal?: boolean | null
          name: string
          order_index: number
          updated_at?: string | null
          workflow_id: string
        }
        Update: {
          category?: string | null
          code?: string
          color?: string | null
          created_at?: string | null
          icon?: string | null
          id?: string
          is_terminal?: boolean | null
          name?: string
          order_index?: number
          updated_at?: string | null
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_stages_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          code: string
          created_at: string | null
          created_by_team_id: string | null
          description: string | null
          entity_type: string
          id: string
          is_default: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          created_by_team_id?: string | null
          description?: string | null
          entity_type: string
          id?: string
          is_default?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          created_by_team_id?: string | null
          description?: string | null
          entity_type?: string
          id?: string
          is_default?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflows_created_by_team_id_fkey"
            columns: ["created_by_team_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
