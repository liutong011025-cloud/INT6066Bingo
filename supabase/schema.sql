create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  student_key text not null,
  display_name text not null,
  answers jsonb not null default '{}'::jsonb,
  unique_count integer not null default 0,
  entry_count integer not null default 0,
  filled_count integer not null default 0,
  joined_at timestamptz not null default now(),
  last_active timestamptz not null default now(),
  unique (room_code, student_key)
);

create index if not exists students_room_code_idx on public.students (room_code);

alter table public.students enable row level security;
alter table public.students replica identity full;

drop policy if exists "students_select" on public.students;
drop policy if exists "students_insert" on public.students;
drop policy if exists "students_update" on public.students;
drop policy if exists "students_delete" on public.students;

create policy "students_select" on public.students
  for select using (true);
create policy "students_insert" on public.students
  for insert with check (true);
create policy "students_update" on public.students
  for update using (true) with check (true);
create policy "students_delete" on public.students
  for delete using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'students'
  ) then
    alter publication supabase_realtime add table public.students;
  end if;
end $$;

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_salt text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.teachers enable row level security;

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  blurb text not null default '',
  intro_title text not null default '',
  instructions jsonb not null default '[]'::jsonb,
  closing text not null default '',
  prompts jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.courses enable row level security;
alter table public.courses replica identity full;

drop policy if exists "courses_select" on public.courses;
drop policy if exists "courses_insert" on public.courses;
drop policy if exists "courses_update" on public.courses;
drop policy if exists "courses_delete" on public.courses;

create policy "courses_select" on public.courses for select using (true);
create policy "courses_insert" on public.courses for insert with check (true);
create policy "courses_update" on public.courses for update using (true) with check (true);
create policy "courses_delete" on public.courses for delete using (true);

create or replace function public.register_teacher(p_username text, p_salt text, p_hash text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  uname text := trim(p_username);
begin
  if uname is null or length(uname) < 2 then
    return json_build_object('ok', false, 'error', 'Username is too short.');
  end if;
  if p_salt is null or p_hash is null then
    return json_build_object('ok', false, 'error', 'Missing password.');
  end if;
  if exists (select 1 from public.teachers where lower(username) = lower(uname)) then
    return json_build_object('ok', false, 'error', 'Username already taken.');
  end if;
  insert into public.teachers (username, password_salt, password_hash)
  values (uname, p_salt, p_hash)
  returning id into new_id;
  return json_build_object('ok', true, 'id', new_id, 'username', uname);
end;
$$;

create or replace function public.get_teacher_salt(p_username text)
returns text
language sql
security definer
set search_path = public
as $$
  select password_salt from public.teachers where lower(username) = lower(trim(p_username));
$$;

create or replace function public.login_teacher(p_username text, p_hash text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.teachers%rowtype;
begin
  select * into rec from public.teachers
  where lower(username) = lower(trim(p_username)) and password_hash = p_hash;
  if not found then
    return json_build_object('ok', false, 'error', 'Incorrect username or password.');
  end if;
  return json_build_object('ok', true, 'id', rec.id, 'username', rec.username);
end;
$$;

create or replace function public.list_teacher_usernames()
returns json
language sql
security definer
set search_path = public
as $$
  select coalesce(json_agg(username order by username), '[]'::json) from public.teachers;
$$;

grant execute on function public.register_teacher(text, text, text) to anon, authenticated;
grant execute on function public.get_teacher_salt(text) to anon, authenticated;
grant execute on function public.list_teacher_usernames() to anon, authenticated;

grant select, insert, update, delete on table public.courses to anon, authenticated;
