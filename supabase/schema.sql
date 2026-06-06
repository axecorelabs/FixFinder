create extension if not exists "pgcrypto";

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  customer_telegram_id text not null,
  customer_name text not null,
  customer_phone text not null,
  location_text text not null,
  customer_postal_code text,
  issue_text text not null,
  ai_category text not null check (ai_category in ('hvac', 'plumbing', 'electrical', 'general')),
  ai_summary text,
  ai_confidence numeric(3,2) not null default 0,
  status text not null check (status in ('created', 'collecting_details', 'matching', 'offered', 'accepted', 'in_progress', 'completed', 'canceled')),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_inferences (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  model_name text not null,
  parsed_json jsonb not null,
  confidence numeric(3,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.artisans (
  id uuid primary key default gen_random_uuid(),
  telegram_id text not null unique,
  name text not null,
  phone text not null,
  skill_type text not null check (skill_type in ('hvac', 'plumbing', 'electrical', 'general')),
  service_area text not null,
  postal_code text not null,
  rating_avg numeric(3,2) not null default 4,
  acceptance_rate numeric(3,2) not null default 0.8,
  available_now boolean not null default true,
  active_status boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.job_offers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  artisan_id uuid not null references public.artisans(id) on delete cascade,
  offer_status text not null default 'pending' check (offer_status in ('pending', 'accepted', 'rejected', 'expired')),
  offered_at timestamptz not null default now(),
  responded_at timestamptz
);

insert into storage.buckets (id, name, public)
values ('job-media', 'job-media', false)
on conflict (id) do nothing;

-- Open for prototype usage. Tighten with auth/RLS in production.
create policy "job-media prototype read"
on storage.objects
for select
using (bucket_id = 'job-media');

create policy "job-media prototype write"
on storage.objects
for insert
with check (bucket_id = 'job-media');
