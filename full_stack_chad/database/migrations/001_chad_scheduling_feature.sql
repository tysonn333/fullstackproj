create extension if not exists pgcrypto;

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  staff_code text not null unique,
  name text not null,
  phone text,
  employment_type text not null check (employment_type in ('full_time', 'part_time')),
  role text not null check (role in ('Driver', 'Medic', 'EMT', 'Paramedic')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.efar_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'operations', 'staff')),
  created_at timestamptz not null default now()
);

create table if not exists public.part_timer_availability (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_members(id),
  available_date date not null,
  period text not null check (period in ('AM', 'PM', 'FULL_DAY', 'CUSTOM')),
  start_time time not null,
  end_time time not null,
  note text not null default '',
  coverage_gap boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_availability_time check (start_time < end_time)
);

create table if not exists public.scheduling_exceptions (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  severity text not null check (severity in ('critical', 'warning', 'informational')),
  shift_date date not null,
  shift_start time not null,
  shift_end time not null,
  staff_id uuid references public.staff_members(id),
  summary text not null,
  recommendation text not null,
  status text not null default 'active' check (status in ('active', 'deferred', 'resolved', 'dismissed', 'rejected')),
  resolution_note text,
  deferred_until date,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_exception_time check (shift_start < shift_end)
);

create table if not exists public.exception_audit_log (
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references public.scheduling_exceptions(id) on delete cascade,
  action text not null,
  previous_status text not null,
  new_status text not null,
  note text,
  actor_email text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_availability_date on public.part_timer_availability(available_date);
create index if not exists idx_availability_staff_date on public.part_timer_availability(staff_id, available_date);
create index if not exists idx_exceptions_status_priority on public.scheduling_exceptions(status, severity, shift_date, shift_start);
create index if not exists idx_exception_audit on public.exception_audit_log(exception_id, created_at desc);

alter table public.staff_members enable row level security;
alter table public.efar_user_roles enable row level security;
alter table public.part_timer_availability enable row level security;
alter table public.scheduling_exceptions enable row level security;
alter table public.exception_audit_log enable row level security;

create or replace function public.has_scheduling_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.efar_user_roles
    where user_id = auth.uid()
      and role in ('admin', 'operations')
  );
$$;

create policy "operations can read staff"
on public.staff_members for select
to authenticated
using (public.has_scheduling_access());

create policy "operations can manage availability"
on public.part_timer_availability for all
to authenticated
using (public.has_scheduling_access())
with check (public.has_scheduling_access());

create policy "operations can manage exceptions"
on public.scheduling_exceptions for all
to authenticated
using (public.has_scheduling_access())
with check (public.has_scheduling_access());

create policy "operations can read audit"
on public.exception_audit_log for select
to authenticated
using (public.has_scheduling_access());
