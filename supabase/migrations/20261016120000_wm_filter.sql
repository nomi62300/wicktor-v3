-- ==========================================================================
-- Wicktor v3 — Wicktor Momentum Filter (WM Filter)
--
-- Adds wm_filter flag to signal_journal:
-- - Long: 1h chg% > 0 AND 4h chg% > 0 AND 1h RSI >= 60
-- - Short: 1h chg% < 0 AND 4h chg% < 0 AND 1h RSI <= 40
-- ==========================================================================

alter table signal_journal
  add column if not exists wm_filter boolean default false;
