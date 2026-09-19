-- User profiles: the kind of user (student / teacher), a photo and a few words about oneself.
-- One row per auth user, created by a trigger on sign-up; only its owner can read or change it.

create type public.user_role as enum ('student', 'teacher');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'student',
  bio text not null default '' check (char_length(bio) <= 500),
  -- Path of the photo in the `avatars` bucket; it has to lie in the owner's own folder.
  avatar_path text check (avatar_path is null or (char_length(avatar_path) <= 200 and avatar_path like id::text || '/%')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: owner reads" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: owner inserts" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles: owner updates" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
-- No delete policy: a profile goes away with its account (on delete cascade).

revoke all on public.profiles from anon;

create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- A profile for every new account. The role the sign-up form asked for comes in user metadata,
-- which the user can write to: it only picks the starting value here and grants nothing.
create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'role' = 'teacher'
      then 'teacher'::public.user_role
      else 'student'::public.user_role
    end
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts that already exist get a profile too.
insert into public.profiles (id) select id from auth.users on conflict do nothing;

-- Photos. The bucket is public, so a photo is shown by its address; the paths carry the owner's id
-- and a fresh name per upload. Only the owner can list, add, replace or delete files in the folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "avatars: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner replaces" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
