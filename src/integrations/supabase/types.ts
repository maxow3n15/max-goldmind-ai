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
      ai_analyses: {
        Row: {
          bias: string | null
          confidence: number | null
          created_at: string
          explanation: string
          id: string
          setup: Json
          symbol: string
          timeframe: string
          user_id: string
        }
        Insert: {
          bias?: string | null
          confidence?: number | null
          created_at?: string
          explanation: string
          id?: string
          setup: Json
          symbol?: string
          timeframe: string
          user_id: string
        }
        Update: {
          bias?: string | null
          confidence?: number | null
          created_at?: string
          explanation?: string
          id?: string
          setup?: Json
          symbol?: string
          timeframe?: string
          user_id?: string
        }
        Relationships: []
      }
      broker_connections: {
        Row: {
          account_name: string | null
          account_number: string | null
          account_type: string
          balance: number | null
          broker_id: string
          created_at: string
          credentials_ciphertext: string
          currency: string
          equity: number | null
          free_margin: number | null
          id: string
          is_default: boolean
          label: string | null
          last_error: string | null
          last_sync_at: string | null
          margin_level: number | null
          open_positions: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          account_type?: string
          balance?: number | null
          broker_id: string
          created_at?: string
          credentials_ciphertext: string
          currency?: string
          equity?: number | null
          free_margin?: number | null
          id?: string
          is_default?: boolean
          label?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          margin_level?: number | null
          open_positions?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          account_type?: string
          balance?: number | null
          broker_id?: string
          created_at?: string
          credentials_ciphertext?: string
          currency?: string
          equity?: number | null
          free_margin?: number | null
          id?: string
          is_default?: boolean
          label?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          margin_level?: number | null
          open_positions?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      decision_logs: {
        Row: {
          blockers: Json
          confidence: number | null
          created_at: string
          cycle_id: string
          decided_at: string
          direction: string | null
          id: string
          latency: Json
          news_score: number | null
          outcome: string
          payload: Json
          price: number | null
          reasoning: Json
          spread: number | null
          symbol: string
          technical_score: number | null
          timeframe: string
          user_id: string
        }
        Insert: {
          blockers?: Json
          confidence?: number | null
          created_at?: string
          cycle_id: string
          decided_at?: string
          direction?: string | null
          id?: string
          latency?: Json
          news_score?: number | null
          outcome: string
          payload?: Json
          price?: number | null
          reasoning?: Json
          spread?: number | null
          symbol?: string
          technical_score?: number | null
          timeframe: string
          user_id: string
        }
        Update: {
          blockers?: Json
          confidence?: number | null
          created_at?: string
          cycle_id?: string
          decided_at?: string
          direction?: string | null
          id?: string
          latency?: Json
          news_score?: number | null
          outcome?: string
          payload?: Json
          price?: number | null
          reasoning?: Json
          spread?: number | null
          symbol?: string
          technical_score?: number | null
          timeframe?: string
          user_id?: string
        }
        Relationships: []
      }
      paper_account: {
        Row: {
          balance: number
          equity: number
          free_margin: number
          margin_used: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          equity?: number
          free_margin?: number
          margin_used?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          equity?: number
          free_margin?: number
          margin_used?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      trades: {
        Row: {
          ai_analysis: Json | null
          closed_at: string | null
          confidence: number | null
          direction: string
          entry_price: number
          exit_price: number | null
          id: string
          lot_size: number
          mode: string
          opened_at: string
          pnl: number | null
          reason_entry: string | null
          reason_exit: string | null
          risk_reward: number | null
          session: string | null
          status: string
          stop_loss: number
          symbol: string
          take_profit_1: number | null
          take_profit_2: number | null
          take_profit_3: number | null
          timeframe: string | null
          user_id: string
        }
        Insert: {
          ai_analysis?: Json | null
          closed_at?: string | null
          confidence?: number | null
          direction: string
          entry_price: number
          exit_price?: number | null
          id?: string
          lot_size?: number
          mode?: string
          opened_at?: string
          pnl?: number | null
          reason_entry?: string | null
          reason_exit?: string | null
          risk_reward?: number | null
          session?: string | null
          status?: string
          stop_loss: number
          symbol?: string
          take_profit_1?: number | null
          take_profit_2?: number | null
          take_profit_3?: number | null
          timeframe?: string | null
          user_id: string
        }
        Update: {
          ai_analysis?: Json | null
          closed_at?: string | null
          confidence?: number | null
          direction?: string
          entry_price?: number
          exit_price?: number | null
          id?: string
          lot_size?: number
          mode?: string
          opened_at?: string
          pnl?: number | null
          reason_entry?: string | null
          reason_exit?: string | null
          risk_reward?: number | null
          session?: string | null
          status?: string
          stop_loss?: number
          symbol?: string
          take_profit_1?: number | null
          take_profit_2?: number | null
          take_profit_3?: number | null
          timeframe?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          auto_execute: boolean
          avoid_news: boolean
          created_at: string
          live_trading_enabled: boolean
          max_daily_loss: number
          max_open_trades: number
          max_trades_per_day: number
          max_weekly_loss: number
          notify_browser: boolean
          notify_email: boolean
          preferred_session: string
          preferred_timeframe: string
          risk_per_trade: number
          trading_mode: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_execute?: boolean
          avoid_news?: boolean
          created_at?: string
          live_trading_enabled?: boolean
          max_daily_loss?: number
          max_open_trades?: number
          max_trades_per_day?: number
          max_weekly_loss?: number
          notify_browser?: boolean
          notify_email?: boolean
          preferred_session?: string
          preferred_timeframe?: string
          risk_per_trade?: number
          trading_mode?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_execute?: boolean
          avoid_news?: boolean
          created_at?: string
          live_trading_enabled?: boolean
          max_daily_loss?: number
          max_open_trades?: number
          max_trades_per_day?: number
          max_weekly_loss?: number
          notify_browser?: boolean
          notify_email?: boolean
          preferred_session?: string
          preferred_timeframe?: string
          risk_per_trade?: number
          trading_mode?: string
          updated_at?: string
          user_id?: string
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
