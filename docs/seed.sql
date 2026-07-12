-- =============================================================
-- EFAR Ambulance Scheduling System – Seed Data
-- Run AFTER schema.sql in the Supabase SQL Editor.
--
-- Safe to re-run: it clears all operational data first (staff, rosters,
-- assignments, flags, etc.) and reseeds from scratch. It does NOT touch the
-- `profiles` table, so your login accounts are preserved.
--
-- Staffing is sized to fully crew 3 ambulances running day + night shifts
-- (16 slots/day) with a small buffer:
--   • 8 drivers + 4 paramedics  → 12 staff certified for EAS *and* MTS
--   • 4 medics  + 4 EMTs        →  8 staff certified for MTS only
-- EAS shifts can only be filled by drivers/paramedics, so keeping 12 of them
-- comfortably covers the 8 EAS slots/day, and the remaining staff cover MTS.
-- =============================================================

-- -------------------------------------------------------------
-- Reset operational data (keeps profiles / auth users)
-- -------------------------------------------------------------
-- CASCADE clears dependent rows (staff_certifications, staff_preferences,
-- availability, assignments, …) via their foreign keys, so tables added by
-- later migrations do not need to be listed here explicitly.
TRUNCATE
    ambulances,
    staff,
    staff_certifications,
    availability,
    leave_requests,
    rosters,
    shift_slots,
    assignments,
    flags,
    audit_log,
    jobs
RESTART IDENTITY CASCADE;

-- -------------------------------------------------------------
-- Ambulances
-- -------------------------------------------------------------
INSERT INTO ambulances (registration, service_type, status) VALUES
    ('AMB-001', 'MTS',  'active'),
    ('AMB-002', 'EAS',  'active'),
    ('AMB-003', 'both', 'active');

-- -------------------------------------------------------------
-- Staff
-- IDs 1–8   : MTS-only staff (medics + EMTs)
-- IDs 9–20  : EAS-capable staff (drivers + paramedics)
-- The ordering helps the scheduler assign MTS-only staff to MTS slots and
-- reserve drivers/paramedics for EAS.
-- -------------------------------------------------------------
INSERT INTO staff (full_name, phone, email, role, employment_type, home_postal, status) VALUES
    -- MTS-only (medics + EMTs)
    ('Mary Lim',      '+65 9100 0001', 'mary.lim@efar.sg',      'medic',     'full_time', '018989', 'active'),
    ('Ahmad Bin',     '+65 9100 0002', 'ahmad.bin@efar.sg',     'emt',       'full_time', '560231', 'active'),
    ('Priya Nair',    '+65 9100 0003', 'priya.nair@efar.sg',    'medic',     'full_time', '150072', 'active'),
    ('Daniel Goh',    '+65 9100 0004', 'daniel.goh@efar.sg',    'emt',       'full_time', '520201', 'active'),
    ('Siti Rahim',    '+65 9100 0005', 'siti.rahim@efar.sg',    'medic',     'part_time', '640210', 'active'),
    ('Marcus Teo',    '+65 9100 0006', 'marcus.teo@efar.sg',    'emt',       'full_time', '129588', 'active'),
    ('Grace Chua',    '+65 9100 0007', 'grace.chua@efar.sg',    'medic',     'full_time', '310450', 'active'),
    ('Farid Hassan',  '+65 9100 0008', 'farid.hassan@efar.sg',  'emt',       'part_time', '760123', 'active'),
    -- EAS-capable (drivers)
    ('John Tan',      '+65 9100 0009', 'john.tan@efar.sg',      'driver',    'full_time', '238859', 'active'),
    ('Kevin Ng',      '+65 9100 0010', 'kevin.ng@efar.sg',      'driver',    'full_time', '310123', 'active'),
    ('Raj Kumar',     '+65 9100 0011', 'raj.kumar@efar.sg',     'driver',    'full_time', '090111', 'active'),
    ('Wei Jie Lee',   '+65 9100 0012', 'weijie.lee@efar.sg',    'driver',    'full_time', '460022', 'active'),
    ('Hafiz Osman',   '+65 9100 0013', 'hafiz.osman@efar.sg',   'driver',    'full_time', '510388', 'active'),
    ('Benjamin Koh',  '+65 9100 0014', 'ben.koh@efar.sg',       'driver',    'part_time', '218041', 'active'),
    ('Nurul Aini',    '+65 9100 0015', 'nurul.aini@efar.sg',    'driver',    'full_time', '387123', 'active'),
    ('Terrence Sim',  '+65 9100 0016', 'terrence.sim@efar.sg',  'driver',    'part_time', '640455', 'active'),
    -- EAS-capable (paramedics)
    ('Sarah Wong',    '+65 9100 0017', 'sarah.wong@efar.sg',    'paramedic', 'full_time', '408600', 'active'),
    ('Aisha Yusof',   '+65 9100 0018', 'aisha.yusof@efar.sg',   'paramedic', 'full_time', '120333', 'active'),
    ('Ryan Chen',     '+65 9100 0019', 'ryan.chen@efar.sg',     'paramedic', 'full_time', '270901', 'active'),
    ('Melissa Ong',   '+65 9100 0020', 'melissa.ong@efar.sg',   'paramedic', 'part_time', '550218', 'active');

-- -------------------------------------------------------------
-- Staff Certifications
-- MTS certification for everyone; EAS certification for drivers & paramedics.
-- Dates are relative to today so certs never appear expired.
-- -------------------------------------------------------------
INSERT INTO staff_certifications (staff_id, cert_name, issued_date, expiry_date)
SELECT staff_id, 'MTS', CURRENT_DATE - INTERVAL '1 year', CURRENT_DATE + INTERVAL '2 years'
FROM staff;

INSERT INTO staff_certifications (staff_id, cert_name, issued_date, expiry_date)
SELECT staff_id, 'EAS', CURRENT_DATE - INTERVAL '1 year', CURRENT_DATE + INTERVAL '2 years'
FROM staff
WHERE role IN ('driver', 'paramedic');

-- -------------------------------------------------------------
-- Availability – all staff available today and for the next 7 days
-- (8 days total: today + 7 future dates)
-- -------------------------------------------------------------
INSERT INTO availability (staff_id, work_date, is_available, source)
SELECT
    s.staff_id,
    CURRENT_DATE + offset_days.n,
    TRUE,
    'app'
FROM
    staff s
    CROSS JOIN (SELECT generate_series(0, 7) AS n) AS offset_days;

-- -------------------------------------------------------------
-- Staff Preferences (UC-005 preference scoring)
-- Give a spread of early-riser / late-shift preferences so the ranking
-- engine's preference component varies across candidates. Requires the
-- staff_preferences table (schema.sql or the 2026-07-12 migration).
-- Odd staff_id → early riser; every third staff_id → late shift.
-- -------------------------------------------------------------
INSERT INTO staff_preferences (staff_id, prefers_early, prefers_late)
SELECT
    staff_id,
    (staff_id % 2 = 1),
    (staff_id % 3 = 0)
FROM staff
ON CONFLICT (staff_id) DO NOTHING;
