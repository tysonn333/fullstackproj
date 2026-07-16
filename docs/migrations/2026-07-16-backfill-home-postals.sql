-- =============================================================
-- Migration: assign home postal codes to ALL staff (UC-005 proximity)
-- Date: 2026-07-16
--
-- Why: the UC-005 proximity score and the "km from base" figure are derived
-- from the staff member's Singapore postal code (first two digits → postal
-- district → district centre → distance to the station at 169608). When staff
-- rows have missing/unmappable home_postal values, everyone collapses onto the
-- same default map centre — so the ranking modal shows the SAME distance for
-- everybody and proximity stops differentiating candidates.
--
-- This script assigns a realistic postal code to EVERY staff member,
-- spread across ~20 postal districts island-wide — from Queenstown (~1 km
-- from base) out to Woodlands (~18 km) — so distances, proximity scores, and
-- crew-pairing radii all show genuine variety in the demo.
--
-- The assignment is deterministic (staff_id modulo the list), so re-running
-- never reshuffles anyone. Idempotent and safe to re-run.
-- Run in the Supabase SQL Editor.
-- =============================================================

UPDATE staff
SET home_postal = (
  ARRAY[
    '140150', -- Queenstown        (district 3,  ~1 km from base)
    '090020', -- Telok Blangah     (district 4,  ~3 km)
    '310450', -- Toa Payoh         (district 12, ~5 km)
    '380105', -- Geylang           (district 14, ~6 km)
    '560330', -- Ang Mo Kio        (district 20, ~9 km)
    '440033', -- Marine Parade     (district 15, ~7 km)
    '460210', -- Bedok             (district 16, ~10 km)
    '120415', -- Clementi          (district 5,  ~7 km)
    '520110', -- Tampines          (district 18, ~13 km)
    '650230', -- Bukit Batok       (district 23, ~11 km)
    '820170', -- Punggol           (district 19, ~12 km)
    '600130', -- Jurong East       (district 22, ~12 km)
    '760440', -- Yishun            (district 27, ~13 km)
    '530190', -- Hougang           (district 19, ~10 km)
    '640520', -- Jurong West       (district 22, ~14 km)
    '730680', -- Woodlands         (district 25, ~16 km)
    '210050', -- Rochor            (district 8,  ~3 km)
    '580120', -- Upper Bukit Timah (district 21, ~8 km)
    '790110', -- Sembawang         (district 28, ~14 km)
    '270018'  -- Bukit Timah       (district 10, ~5 km)
  ]
)[(staff_id % 20) + 1];
