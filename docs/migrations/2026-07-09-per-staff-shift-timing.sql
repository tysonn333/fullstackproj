-- =============================================================
-- Migration: per-staff shift timing overrides
-- Run this in the Supabase SQL Editor if your database was created before
-- 2026-07-09. Fresh databases already include these changes via schema.sql.
--
-- Why:
--   Shift timings live on shift_slots (start_time / end_time) and are shared by
--   the whole crew of that slot. On the real roster an individual crew member
--   sometimes works a different band from the rest of the crew (e.g. 09:15–17:30
--   while the ambulance runs 08:00–18:00). Timing was therefore effectively
--   fixed per slot with no way to record a per-person exception.
--
-- What it does:
--   Adds optional start_time / end_time columns to assignments. When NULL, the
--   crew member inherits the slot's band (the common case). When set, they
--   record that individual's own irregular timing. Both must be provided
--   together, and (like shift_slots) end_time <= start_time is allowed and means
--   the override crosses midnight; only a zero-length override is rejected.
-- =============================================================

ALTER TABLE assignments
    ADD COLUMN IF NOT EXISTS start_time TIME,
    ADD COLUMN IF NOT EXISTS end_time   TIME;

ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_timing_check;
ALTER TABLE assignments ADD CONSTRAINT assignments_timing_check CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time <> end_time)
);
