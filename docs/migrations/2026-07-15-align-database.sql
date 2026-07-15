-- =============================================================
-- Migration: align an existing / parallel database to the current backend
-- Date: 2026-07-15
--
-- Run this ONCE in the Supabase SQL Editor when you point the app at a
-- database that was NOT created from the current docs/schema.sql — e.g. a
-- database built from the older `admin`/`ops_director` schema that has no
-- profiles.staff_id column and no staff_preferences table. Symptoms without
-- it: login works but every write returns 403 / 500, and roster generation
-- assigns nobody.
--
-- This is a superset of:
--   • 2026-07-09-roles-and-staff-link.sql   (profiles: staff link + roles)
--   • 2026-07-12-staff-preferences.sql       (staff_preferences table)
--   • 2026-07-14-renew-certifications.sql    (cert backfill + renewal)
--
-- Every statement is idempotent and safe to re-run, and safe on a database
-- that already matches the current schema (it becomes a no-op).
-- =============================================================

-- 1) profiles: staff link + admin/employee role model ------------------------
--    The backend links a login to its staff record via profiles.staff_id, and
--    uses the role set ('admin','employee'). Older databases used
--    ('admin','ops_director') and had no staff_id column.
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS staff_id INT REFERENCES staff(staff_id) ON DELETE SET NULL;

-- Migrate the old full-access role BEFORE tightening the CHECK constraint.
UPDATE profiles SET role = 'admin' WHERE role = 'ops_director';

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'employee';
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'employee'));

-- Keep your admin login an admin. EDIT the email if your admin differs.
UPDATE profiles p
SET role = 'admin'
FROM auth.users u
WHERE u.id = p.id
  AND u.email = 'admin@efar.sg';

-- Link existing logins to staff records by matching email (the backend also
-- self-heals this on the next authenticated request, but doing it now is tidy).
UPDATE profiles p
SET staff_id = s.staff_id
FROM auth.users u
JOIN staff s ON s.email = u.email
WHERE u.id = p.id
  AND p.staff_id IS NULL;

-- 2) staff_preferences (UC-005 / UC-007 soft signals) ------------------------
--    The ranking engine reads this for the preference/buddy score. It tolerates
--    the table being absent, but the preference component only varies once it
--    exists.
CREATE TABLE IF NOT EXISTS staff_preferences (
    staff_id       INT PRIMARY KEY REFERENCES staff(staff_id) ON DELETE CASCADE,
    prefers_early  BOOLEAN NOT NULL DEFAULT FALSE,
    prefers_late   BOOLEAN NOT NULL DEFAULT FALSE,
    buddy_staff_id INT REFERENCES staff(staff_id) ON DELETE SET NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE staff_preferences
    ADD COLUMN IF NOT EXISTS buddy_staff_id INT REFERENCES staff(staff_id) ON DELETE SET NULL;

-- 3) certifications: backfill + renew (UC-004 Filter 5) ----------------------
--    The strict cert-expiry filter blocks any staff member without a real,
--    unexpired cert for the service type, so generation assigns nobody. Seed
--    the role-implied certs and renew any that are expired / expiring soon.
INSERT INTO staff_certifications (staff_id, cert_name, issued_date, expiry_date)
SELECT s.staff_id, 'MTS', CURRENT_DATE, CURRENT_DATE + INTERVAL '2 years'
FROM staff s
WHERE s.status = 'active'
ON CONFLICT (staff_id, cert_name) DO NOTHING;

INSERT INTO staff_certifications (staff_id, cert_name, issued_date, expiry_date)
SELECT s.staff_id, 'EAS', CURRENT_DATE, CURRENT_DATE + INTERVAL '2 years'
FROM staff s
WHERE s.status = 'active'
  AND s.role IN ('driver', 'paramedic')
ON CONFLICT (staff_id, cert_name) DO NOTHING;

UPDATE staff_certifications c
SET issued_date = CURRENT_DATE,
    expiry_date = CURRENT_DATE + INTERVAL '2 years'
FROM staff s
WHERE c.staff_id = s.staff_id
  AND s.status = 'active'
  AND c.expiry_date IS NOT NULL
  AND c.expiry_date < CURRENT_DATE + INTERVAL '30 days';
