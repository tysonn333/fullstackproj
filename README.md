# EFAR Ambulance Scheduling System

A full-stack web application for managing ambulance crew rosters, staff availability, leave requests, and shift assignments for the EFAR emergency ambulance service.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Local Development Setup](#local-development-setup)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Deployment](#deployment)
- [Public URLs](#public-urls)
- [Team](#team)

---

## Project Overview

The EFAR Ambulance Scheduling System replaces a manual, spreadsheet-based rostering process with an automated scheduling engine. Key features include:

- Staff and certification management
- Availability and leave request tracking, plus a direct **availability form**
- Automated roster generation with conflict detection (flags)
- Shift slot assignment with composite scoring **and driver + attendant crew pairing**
- **Roster timeline view** that aligns irregular shift times on a shared axis
- **Calendar integration** — export a roster or a staff member's shifts as `.ics`
- Audit logging for all scheduling actions
- Role-based access (Admin / Employee)

### Use-case coverage (UC-001 → UC-008)

| UC | What's implemented |
|----|--------------------|
| **UC-001** Roster view | Crew grid + timeline views, date navigation, weekend/PH banner, historical read-only mode, staff weekly-schedule drill-down, exceptions sidebar, and **A4 filters** (service type / role) that grey out non-matching rows |
| **UC-002** Auto-generate | **Job-feed-driven generation**: call-centre CSV import (`POST /jobs/import` + Import Jobs UI), peak-concurrency demand → fleet size, **defer when no job list** (`NO_JOB_LIST` + skeleton fallback), **weekend/PH 2-ambulance baseline**, publish & lock |
| **UC-003** Availability & leave | Leave request/approve/reject with duplicate-overlap blocking; availability form (full/half-day, date range); **approving half-day leave raises `half_day_gap` flags**; leave conflicting with a published roster raises **critical `coverage_gap` flags**; part-timer **WhatsApp webhook** with half-day gap detection (Chad) |
| **UC-004** Filter (Guan Hee) | Five ordered filters with hard/soft semantics, real cert-expiry validation, per-candidate `filter_trace` |
| **UC-005** Rank & assign (Guan Hee) | 6-component composite score (fairness/rest/proximity/cert-fit/preference/continuity), SG postal-district proximity, driver+attendant pairing with proximity walk-down, **buddy preference honoured within top-3** |
| **UC-006** Last-minute change | Drop → ranked replacements → confirm swap; **absent-all-day batch drop** (every shift cancelled + flagged); filling a slot **auto-resolves** its gap flags |
| **UC-007** Staff profiles | CRUD + certifications; **shift-time & buddy preferences UI**; **expiring-certs alert banner** (30-day window; expired certs are already excluded by UC-004 Filter 5) |
| **UC-008** Exceptions | Severity-sorted panel, resolve/dismiss with audit trail, **bulk-action mode**, **CSV export**, `auto_resolved` status surfaced, **browser push-notification fallback** for new critical flags (Chad) |

### Scheduling engine highlights (UC-004 / UC-005 — Guan Hee)

- **UC-004 filter pipeline** runs five ordered checks — availability → rest hours
  → daily hours → consecutive days (soft flag) → certification — and now
  validates a **real, unexpired certification** for the slot's service type.
  Every candidate carries a `filter_trace` showing exactly which checks passed
  or failed.
- **UC-005 ranking** scores each candidate on a weighted composite of *fairness,
  rest, proximity, certification fit, preference,* and *continuity*. Proximity is
  derived from Singapore postal districts (`services/scheduling/proximity.ts`).
- **UC-005 crew pairing** (`pairCrew`) pairs the best driver with the best
  attendant, walking the ranked pools for a **proximity-compatible** pair and
  raising a proximity flag only when no compatible pair exists.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Browser                         │
│              React + TypeScript (Vite)              │
│                  frontend/                          │
└──────────────────────┬──────────────────────────────┘
                       │ REST (HTTP/JSON)
                       │ VITE_API_URL
                       ▼
┌─────────────────────────────────────────────────────┐
│              Node.js / Express API                  │
│               TypeScript + Supabase SDK             │
│                  backend/                           │
└──────────────────────┬──────────────────────────────┘
                       │ Supabase JS Client
                       │ (service-role key)
                       ▼
┌─────────────────────────────────────────────────────┐
│                   Supabase                          │
│          PostgreSQL  |  Auth  |  Storage            │
└─────────────────────────────────────────────────────┘
```

---

## Local Development Setup

### Prerequisites

- Node.js >= 20
- npm >= 9
- A [Supabase](https://supabase.com) project (free tier is fine)

### 1. Clone the repository

```bash
git clone <repo-url>
cd fullstackproj
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in all values (see [Environment Variables](#environment-variables) below).

### 3. Start the backend

```bash
cd backend
npm install
npm run dev
```

The API will be available at `http://localhost:3000`.

### 4. Start the frontend

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

The React app will be available at `http://localhost:5173`.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in each value before running the project.

| Variable                 | Location        | Description                                              |
|--------------------------|-----------------|----------------------------------------------------------|
| `SUPABASE_URL`           | Backend         | Supabase project URL (Settings > API)                    |
| `SUPABASE_SERVICE_KEY`   | Backend         | Service-role secret key – never expose to the browser    |
| `SUPABASE_ANON_KEY`      | Backend         | Anon/public key for server-side auth flows               |
| `VITE_SUPABASE_URL`      | Frontend (Vite) | Same Supabase project URL, exposed to the browser        |
| `VITE_SUPABASE_ANON_KEY` | Frontend (Vite) | Anon/public key for client-side auth                     |
| `VITE_API_URL`           | Frontend (Vite) | Base URL of the backend API (`http://localhost:3000`)    |
| `PORT`                   | Backend         | Port the Express server listens on (default `3000`)      |
| `FRONTEND_URL`           | Backend         | Frontend origin used for CORS (`http://localhost:5173`)  |
| `NODE_ENV`               | Backend         | `development` locally; `production` on Render            |

---

## Database Setup

### 1. Run the schema

1. Open your Supabase project dashboard.
2. Navigate to **SQL Editor**.
3. Open `docs/schema.sql`, paste the contents, and click **Run**.

This creates all tables, constraints, and indexes.

> **Created your database from an older schema.sql?** Run
> `docs/migrations/2026-07-05-allow-overnight-shifts.sql` in the SQL Editor.
> The original schema rejected overnight shift slots (18:00 → 06:00), which
> made roster generation fail on every call.
>
> **Also run** `docs/migrations/2026-07-12-staff-preferences.sql` to add the
> `staff_preferences` table used by the UC-005 preference score. The ranking
> engine tolerates its absence, but the preference component only varies once
> the table exists and is populated (the seed script fills it in).
>
> **Roster generation assigns nobody?** Your certifications are probably expired
> or missing — UC-004 Filter 5 requires a real, unexpired cert. Run
> `docs/migrations/2026-07-14-renew-certifications.sql`. (Staff created through
> the UI now get role-implied certifications automatically.)
>
> **Everyone shows the same distance from base (or "distance unknown")?** Your
> staff rows are missing valid Singapore postal codes, so UC-005 proximity can't
> differentiate them. Run `docs/migrations/2026-07-16-backfill-home-postals.sql`
> to assign every staff member a realistic postal code spread across ~20
> districts island-wide (deterministic by staff ID — safe to re-run).

### 2. Seed initial data (optional)

1. In the same SQL Editor, open `docs/seed.sql`, paste the contents, and click **Run**.

This inserts:
- 3 ambulances (AMB-001 MTS, AMB-002 EAS, AMB-003 both)
- 20 staff members with certifications (12 EAS-capable drivers/paramedics +
  8 MTS-only medics/EMTs) — enough to fully crew day + night shifts across all
  three ambulances with a small buffer. Home postal codes span several Singapore
  districts so UC-005 proximity scoring and crew pairing have real signal.
- Availability records for all staff for today and the next 7 days
- Staff shift-time preferences (early riser / late shift) for UC-005 scoring

The seed script is safe to re-run: it resets all operational data first (but
leaves your `profiles` / login accounts intact).

### 3. Roles & access

Every login account has a role in the `profiles` table:

| Role | Can do |
|------|--------|
| `admin` | Everything: generate/publish rosters, manage staff & certifications, approve/reject leave, resolve flags, reassign shifts, export |
| `employee` | Self-service only: view the roster, submit **their own** availability, and request **their own** leave |

New accounts default to `employee` (least privilege). To make someone an admin,
set their `profiles.role` to `admin` in the Supabase dashboard. Employee accounts
are linked to a staff record automatically when their login email matches a staff
email (or set `profiles.staff_id` manually).

> **Upgrading an existing database?** If your `profiles` table still uses the old
> `admin`/`ops_director` roles, run
> `docs/migrations/2026-07-09-roles-and-staff-link.sql` (edit the admin email
> inside it first) to switch to the `admin`/`employee` model and add the staff link.
>
> **Pointed the app at a different / parallel database?** (e.g. an older
> `admin`/`ops_director` database with no `profiles.staff_id` and no
> `staff_preferences` table — logins work but writes 403/500 and generation
> assigns nobody.) Run the single, idempotent
> **`docs/migrations/2026-07-15-align-database.sql`** in the SQL Editor once. It
> bundles the role/staff-link, `staff_preferences`, and certification
> backfill/renewal migrations so the current backend runs cleanly against that
> database. Edit the admin email inside it if yours isn't `admin@efar.sg`.

---

## Calendar Integration

Rosters and individual schedules can be exported as iCalendar (`.ics`) files and
imported into Google Calendar, Apple Calendar, or Outlook.

| Endpoint | Returns |
|----------|---------|
| `GET /api/v1/roster/:id/calendar.ics` | Every crewed shift in a roster |
| `GET /api/v1/staff/:id/schedule.ics`  | One staff member's assigned shifts |

In the UI, use **Add to Calendar** on the Roster View (whole roster) or inside a
staff member's detail modal (their shifts). Both require a logged-in session; the
frontend fetches the file with the auth token and downloads it in the browser.

---

## Deployment

### Frontend – Vercel

1. Push the repository to GitHub.
2. In [Vercel](https://vercel.com), create a new project and import the repo.
3. Set the **Root Directory** to `frontend`.
4. Add the following environment variables in Vercel's project settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_API_URL` (set to your Render backend URL once deployed)
5. Deploy.

### Backend – Render

1. In [Render](https://render.com), create a new **Web Service**.
2. Connect your GitHub repo and set the **Root Directory** to `backend`.
3. Build command: `npm install && npm run build`
4. Start command: `npm start`
5. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `SUPABASE_ANON_KEY`
   - `FRONTEND_URL` (set to your Vercel frontend URL)
   - `PORT` (Render injects this automatically; you may omit it)
   - `NODE_ENV=production`
6. Deploy.

> **Render Free Tier – Cold Start Warning**
> The free tier spins down the service after ~15 minutes of inactivity.
> The first request after a period of inactivity can take **30–60 seconds** to respond.
> Before any demo or graded presentation, open the backend health-check URL
> (e.g. `https://<your-render-app>.onrender.com/health`) in your browser at least
> one minute in advance to wake the service up.

---

## Public URLs

| Service  | URL                                |
|----------|------------------------------------|
| Frontend | TBD – fill after Vercel deployment |
| Backend  | TBD – fill after Render deployment |

---

## Team

| Member   | Use Cases | Area of Ownership                                          |
|----------|-----------|------------------------------------------------------------|
| Guan Hee | UC-004, UC-005 | Scheduling engine — eligibility filter & ranking/assignment |
| Justin   | UC-002, UC-008 | Roster generation & exceptions/flags panel                 |
| Jadon    | UC-001, UC-003 | Roster view & availability/leave management                |
| Jayden   | UC-006, UC-007 | Last-minute change & staff profiles/certifications         |
| Chad     | UC-003, UC-008 | Part-timer WhatsApp flows, audit trail, CSV export, bulk actions |

---

## CI/CD

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs automatically on every pull request to `main`. It runs two parallel jobs:

- **backend-test** – installs dependencies, builds TypeScript, runs the test suite
- **frontend-lint** – installs dependencies, runs the Vite production build

All checks must pass before a PR can be merged.
