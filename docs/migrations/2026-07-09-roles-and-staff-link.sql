-- =============================================================
-- Migration: role-based access (admin / employee) + staff link
-- Run this in the Supabase SQL Editor if your database was created before
-- 2026-07-09. Fresh databases already include these changes via schema.sql.
--
-- What it does:
--   1. Adds profiles.staff_id, linking a login account to its staff record
--      (needed so employees can submit their OWN availability/leave).
--   2. Replaces the old role set ('admin','ops_director') with
--      ('admin','employee') and migrates existing ops_director → admin.
--   3. Makes 'employee' the default role for new accounts (least privilege).
--   4. Grants admin to your existing admin login (EDIT the email below).
-- =============================================================

-- 1. Staff link
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS staff_id INT REFERENCES staff(staff_id) ON DELETE SET NULL;

-- 2. Migrate the previous full-access role to 'admin' before tightening the check
UPDATE profiles SET role = 'admin' WHERE role = 'ops_director';

-- 3. Swap the role CHECK constraint and default
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'employee';
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'employee'));

-- 4. IMPORTANT: make sure your admin account keeps admin access.
--    Change the email to match your admin login before running.
UPDATE profiles p
SET role = 'admin'
FROM auth.users u
WHERE u.id = p.id
  AND u.email = 'admin@efar.sg';

-- (Optional) Link existing employee logins to staff records by matching email.
-- The backend also does this automatically on first login, but you can run it now:
UPDATE profiles p
SET staff_id = s.staff_id
FROM auth.users u
JOIN staff s ON s.email = u.email
WHERE u.id = p.id
  AND p.staff_id IS NULL;
