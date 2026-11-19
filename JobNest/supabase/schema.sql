-- Run in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company text not null,
  location text,
  workplace text not null default 'Not specified'
    check (workplace in ('Remote', 'Hybrid', 'On-site', 'Not specified')),
  employment_type text not null default 'Not specified'
    check (employment_type in ('Full-time', 'Part-time', 'Internship', 'Contract', 'Not specified')),
  experience_level text not null default 'Not specified'
    check (experience_level in ('Entry level', '1–3 years', '3+ years', 'Not specified')),
  salary_label text,
  tags text[] not null default '{}',
  description text,
  apply_url text,
  posted_at timestamptz not null default now(),
  source_name text,
  source_job_id text,
  last_seen_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (source_name, source_job_id)
);

alter table public.jobs add column if not exists last_seen_at timestamptz;

alter table public.jobs drop constraint if exists jobs_workplace_check;
alter table public.jobs add constraint jobs_workplace_check
  check (workplace in ('Remote', 'Hybrid', 'On-site', 'Not specified'));
alter table public.jobs drop constraint if exists jobs_employment_type_check;
alter table public.jobs add constraint jobs_employment_type_check
  check (employment_type in ('Full-time', 'Part-time', 'Internship', 'Contract', 'Not specified'));
alter table public.jobs drop constraint if exists jobs_experience_level_check;
alter table public.jobs add constraint jobs_experience_level_check
  check (experience_level in ('Entry level', '1–3 years', '3+ years', 'Not specified'));
alter table public.jobs alter column workplace set default 'Not specified';
alter table public.jobs alter column employment_type set default 'Not specified';
alter table public.jobs alter column experience_level set default 'Not specified';

create index if not exists jobs_active_posted_at_idx
  on public.jobs (is_active, posted_at desc);

alter table public.jobs enable row level security;
drop policy if exists "Anyone can read active jobs" on public.jobs;
create policy "Anyone can read active jobs"
  on public.jobs for select using (is_active = true);

create table if not exists public.saved_jobs (
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id text not null,
  saved_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

alter table public.saved_jobs enable row level security;
drop policy if exists "Users can read their saved jobs" on public.saved_jobs;
create policy "Users can read their saved jobs"
  on public.saved_jobs for select using (auth.uid() = user_id);
drop policy if exists "Users can save their own jobs" on public.saved_jobs;
create policy "Users can save their own jobs"
  on public.saved_jobs for insert with check (auth.uid() = user_id);
drop policy if exists "Users can remove their own saved jobs" on public.saved_jobs;
create policy "Users can remove their own saved jobs"
  on public.saved_jobs for delete using (auth.uid() = user_id);

grant select, insert, delete on public.saved_jobs to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'jobs'
  ) then
    execute 'alter publication supabase_realtime add table public.jobs';
  end if;
end
$$;

update public.jobs set is_active = false where source_name = 'jobnest-demo';
