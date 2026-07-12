-- =============================================================
-- Migration: staff_preferences table (UC-005 preference scoring)
-- Date: 2026-07-12
--
-- Adds the soft shift-time preference table read by the UC-005 ranking
-- engine (getPreferenceScore). Safe to run on an existing database — the
-- ranking code already tolerates the table being absent, but creating it
-- lets the preference component of the composite score become meaningful.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

CREATE TABLE IF NOT EXISTS staff_preferences (
    staff_id      INT PRIMARY KEY REFERENCES staff(staff_id) ON DELETE CASCADE,
    prefers_early BOOLEAN NOT NULL DEFAULT FALSE,
    prefers_late  BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
