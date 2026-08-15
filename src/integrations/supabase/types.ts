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
      ai_health_events: {
        Row: {
          attempts: number
          created_at: string
          empty_responses: number
          error: string | null
          http_status: number | null
          id: string
          latency_ms: number | null
          model: string | null
          parse_errors: number
          rate_limits: number
          rejection_reasons: Json
          source: string
          status: string
          timeouts: number
          upstream_errors: number
          user_id: string
          validation_rejects: number
        }
        Insert: {
          attempts?: number
          created_at?: string
          empty_responses?: number
          error?: string | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          parse_errors?: number
          rate_limits?: number
          rejection_reasons?: Json
          source?: string
          status: string
          timeouts?: number
          upstream_errors?: number
          user_id: string
          validation_rejects?: number
        }
        Update: {
          attempts?: number
          created_at?: string
          empty_responses?: number
          error?: string | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          parse_errors?: number
          rate_limits?: number
          rejection_reasons?: Json
          source?: string
          status?: string
          timeouts?: number
          upstream_errors?: number
          user_id?: string
          validation_rejects?: number
        }
        Relationships: []
      }
      backtest_runs: {
        Row: {
          bars: number
          config: Json
          created_at: string
          ended_at: string | null
          equity_curve: Json
          id: string
          label: string
          metrics: Json
          started_at: string | null
          symbol: string
          timeframe: string
          trades: Json
          user_id: string
        }
        Insert: {
          bars?: number
          config?: Json
          created_at?: string
          ended_at?: string | null
          equity_curve?: Json
          id?: string
          label?: string
          metrics?: Json
          started_at?: string | null
          symbol?: string
          timeframe: string
          trades?: Json
          user_id: string
        }
        Update: {
          bars?: number
          config?: Json
          created_at?: string
          ended_at?: string | null
          equity_curve?: Json
          id?: string
          label?: string
          metrics?: Json
          started_at?: string | null
          symbol?: string
          timeframe?: string
          trades?: Json
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
      challenge_daily_stats: {
        Row: {
          created_at: string
          day: string
          end_equity: number
          id: string
          low_equity: number
          peak_equity: number
          pnl: number
          profile_id: string
          start_equity: number
          trades: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day: string
          end_equity?: number
          id?: string
          low_equity?: number
          peak_equity?: number
          pnl?: number
          profile_id: string
          start_equity?: number
          trades?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          day?: string
          end_equity?: number
          id?: string
          low_equity?: number
          peak_equity?: number
          pnl?: number
          profile_id?: string
          start_equity?: number
          trades?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_daily_stats_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "challenge_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_profiles: {
        Row: {
          account_size: number
          auto_enforce: boolean
          broker_connection_id: string | null
          consistency_rule_pct: number | null
          created_at: string
          currency: string
          daily_loss_basis: string
          daily_loss_limit_pct: number
          daily_reset_utc_hour: number
          drawdown_basis: string
          drawdown_type: string
          id: string
          label: string
          max_drawdown_pct: number
          max_lot_size: number | null
          max_trading_days: number | null
          min_trading_days: number
          news_restriction_minutes: number
          notes: string | null
          overnight_holding_allowed: boolean
          phase: string
          preset_key: string
          profit_target_pct: number
          provider: string
          restrictions: Json
          safety_buffer_pct: number
          start_at: string
          start_balance: number
          status: string
          updated_at: string
          user_id: string
          weekend_holding_allowed: boolean
        }
        Insert: {
          account_size?: number
          auto_enforce?: boolean
          broker_connection_id?: string | null
          consistency_rule_pct?: number | null
          created_at?: string
          currency?: string
          daily_loss_basis?: string
          daily_loss_limit_pct?: number
          daily_reset_utc_hour?: number
          drawdown_basis?: string
          drawdown_type?: string
          id?: string
          label?: string
          max_drawdown_pct?: number
          max_lot_size?: number | null
          max_trading_days?: number | null
          min_trading_days?: number
          news_restriction_minutes?: number
          notes?: string | null
          overnight_holding_allowed?: boolean
          phase?: string
          preset_key?: string
          profit_target_pct?: number
          provider?: string
          restrictions?: Json
          safety_buffer_pct?: number
          start_at?: string
          start_balance?: number
          status?: string
          updated_at?: string
          user_id: string
          weekend_holding_allowed?: boolean
        }
        Update: {
          account_size?: number
          auto_enforce?: boolean
          broker_connection_id?: string | null
          consistency_rule_pct?: number | null
          created_at?: string
          currency?: string
          daily_loss_basis?: string
          daily_loss_limit_pct?: number
          daily_reset_utc_hour?: number
          drawdown_basis?: string
          drawdown_type?: string
          id?: string
          label?: string
          max_drawdown_pct?: number
          max_lot_size?: number | null
          max_trading_days?: number | null
          min_trading_days?: number
          news_restriction_minutes?: number
          notes?: string | null
          overnight_holding_allowed?: boolean
          phase?: string
          preset_key?: string
          profit_target_pct?: number
          provider?: string
          restrictions?: Json
          safety_buffer_pct?: number
          start_at?: string
          start_balance?: number
          status?: string
          updated_at?: string
          user_id?: string
          weekend_holding_allowed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "challenge_profiles_broker_connection_id_fkey"
            columns: ["broker_connection_id"]
            isOneToOne: false
            referencedRelation: "broker_connections"
            referencedColumns: ["id"]
          },
        ]
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
          environment: string | null
          environment_confidence: number | null
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
          environment?: string | null
          environment_confidence?: number | null
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
          environment?: string | null
          environment_confidence?: number | null
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
      engine_heartbeats: {
        Row: {
          created_at: string
          detail: Json
          engine: string
          id: string
          last_beat_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          engine: string
          id?: string
          last_beat_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          engine?: string
          id?: string
          last_beat_at?: string
          status?: string
          updated_at?: string
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
      system_locks: {
        Row: {
          acquired_at: string
          holder: string | null
          key: string
          locked_until: string
        }
        Insert: {
          acquired_at?: string
          holder?: string | null
          key: string
          locked_until: string
        }
        Update: {
          acquired_at?: string
          holder?: string | null
          key?: string
          locked_until?: string
        }
        Relationships: []
      }
      trades: {
        Row: {
          ai_analysis: Json | null
          client_order_id: string | null
          closed_at: string | null
          confidence: number | null
          direction: string
          entry_price: number
          environment: string | null
          excursion_updated_at: string | null
          exit_price: number | null
          id: string
          lot_size: number
          mae: number | null
          mae_r: number | null
          mfe: number | null
          mfe_r: number | null
          mode: string
          opened_at: string
          pnl: number | null
          reason_entry: string | null
          reason_exit: string | null
          risk_reward: number | null
          session: string | null
          source: string
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
          client_order_id?: string | null
          closed_at?: string | null
          confidence?: number | null
          direction: string
          entry_price: number
          environment?: string | null
          excursion_updated_at?: string | null
          exit_price?: number | null
          id?: string
          lot_size?: number
          mae?: number | null
          mae_r?: number | null
          mfe?: number | null
          mfe_r?: number | null
          mode?: string
          opened_at?: string
          pnl?: number | null
          reason_entry?: string | null
          reason_exit?: string | null
          risk_reward?: number | null
          session?: string | null
          source?: string
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
          client_order_id?: string | null
          closed_at?: string | null
          confidence?: number | null
          direction?: string
          entry_price?: number
          environment?: string | null
          excursion_updated_at?: string | null
          exit_price?: number | null
          id?: string
          lot_size?: number
          mae?: number | null
          mae_r?: number | null
          mfe?: number | null
          mfe_r?: number | null
          mode?: string
          opened_at?: string
          pnl?: number | null
          reason_entry?: string | null
          reason_exit?: string | null
          risk_reward?: number | null
          session?: string | null
          source?: string
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
          cooldown_minutes: number
          created_at: string
          execution_mode: string
          kill_switch_active: boolean
          kill_switch_reason: string | null
          kill_switch_since: string | null
          live_trading_enabled: boolean
          max_correlated_trades: number
          max_daily_loss: number
          max_drawdown_pct: number
          max_open_trades: number
          max_risk_per_trade_pct: number
          max_total_exposure_lots: number
          max_trades_per_day: number
          max_weekly_loss: number
          notify_browser: boolean
          notify_email: boolean
          preferred_session: string
          preferred_timeframe: string
          recovery_mode_enabled: boolean
          risk_per_trade: number
          trading_mode: string
          updated_at: string
          user_id: string
          webhook_enabled: boolean
          webhook_token: string | null
        }
        Insert: {
          auto_execute?: boolean
          avoid_news?: boolean
          cooldown_minutes?: number
          created_at?: string
          execution_mode?: string
          kill_switch_active?: boolean
          kill_switch_reason?: string | null
          kill_switch_since?: string | null
          live_trading_enabled?: boolean
          max_correlated_trades?: number
          max_daily_loss?: number
          max_drawdown_pct?: number
          max_open_trades?: number
          max_risk_per_trade_pct?: number
          max_total_exposure_lots?: number
          max_trades_per_day?: number
          max_weekly_loss?: number
          notify_browser?: boolean
          notify_email?: boolean
          preferred_session?: string
          preferred_timeframe?: string
          recovery_mode_enabled?: boolean
          risk_per_trade?: number
          trading_mode?: string
          updated_at?: string
          user_id: string
          webhook_enabled?: boolean
          webhook_token?: string | null
        }
        Update: {
          auto_execute?: boolean
          avoid_news?: boolean
          cooldown_minutes?: number
          created_at?: string
          execution_mode?: string
          kill_switch_active?: boolean
          kill_switch_reason?: string | null
          kill_switch_since?: string | null
          live_trading_enabled?: boolean
          max_correlated_trades?: number
          max_daily_loss?: number
          max_drawdown_pct?: number
          max_open_trades?: number
          max_risk_per_trade_pct?: number
          max_total_exposure_lots?: number
          max_trades_per_day?: number
          max_weekly_loss?: number
          notify_browser?: boolean
          notify_email?: boolean
          preferred_session?: string
          preferred_timeframe?: string
          recovery_mode_enabled?: boolean
          risk_per_trade?: number
          trading_mode?: string
          updated_at?: string
          user_id?: string
          webhook_enabled?: boolean
          webhook_token?: string | null
        }
        Relationships: []
      }
      webhook_signals: {
        Row: {
          action: string
          ai_confidence: number | null
          ai_reasoning: Json
          ai_verdict: string | null
          comment: string | null
          error: string | null
          id: string
          lot_size: number | null
          price: number | null
          processed_at: string | null
          raw: Json
          received_at: string
          source: string
          status: string
          stop_loss: number | null
          symbol: string
          take_profit: number | null
          user_id: string
        }
        Insert: {
          action: string
          ai_confidence?: number | null
          ai_reasoning?: Json
          ai_verdict?: string | null
          comment?: string | null
          error?: string | null
          id?: string
          lot_size?: number | null
          price?: number | null
          processed_at?: string | null
          raw?: Json
          received_at?: string
          source?: string
          status?: string
          stop_loss?: number | null
          symbol?: string
          take_profit?: number | null
          user_id: string
        }
        Update: {
          action?: string
          ai_confidence?: number | null
          ai_reasoning?: Json
          ai_verdict?: string | null
          comment?: string | null
          error?: string | null
          id?: string
          lot_size?: number | null
          price?: number | null
          processed_at?: string | null
          raw?: Json
          received_at?: string
          source?: string
          status?: string
          stop_loss?: number | null
          symbol?: string
          take_profit?: number | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      release_lock: {
        Args: { _holder: string; _key: string }
        Returns: undefined
      }
      try_acquire_lock: {
        Args: { _holder: string; _key: string; _ttl_seconds: number }
        Returns: boolean
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
  public: {
    Enums: {},
  },
} as const
