-- Ghost Rush V4 isolated schema. Safe to apply alongside other public tables.
create table if not exists public.ghost_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Ghost',
  rank_points integer not null default 0 check (rank_points >= 0),
  xp integer not null default 0 check (xp >= 0),
  coins integer not null default 420 check (coins >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ghost_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  player_name text not null default 'Ghost',
  daily_seed integer not null,
  game_mode text not null default 'speed_grid',
  elapsed_ms integer not null check (elapsed_ms between 0 and 120000),
  actions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ghost_challenges (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default substr(md5(random()::text || clock_timestamp()::text), 1, 10),
  run_id uuid not null references public.ghost_runs(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days')
);

alter table public.ghost_profiles add column if not exists xp integer not null default 0;
alter table public.ghost_runs add column if not exists game_mode text not null default 'speed_grid';
alter table public.ghost_runs drop constraint if exists ghost_runs_elapsed_ms_check;
alter table public.ghost_runs add constraint ghost_runs_elapsed_ms_check check (elapsed_ms between 0 and 120000);

create index if not exists ghost_runs_daily_leaderboard_idx on public.ghost_runs (daily_seed, elapsed_ms asc, created_at asc);
create index if not exists ghost_runs_mode_daily_idx on public.ghost_runs (game_mode, daily_seed, elapsed_ms asc);
create index if not exists ghost_runs_user_idx on public.ghost_runs (user_id, created_at desc);
create index if not exists ghost_challenges_run_id_idx on public.ghost_challenges (run_id);
create index if not exists ghost_challenges_created_by_idx on public.ghost_challenges (created_by);

alter table public.ghost_profiles enable row level security;
alter table public.ghost_runs enable row level security;
alter table public.ghost_challenges enable row level security;

revoke all on table public.ghost_profiles from anon, authenticated;
revoke all on table public.ghost_runs from anon, authenticated;
revoke all on table public.ghost_challenges from anon, authenticated;

grant select, insert, update on table public.ghost_profiles to authenticated;
grant select, insert on table public.ghost_runs to authenticated;
grant select, insert on table public.ghost_challenges to authenticated;

drop policy if exists "ghost profiles readable" on public.ghost_profiles;
create policy "ghost profiles readable" on public.ghost_profiles for select to authenticated using (true);
drop policy if exists "ghost profiles insert own" on public.ghost_profiles;
create policy "ghost profiles insert own" on public.ghost_profiles for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "ghost profiles update own" on public.ghost_profiles;
create policy "ghost profiles update own" on public.ghost_profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "ghost runs readable" on public.ghost_runs;
create policy "ghost runs readable" on public.ghost_runs for select to authenticated using (true);
drop policy if exists "ghost runs insert own" on public.ghost_runs;
create policy "ghost runs insert own" on public.ghost_runs for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "ghost challenges readable active" on public.ghost_challenges;
create policy "ghost challenges readable active" on public.ghost_challenges for select to authenticated using (expires_at > now());
drop policy if exists "ghost challenges insert own" on public.ghost_challenges;
create policy "ghost challenges insert own" on public.ghost_challenges for insert to authenticated with check ((select auth.uid()) = created_by);
