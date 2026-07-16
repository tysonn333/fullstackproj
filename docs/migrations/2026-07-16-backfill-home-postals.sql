-- =============================================================
-- Migration: backfill staff home postal codes (UC-005 proximity)
-- Date: 2026-07-16
--
-- Why: the UC-005 proximity score and the "km from base" figure are derived
-- from the staff member's Singapore postal code (first two digits → postal
-- district → district centre → distance to the station). When staff rows have
-- NULL / empty / unmappable home_postal values, every one of them falls back
-- to the same default map centre — so the ranking modal shows the SAME
-- distance for everybody and proximity stops differentiating candidates.
--
-- This script assigns a realistic postal code, spread across districts all
-- over the island, to every staff member whose home_postal is missing or not
-- a valid 6-digit code. The assignment is deterministic (staff_id modulo the
-- list) so re-running never reshuffles anyone. Staff who already have a valid
-- postal code are left untouched.
--
-- The app now reports "distance unknown" instead of a fake number for staff
-- without a mappable postal — this backfill gives the demo real variety.
--
-- Idempotent and safe to re-run. Run in the Supabase SQL Editor.
-- =============================================================

UPDATE staff
SET home_postal = (
  ARRAY[
    '140150', -- Queenstown        (district 3, ~1 km from base)
    '310450', -- Toa Payoh         (district 12)
    '460210', -- Bedok             (district 16)
    '520110', -- Tampines          (district 18)
    '560330', -- Ang Mo Kio        (district 20)
    '640520', -- Jurong West       (district 22)
    '730680', -- Woodlands         (district 25)
    '820170', -- Punggol           (district 19)
    '090020', -- Telok Blangah     (district 4)
    '600130'  -- Jurong East       (district 22)
  ]
)[(staff_id % 10) + 1]
WHERE home_postal IS NULL
   OR btrim(home_postal) = ''
   OR btrim(home_postal) !~ '^[0-9]{6}$';
