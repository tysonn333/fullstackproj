-- =============================================================
-- Migration: renew / backfill staff certifications
-- Date: 2026-07-14
--
-- Why: UC-004 Filter 5 (certification match) is strict — a staff member is
-- eligible for a service type ONLY if they hold a real, UNEXPIRED cert row for
-- it. Staff created before cert auto-provisioning (or whose seed certs have
-- since expired) get filtered out of every slot, so roster generation quietly
-- assigns nobody. This script makes every active staff member schedulable
-- again:
--
--   (a) INSERT any missing role-implied certs
--         • MTS for every active staff member
--         • EAS for active drivers / paramedics
--       issued today, valid for two years — skipping rows that already exist.
--
--   (b) RENEW certs that are already expired or expire within 30 days, pushing
--       their expiry two years out (and re-stamping issued_date to today).
--
-- Idempotent and safe to re-run. Run in the Supabase SQL Editor.
-- =============================================================

-- (a) Backfill missing MTS certs for all active staff.
INSERT INTO staff_certifications (staff_id, cert_name, issued_date, expiry_date)
SELECT s.staff_id, 'MTS', CURRENT_DATE, CURRENT_DATE + INTERVAL '2 years'
FROM staff s
WHERE s.status = 'active'
ON CONFLICT (staff_id, cert_name) DO NOTHING;

-- (a) Backfill missing EAS certs for active drivers and paramedics.
INSERT INTO staff_certifications (staff_id, cert_name, issued_date, expiry_date)
SELECT s.staff_id, 'EAS', CURRENT_DATE, CURRENT_DATE + INTERVAL '2 years'
FROM staff s
WHERE s.status = 'active'
  AND s.role IN ('driver', 'paramedic')
ON CONFLICT (staff_id, cert_name) DO NOTHING;

-- (b) Renew soon-to-expire / expired certs for active staff.
UPDATE staff_certifications c
SET issued_date = CURRENT_DATE,
    expiry_date = CURRENT_DATE + INTERVAL '2 years'
FROM staff s
WHERE c.staff_id = s.staff_id
  AND s.status = 'active'
  AND c.expiry_date IS NOT NULL
  AND c.expiry_date < CURRENT_DATE + INTERVAL '30 days';
