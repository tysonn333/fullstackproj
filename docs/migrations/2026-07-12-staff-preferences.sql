-- =============================================================
-- Migration: staff_preferences table (UC-005 / UC-007)
-- Date: 2026-07-12
--
-- Adds the soft-signal table read by the UC-005 ranking engine:
--   • prefers_early / prefers_late — shift-time preference score
--   • buddy_staff_id — preferred working partner (soft; honoured when the
--     buddy ranks in the top 3 of the opposite crew pool during pairing)
--
-- Safe to run on an existing database — the ranking code tolerates the table
-- being absent, but creating it makes the preference and buddy components of
-- the composite score meaningful.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

CREATE TABLE IF NOT EXISTS staff_preferences (
    staff_id       INT PRIMARY KEY REFERENCES staff(staff_id) ON DELETE CASCADE,
    prefers_early  BOOLEAN NOT NULL DEFAULT FALSE,
    prefers_late   BOOLEAN NOT NULL DEFAULT FALSE,
    buddy_staff_id INT REFERENCES staff(staff_id) ON DELETE SET NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- If the table already exists from an earlier run without the buddy column:
ALTER TABLE staff_preferences
    ADD COLUMN IF NOT EXISTS buddy_staff_id INT REFERENCES staff(staff_id) ON DELETE SET NULL;
