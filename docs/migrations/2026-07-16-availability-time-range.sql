-- =============================================================
-- Migration: time-range availability (UC-003)
-- Date: 2026-07-16
--
-- The "Set Availability" form now uses a 00:00–23:59 dual-handle time slider
-- instead of the Full day / AM only / PM only cards, so staff can say things
-- like "only free 13:00–19:00" or "only free after 20:00".
--
--   • start_time / end_time — the window the staff member IS available for.
--     Both NULL means the whole day (when is_available) or no window applies
--     (when NOT is_available). end_time = 23:59 means "until end of day".
--   • half_day stays for the WhatsApp path, which still only understands
--     AM/PM; the roster filter prefers the time window when one is present.
--
-- Existing half-day rows are backfilled with their equivalent window so the
-- calendar can display concrete hours for them too.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

ALTER TABLE availability
    ADD COLUMN IF NOT EXISTS start_time TIME DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS end_time   TIME DEFAULT NULL;

-- Why the staff member is unavailable (the app makes this mandatory when
-- is_available = FALSE; WhatsApp stores the raw message). Lets admins judge
-- whether someone can still be called when slots go unfilled.
ALTER TABLE availability
    ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT NULL;

-- Both bounds or neither, and the window must run forwards.
ALTER TABLE availability
    DROP CONSTRAINT IF EXISTS availability_time_window_chk;
ALTER TABLE availability
    ADD CONSTRAINT availability_time_window_chk
    CHECK (
        (start_time IS NULL AND end_time IS NULL)
        OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
    );

-- Backfill: express legacy AM/PM-only rows as their equivalent window.
UPDATE availability
SET start_time = '00:00', end_time = '12:00'
WHERE half_day = 'am' AND is_available AND start_time IS NULL;

UPDATE availability
SET start_time = '12:00', end_time = '23:59'
WHERE half_day = 'pm' AND is_available AND start_time IS NULL;
