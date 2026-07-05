-- =============================================================
-- EFAR Ambulance Scheduling System – Supabase Database Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- =============================================================

-- profiles
CREATE TABLE profiles (
    id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name       VARCHAR(120) NOT NULL,
    role       VARCHAR(20) NOT NULL DEFAULT 'admin'
               CHECK (role IN ('admin', 'ops_director')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- staff
CREATE TABLE staff (
    staff_id        SERIAL PRIMARY KEY,
    full_name       VARCHAR(120) NOT NULL,
    phone           VARCHAR(30),
    email           VARCHAR(160),
    role            VARCHAR(20) NOT NULL
                    CHECK (role IN ('driver', 'medic', 'emt', 'paramedic')),
    employment_type VARCHAR(20) NOT NULL
                    CHECK (employment_type IN ('full_time', 'part_time')),
    home_postal     VARCHAR(10),
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- staff_certifications
CREATE TABLE staff_certifications (
    cert_id     SERIAL PRIMARY KEY,
    staff_id    INT NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
    cert_name   VARCHAR(40) NOT NULL,
    issued_date DATE,
    expiry_date DATE,
    UNIQUE (staff_id, cert_name)
);

-- availability
CREATE TABLE availability (
    availability_id SERIAL PRIMARY KEY,
    staff_id        INT NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
    work_date       DATE NOT NULL,
    is_available    BOOLEAN NOT NULL DEFAULT TRUE,
    half_day        VARCHAR(10) DEFAULT NULL
                    CHECK (half_day IN ('am', 'pm') OR half_day IS NULL),
    source          VARCHAR(20) NOT NULL DEFAULT 'app'
                    CHECK (source IN ('app', 'whatsapp')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (staff_id, work_date)
);

-- leave_requests
CREATE TABLE leave_requests (
    leave_id    SERIAL PRIMARY KEY,
    staff_id    INT NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    leave_type  VARCHAR(15) NOT NULL
                CHECK (leave_type IN ('full_day', 'half_am', 'half_pm')),
    reason      TEXT,
    status      VARCHAR(15) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_by UUID REFERENCES profiles(id),
    approved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);

-- ambulances
CREATE TABLE ambulances (
    ambulance_id SERIAL PRIMARY KEY,
    registration VARCHAR(20) UNIQUE NOT NULL,
    service_type VARCHAR(10) NOT NULL
                 CHECK (service_type IN ('MTS', 'EAS', 'both')),
    status       VARCHAR(20) NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'maintenance', 'retired'))
);

-- jobs
CREATE TABLE jobs (
    job_id       SERIAL PRIMARY KEY,
    job_date     DATE NOT NULL,
    pickup_time  TIME NOT NULL,
    service_type VARCHAR(10) NOT NULL CHECK (service_type IN ('MTS', 'EAS')),
    pickup_loc   VARCHAR(160),
    dropoff_loc  VARCHAR(160),
    source       VARCHAR(20) NOT NULL DEFAULT 'call_centre',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- rosters
CREATE TABLE rosters (
    roster_id    SERIAL PRIMARY KEY,
    roster_date  DATE UNIQUE NOT NULL,
    status       VARCHAR(15) NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'published', 'locked')),
    generated_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES profiles(id)
);

-- shift_slots
CREATE TABLE shift_slots (
    slot_id       SERIAL PRIMARY KEY,
    roster_id     INT NOT NULL REFERENCES rosters(roster_id) ON DELETE CASCADE,
    ambulance_id  INT REFERENCES ambulances(ambulance_id),
    start_time    TIME NOT NULL,
    end_time      TIME NOT NULL,
    service_type  VARCHAR(10) NOT NULL CHECK (service_type IN ('MTS', 'EAS')),
    crew_position VARCHAR(15) NOT NULL
                  CHECK (crew_position IN ('driver', 'attendant')),
    -- end_time <= start_time means the shift crosses midnight (e.g. the
    -- night shift 18:00 → 06:00); only zero-length shifts are invalid.
    CHECK (end_time <> start_time)
);

-- assignments
CREATE TABLE assignments (
    assignment_id SERIAL PRIMARY KEY,
    slot_id       INT NOT NULL REFERENCES shift_slots(slot_id) ON DELETE CASCADE,
    staff_id      INT NOT NULL REFERENCES staff(staff_id),
    score         NUMERIC(5, 2),
    status        VARCHAR(15) NOT NULL DEFAULT 'assigned'
                  CHECK (status IN ('assigned', 'confirmed', 'swapped', 'cancelled')),
    assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (slot_id)
);

-- flags
CREATE TABLE flags (
    flag_id     SERIAL PRIMARY KEY,
    roster_id   INT REFERENCES rosters(roster_id) ON DELETE CASCADE,
    slot_id     INT REFERENCES shift_slots(slot_id) ON DELETE CASCADE,
    staff_id    INT REFERENCES staff(staff_id),
    flag_type   VARCHAR(30) NOT NULL
                CHECK (flag_type IN ('coverage_gap', 'consecutive_days',
                       'half_day_gap', 'cert_mismatch', 'rest_violation', 'other')),
    severity    VARCHAR(10) NOT NULL DEFAULT 'warning'
                CHECK (severity IN ('critical', 'warning', 'info')),
    message     TEXT NOT NULL,
    status      VARCHAR(15) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'resolved', 'dismissed', 'auto_resolved')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES profiles(id)
);

-- audit_log
CREATE TABLE audit_log (
    log_id      SERIAL PRIMARY KEY,
    entity_type VARCHAR(30) NOT NULL,
    entity_id   INT,
    action      VARCHAR(40) NOT NULL,
    actor_id    UUID REFERENCES profiles(id),
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- Indexes
-- =============================================================
CREATE INDEX idx_avail_date        ON availability(work_date);
CREATE INDEX idx_leave_staff_date  ON leave_requests(staff_id, start_date, end_date);
CREATE INDEX idx_slots_roster      ON shift_slots(roster_id);
CREATE INDEX idx_flags_status      ON flags(status, severity);
CREATE INDEX idx_jobs_date         ON jobs(job_date);
