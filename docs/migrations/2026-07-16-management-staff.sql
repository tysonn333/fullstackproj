-- Migration: management staff for the overflow deployment flow
-- (UC-004 A2 "management deployment required" / UC-002 A6 management overflow)
--
-- Adds staff.is_management. Management staff are included in UC-004 filtering
-- and UC-005 ranking (so an admin CAN assign them manually), but the roster
-- generator never auto-assigns them: when management are the only candidates
-- who pass all filters for a slot, the slot stays unfilled and a critical
-- "management deployment required" coverage_gap flag names them so the admin
-- can confirm the deployment deliberately.
--
-- Safe to re-run (idempotent).

ALTER TABLE staff
    ADD COLUMN IF NOT EXISTS is_management BOOLEAN NOT NULL DEFAULT FALSE;

-- Optional: seed the two demo management staff if they are not present yet.
-- (Matches docs/seed.sql; comment out if you manage staff manually.)
INSERT INTO staff (full_name, phone, email, role, employment_type, home_postal, is_management, status)
SELECT v.full_name, v.phone, v.email, v.role, v.employment_type, v.home_postal, TRUE, 'active'
FROM (VALUES
    ('Adrian Chia (Ops Manager)', '+65 9100 0021', 'adrian.chia@efar.sg', 'driver',    'full_time', '289610'),
    ('Dr. Elaine Foo (Med Dir)',  '+65 9100 0022', 'elaine.foo@efar.sg',  'paramedic', 'full_time', '259760')
) AS v(full_name, phone, email, role, employment_type, home_postal)
WHERE NOT EXISTS (SELECT 1 FROM staff s WHERE s.email = v.email);

-- Certifications so the management staff actually pass UC-004 Filter 5.
INSERT INTO staff_certifications (staff_id, cert_name, issued_date, expiry_date)
SELECT s.staff_id, c.cert_name, CURRENT_DATE - INTERVAL '1 year', CURRENT_DATE + INTERVAL '2 years'
FROM staff s
CROSS JOIN (VALUES ('MTS'), ('EAS')) AS c(cert_name)
WHERE s.is_management
  AND (c.cert_name = 'MTS' OR s.role IN ('driver', 'paramedic'))
  AND NOT EXISTS (
      SELECT 1 FROM staff_certifications sc
      WHERE sc.staff_id = s.staff_id AND sc.cert_name = c.cert_name
  );
