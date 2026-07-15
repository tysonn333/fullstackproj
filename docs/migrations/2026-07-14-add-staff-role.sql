-- =============================================================
-- Add staff profile role & link staff records to auth users
-- =============================================================

-- 1. Allow 'staff' in the profiles role check constraint
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check,
  ADD  CONSTRAINT profiles_role_check
    CHECK (role IN ('admin', 'ops_director', 'staff'));

-- 2. Add profile_id to staff table (links a staff row to an auth user)
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id)
    ON DELETE SET NULL;
