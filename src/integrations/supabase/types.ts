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
      correlation_pairs: {
        Row: {
          correlation: string
          created_at: string
          id: string
          note: string | null
          pair_1: string
          pair_2: string
          updated_at: string
        }
        Insert: {
          correlation: string
          created_at?: string
          id?: string
          note?: string | null
          pair_1: string
          pair_2: string
          updated_at?: string
        }
        Update: {
          correlation?: string
          created_at?: string
          id?: string
          note?: string | null
          pair_1?: string
          pair_2?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_performance: {
        Row: {
          created_at: string
          daily_pnl_percent: number
          id: string
          max_drawdown_percent: number
          signals_generated: number
          signals_lost: number
          signals_paused_at: string | null
          signals_won: number
          total_r_multiple: number
          trade_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_pnl_percent?: number
          id?: string
          max_drawdown_percent?: number
          signals_generated?: number
          signals_lost?: number
          signals_paused_at?: string | null
          signals_won?: number
          total_r_multiple?: number
          trade_date?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_pnl_percent?: number
          id?: string
          max_drawdown_percent?: number
          signals_generated?: number
          signals_lost?: number
          signals_paused_at?: string | null
          signals_won?: number
          total_r_multiple?: number
          trade_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      generated_signals: {
        Row: {
          actual_exit_price: number | null
          actual_pnl_pips: number | null
          atr_percentile_at_entry: number | null
          closed_at: string | null
          confidence: number
          confluence_breakdown: Json | null
          confluence_score_max: number | null
          confluence_score_total: number | null
          created_at: string
          direction: string
          duration_minutes: number | null
          effective_entry: number | null
          engine_generated: boolean | null
          entry_price: number
          generated_at: string
          id: string
          instrument: string
          notes: string | null
          outcome: string | null
          r_multiple: number | null
          reasoning: string | null
          resolution_method: string | null
          risk_reward_ratio: number | null
          session: string | null
          setup_type: string | null
          spread_applied: number | null
          spread_multiplier_applied: number | null
          stop_loss: number
          take_profit_1: number
          take_profit_2: number
          take_profit_3: number
          trade_type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          actual_exit_price?: number | null
          actual_pnl_pips?: number | null
          atr_percentile_at_entry?: number | null
          closed_at?: string | null
          confidence: number
          confluence_breakdown?: Json | null
          confluence_score_max?: number | null
          confluence_score_total?: number | null
          created_at?: string
          direction: string
          duration_minutes?: number | null
          effective_entry?: number | null
          engine_generated?: boolean | null
          entry_price: number
          generated_at?: string
          id?: string
          instrument: string
          notes?: string | null
          outcome?: string | null
          r_multiple?: number | null
          reasoning?: string | null
          resolution_method?: string | null
          risk_reward_ratio?: number | null
          session?: string | null
          setup_type?: string | null
          spread_applied?: number | null
          spread_multiplier_applied?: number | null
          stop_loss: number
          take_profit_1: number
          take_profit_2: number
          take_profit_3: number
          trade_type: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          actual_exit_price?: number | null
          actual_pnl_pips?: number | null
          atr_percentile_at_entry?: number | null
          closed_at?: string | null
          confidence?: number
          confluence_breakdown?: Json | null
          confluence_score_max?: number | null
          confluence_score_total?: number | null
          created_at?: string
          direction?: string
          duration_minutes?: number | null
          effective_entry?: number | null
          engine_generated?: boolean | null
          entry_price?: number
          generated_at?: string
          id?: string
          instrument?: string
          notes?: string | null
          outcome?: string | null
          r_multiple?: number | null
          reasoning?: string | null
          resolution_method?: string | null
          risk_reward_ratio?: number | null
          session?: string | null
          setup_type?: string | null
          spread_applied?: number | null
          spread_multiplier_applied?: number | null
          stop_loss?: number
          take_profit_1?: number
          take_profit_2?: number
          take_profit_3?: number
          trade_type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      trades: {
        Row: {
          atr_percentile_at_entry: number | null
          created_at: string
          direction: string
          effective_entry: number | null
          entry_price: number
          entry_time: string
          exit_price: number | null
          exit_time: string | null
          id: string
          instrument: string
          lot_size: number
          notes: string | null
          outcome: string | null
          pnl_amount: number | null
          pnl_pips: number | null
          resolution_method: string | null
          setup_type: string | null
          spread_applied: number | null
          spread_multiplier_applied: number | null
          stop_loss: number | null
          take_profit: number | null
          take_profit_2: number | null
          take_profit_3: number | null
          target_hit: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          atr_percentile_at_entry?: number | null
          created_at?: string
          direction: string
          effective_entry?: number | null
          entry_price: number
          entry_time?: string
          exit_price?: number | null
          exit_time?: string | null
          id?: string
          instrument: string
          lot_size: number
          notes?: string | null
          outcome?: string | null
          pnl_amount?: number | null
          pnl_pips?: number | null
          resolution_method?: string | null
          setup_type?: string | null
          spread_applied?: number | null
          spread_multiplier_applied?: number | null
          stop_loss?: number | null
          take_profit?: number | null
          take_profit_2?: number | null
          take_profit_3?: number | null
          target_hit?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          atr_percentile_at_entry?: number | null
          created_at?: string
          direction?: string
          effective_entry?: number | null
          entry_price?: number
          entry_time?: string
          exit_price?: number | null
          exit_time?: string | null
          id?: string
          instrument?: string
          lot_size?: number
          notes?: string | null
          outcome?: string | null
          pnl_amount?: number | null
          pnl_pips?: number | null
          resolution_method?: string | null
          setup_type?: string | null
          spread_applied?: number | null
          spread_multiplier_applied?: number | null
          stop_loss?: number | null
          take_profit?: number | null
          take_profit_2?: number | null
          take_profit_3?: number | null
          target_hit?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          auto_disable_on_drawdown: boolean
          auto_engine_enabled: boolean
          created_at: string
          forex_min_rr: number
          id: string
          ignore_counter_trend: boolean
          max_daily_loss_percent: number
          max_drawdown_percent: number
          max_trades_per_day: number
          notify_instruments: string[] | null
          notify_min_confidence: number
          risk_percent_per_trade: number
          signals_paused: boolean
          synthetic_min_rr: number
          telegram_bot_token: string | null
          telegram_chat_id: string | null
          telegram_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_disable_on_drawdown?: boolean
          auto_engine_enabled?: boolean
          created_at?: string
          forex_min_rr?: number
          id?: string
          ignore_counter_trend?: boolean
          max_daily_loss_percent?: number
          max_drawdown_percent?: number
          max_trades_per_day?: number
          notify_instruments?: string[] | null
          notify_min_confidence?: number
          risk_percent_per_trade?: number
          signals_paused?: boolean
          synthetic_min_rr?: number
          telegram_bot_token?: string | null
          telegram_chat_id?: string | null
          telegram_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_disable_on_drawdown?: boolean
          auto_engine_enabled?: boolean
          created_at?: string
          forex_min_rr?: number
          id?: string
          ignore_counter_trend?: boolean
          max_daily_loss_percent?: number
          max_drawdown_percent?: number
          max_trades_per_day?: number
          notify_instruments?: string[] | null
          notify_min_confidence?: number
          risk_percent_per_trade?: number
          signals_paused?: boolean
          synthetic_min_rr?: number
          telegram_bot_token?: string | null
          telegram_chat_id?: string | null
          telegram_enabled?: boolean
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
      arbitrate_signal: {
        Args: {
          p_confidence: number
          p_direction: string
          p_instrument: string
          p_trade_type: string
          p_user_id: string
        }
        Returns: Json
      }
      signal_slot_is_live: {
        Args: { p_generated_at: string; p_trade_type: string }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
