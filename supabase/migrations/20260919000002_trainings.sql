-- Trainings saved from the builder, one row each, private to their owner.
-- `draft` is the builder's TrainingDraft as JSON; `version` is the storage version it was written
-- with (see STORAGE_VERSION in useCustomTrainings), so a later format can still read old rows.

create table public.trainings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  draft jsonb not null check (jsonb_typeof(draft) = 'object' and pg_column_size(draft) <= 262144),
  version integer not null default 1,
  saved_at timestamptz not null default now()
);

create index trainings_user_saved_idx on public.trainings (user_id, saved_at desc);

alter table public.trainings enable row level security;

create policy "trainings: owner reads" on public.trainings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "trainings: owner inserts" on public.trainings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "trainings: owner updates" on public.trainings
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "trainings: owner deletes" on public.trainings
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.trainings from anon;
