-- ==========================================================================
-- Wicktor v3 — TP completion time and trade duration metrics
--
-- Tracks the elapsed time (in minutes from entry) to hit each take-profit
-- level (TP1, TP2, TP3) and the total trade duration from entry to exit.
-- Enables computing average time to each TP and average trade lifespan.
-- ==========================================================================

alter table signal_journal
  add column if not exists tp1_time_min integer,
  add column if not exists tp2_time_min integer,
  add column if not exists tp3_time_min integer,
  add column if not exists duration_min integer;
