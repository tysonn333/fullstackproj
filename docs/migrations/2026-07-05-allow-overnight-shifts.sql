-- =============================================================
-- Migration: allow overnight shift slots
-- Run this in the Supabase SQL Editor if you created your database
-- from a schema.sql version dated before 2026-07-05.
--
-- The original schema had CHECK (end_time > start_time) on shift_slots,
-- which rejected the generator's night shift (18:00 → 06:00) and made
-- roster generation fail on every call. Shifts with end_time earlier
-- than start_time are now interpreted as crossing midnight.
-- =============================================================

ALTER TABLE shift_slots DROP CONSTRAINT IF EXISTS shift_slots_check;
ALTER TABLE shift_slots ADD CONSTRAINT shift_slots_check CHECK (end_time <> start_time);
