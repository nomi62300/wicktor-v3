-- ==========================================================================
-- Wicktor v3 — Plan C: Dynamic Trailing Stop & Tighter Time Horizon
--
-- Tracks the realised R-multiple for Plan C:
-- - TP1: 1/3 at +1R, stop moves to breakeven (0R)
-- - Dynamic trail: remaining 2/3 trails 0.5R behind peak favorable excursion
-- - TP2: 1/3 at +2R, floor ratchets to at least TP1 (+1/3 target)
-- - TP3: 1/3 at +3R
-- - Timeout: tighter 48-bar (4h) holding window instead of 96 bars (8h)
-- ==========================================================================

alter table signal_journal
  add column if not exists outcome_c numeric;
