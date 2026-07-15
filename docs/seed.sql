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
        ('John Tan',     '+65 9100 0001', 'john.tan@efar.sg',      'driver',    'full_time',  '238859', 'active'),
        ('Mary Lim',     '+65 9100 0002', 'mary.lim@efar.sg',      'medic',     'full_time',  '018989', 'active'),
        ('Ahmad Bin',    '+65 9100 0003', 'ahmad.bin@efar.sg',     'emt',       'full_time',  '560231', 'active'),
        ('Sarah Wong',   '+65 9100 0004', 'sarah.wong@efar.sg',    'paramedic', 'full_time',  '408600', 'active'),
        ('Kevin Ng',     '+65 9100 0005', 'kevin.ng@efar.sg',      'driver',    'part_time',  '310123', 'active'),
        ('David Chen',   '+65 9100 0006', 'david.chen@efar.sg',    'driver',    'full_time',  '470123', 'active'),
        ('Priya Kumar',  '+65 9100 0007', 'priya.kumar@efar.sg',   'driver',    'full_time',  '520831', 'active'),
        ('Alex Lee',     '+65 9100 0008', 'alex.lee@efar.sg',      'driver',    'full_time',  '189623', 'active'),
        ('Siti Rahman',  '+65 9100 0009', 'siti.rahman@efar.sg',   'medic',     'full_time',  '340987', 'active'),
        ('Raj Patel',    '+65 9100 0010', 'raj.patel@efar.sg',     'emt',       'full_time',  '760452', 'active'),
        ('Emily Teo',    '+65 9100 0011', 'emily.teo@efar.sg',    'driver',    'full_time',  '150892', 'active'),
        ('Hassan Ali',   '+65 9100 0012', 'hassan.ali@efar.sg',   'driver',    'full_time',  '680314', 'active'),
        ('Linda Ng',     '+65 9100 0013', 'linda.ng@efar.sg',     'paramedic', 'full_time',  '270546', 'active'),
        ('Omar Syed',    '+65 9100 0014', 'omar.syed@efar.sg',    'driver',    'part_time',  '390178', 'active'),
        ('Fiona Lim',    '+65 9100 0015', 'fiona.lim@efar.sg',    'medic',     'part_time',  '420965', 'active');

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
        (5, 'MTS', '2023-05-18', '2026-05-17'),  -- Kevin Ng
        (6, 'MTS', '2023-06-10', '2026-06-09'),  -- David Chen
        (7, 'MTS', '2023-07-15', '2026-07-14'),  -- Priya Kumar
        (8, 'MTS', '2023-08-20', '2026-08-19'),  -- Alex Lee
        (9, 'MTS', '2023-09-05', '2026-09-04'),  -- Siti Rahman
        (10, 'MTS', '2023-10-12', '2026-10-11'), -- Raj Patel
        (11, 'MTS', '2024-01-08', '2027-01-07'), -- Emily Teo
        (12, 'MTS', '2024-02-14', '2027-02-13'), -- Hassan Ali
        (13, 'MTS', '2024-03-20', '2027-03-19'), -- Linda Ng
        (14, 'MTS', '2024-04-18', '2027-04-17'), -- Omar Syed
        (15, 'MTS', '2024-05-22', '2027-05-21'); -- Fiona Lim

    -- EAS for paramedic and drivers
    INSERT INTO staff_certifications (staff_id, cert_name, issued_date, expiry_date) VALUES
        (4, 'EAS', '2022-06-01', '2025-05-31'),  -- Sarah Wong (paramedic)
        (1, 'EAS', '2022-07-12', '2025-07-11'),  -- John Tan   (driver)
        (5, 'EAS', '2022-08-25', '2025-08-24'),  -- Kevin Ng   (driver)
        (6, 'EAS', '2023-06-15', '2026-06-14'),  -- David Chen (driver)
        (7, 'EAS', '2023-07-20', '2026-07-19'),  -- Priya Kumar (driver)
        (8, 'EAS', '2023-08-25', '2026-08-24'),  -- Alex Lee   (driver)
        (11, 'EAS', '2024-02-10', '2027-02-09'), -- Emily Teo  (driver)
        (12, 'EAS', '2024-03-15', '2027-03-14'), -- Hassan Ali (driver)
        (13, 'EAS', '2024-04-20', '2027-04-19'), -- Linda Ng   (paramedic)
        (14, 'EAS', '2024-05-25', '2027-05-24'); -- Omar Syed  (driver)

    -- -------------------------------------------------------------
    -- Availability – all staff available today and for the next
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
