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
- Availability and leave request tracking
- Automated roster generation with conflict detection (flags)
- Shift slot assignment with scoring
- Audit logging for all scheduling actions
- Role-based access (Admin / Ops Director)

---

## Architecture

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

### 2. Seed initial data (optional)

1. In the same SQL Editor, open `docs/seed.sql`, paste the contents, and click **Run**.

This inserts:
- 3 ambulances (AMB-001 MTS, AMB-002 EAS, AMB-003 both)
- 5 staff members with certifications
- Availability records for all staff for today and the next 7 days

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
