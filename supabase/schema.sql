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
