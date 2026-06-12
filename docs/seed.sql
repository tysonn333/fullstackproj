-- =============================================================
-- EFAR Ambulance Scheduling System – Seed Data
-- Run AFTER schema.sql in the Supabase SQL Editor
-- =============================================================

-- -------------------------------------------------------------
-- Ambulances
-- -------------------------------------------------------------
INSERT INTO ambulances (registration, service_type, status) VALUES
    ('AMB-001', 'MTS',  'active'),
    ('AMB-002', 'EAS',  'active'),
    ('AMB-003', 'both', 'active');

-- -------------------------------------------------------------
-- Staff
-- -------------------------------------------------------------
INSERT INTO staff (full_name, phone, email, role, employment_type, home_postal, status) VALUES
    ('John Tan',   '+65 9100 0001', 'john.tan@efar.sg',   'driver',    'full_time',  '238859', 'active'),
    ('Mary Lim',   '+65 9100 0002', 'mary.lim@efar.sg',   'medic',     'full_time',  '018989', 'active'),
    ('Ahmad Bin',  '+65 9100 0003', 'ahmad.bin@efar.sg',  'emt',       'full_time',  '560231', 'active'),
    ('Sarah Wong', '+65 9100 0004', 'sarah.wong@efar.sg', 'paramedic', 'full_time',  '408600', 'active'),
    ('Kevin Ng',   '+65 9100 0005', 'kevin.ng@efar.sg',   'driver',    'part_time',  '310123', 'active');

-- -------------------------------------------------------------
-- Staff Certifications
-- MTS certification for all staff
-- EAS certification for paramedic and drivers
-- -------------------------------------------------------------

-- MTS for all
INSERT INTO staff_certifications (staff_id, cert_name, issued_date, expiry_date) VALUES
    (1, 'MTS', '2023-01-15', '2026-01-14'),  -- John Tan
    (2, 'MTS', '2023-02-20', '2026-02-19'),  -- Mary Lim
    (3, 'MTS', '2023-03-10', '2026-03-09'),  -- Ahmad Bin
    (4, 'MTS', '2023-04-05', '2026-04-04'),  -- Sarah Wong
    (5, 'MTS', '2023-05-18', '2026-05-17');  -- Kevin Ng

-- EAS for paramedic and drivers
INSERT INTO staff_certifications (staff_id, cert_name, issued_date, expiry_date) VALUES
    (4, 'EAS', '2022-06-01', '2025-05-31'),  -- Sarah Wong (paramedic)
    (1, 'EAS', '2022-07-12', '2025-07-11'),  -- John Tan   (driver)
    (5, 'EAS', '2022-08-25', '2025-08-24');  -- Kevin Ng   (driver)

-- -------------------------------------------------------------
-- Availability – all 5 staff available today and for the next
-- 7 days (8 days total: today + 7 future dates)
-- -------------------------------------------------------------
INSERT INTO availability (staff_id, work_date, is_available, source)
SELECT
    s.staff_id,
    CURRENT_DATE + offset_days.n,
    TRUE,
    'app'
FROM
    staff s
    CROSS JOIN (
        SELECT generate_series(0, 7) AS n
    ) AS offset_days;
