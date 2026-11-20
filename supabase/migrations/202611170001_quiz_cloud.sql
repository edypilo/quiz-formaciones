-- Quiz Formaciones · esquema inicial Supabase
-- Ejecutar en SQL Editor de un proyecto Supabase dedicado.
-- Las tablas y el bucket se crean sin permitir acceso anonimo.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.quiz_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  title text not null check (char_length(title) between 1 and 80),
  organization text not null default '' check (char_length(organization) <= 80),
  branding jsonb not null default '{}'::jsonb check (jsonb_typeof(branding) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create table if not exists public.quiz_quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 300),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  constraint quiz_quizzes_owner_project_fk
    foreign key (owner_id, project_id)
    references public.quiz_projects(owner_id, id)
    on delete set null (project_id)
);

create table if not exists public.quiz_game_results (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  quiz_id uuid,
  session_pin text check (session_pin is null or session_pin ~ '^[0-9]{6}$'),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now(),
  constraint quiz_game_results_owner_quiz_fk
    foreign key (owner_id, quiz_id)
    references public.quiz_quizzes(owner_id, id)
    on delete set null (quiz_id)
);

create or replace function public.quiz_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists quiz_projects_updated_at on public.quiz_projects;
create trigger quiz_projects_updated_at
before update on public.quiz_projects
for each row execute function public.quiz_touch_updated_at();

drop trigger if exists quiz_quizzes_updated_at on public.quiz_quizzes;
create trigger quiz_quizzes_updated_at
before update on public.quiz_quizzes
for each row execute function public.quiz_touch_updated_at();

create index if not exists quiz_projects_owner_id_idx on public.quiz_projects(owner_id);
create index if not exists quiz_quizzes_owner_id_idx on public.quiz_quizzes(owner_id);
create index if not exists quiz_quizzes_owner_project_idx on public.quiz_quizzes(owner_id, project_id);
create index if not exists quiz_game_results_owner_id_idx on public.quiz_game_results(owner_id);

alter table public.quiz_projects enable row level security;
alter table public.quiz_quizzes enable row level security;
alter table public.quiz_game_results enable row level security;

revoke all on public.quiz_projects, public.quiz_quizzes, public.quiz_game_results from anon;
grant select, insert, update, delete on public.quiz_projects, public.quiz_quizzes, public.quiz_game_results to authenticated;

-- Usuarios autenticados: acceso exclusivo a sus propios registros.
drop policy if exists quiz_projects_select_own on public.quiz_projects;
create policy quiz_projects_select_own on public.quiz_projects
for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists quiz_projects_insert_own on public.quiz_projects;
create policy quiz_projects_insert_own on public.quiz_projects
for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists quiz_projects_update_own on public.quiz_projects;
create policy quiz_projects_update_own on public.quiz_projects
for update to authenticated using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));
drop policy if exists quiz_projects_delete_own on public.quiz_projects;
create policy quiz_projects_delete_own on public.quiz_projects
for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists quiz_quizzes_select_own on public.quiz_quizzes;
create policy quiz_quizzes_select_own on public.quiz_quizzes
for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists quiz_quizzes_insert_own on public.quiz_quizzes;
create policy quiz_quizzes_insert_own on public.quiz_quizzes
for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists quiz_quizzes_update_own on public.quiz_quizzes;
create policy quiz_quizzes_update_own on public.quiz_quizzes
for update to authenticated using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));
drop policy if exists quiz_quizzes_delete_own on public.quiz_quizzes;
create policy quiz_quizzes_delete_own on public.quiz_quizzes
for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists quiz_game_results_select_own on public.quiz_game_results;
create policy quiz_game_results_select_own on public.quiz_game_results
for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists quiz_game_results_insert_own on public.quiz_game_results;
create policy quiz_game_results_insert_own on public.quiz_game_results
for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists quiz_game_results_update_own on public.quiz_game_results;
create policy quiz_game_results_update_own on public.quiz_game_results
for update to authenticated using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));
drop policy if exists quiz_game_results_delete_own on public.quiz_game_results;
create policy quiz_game_results_delete_own on public.quiz_game_results
for delete to authenticated using (owner_id = (select auth.uid()));

-- Bucket PRIVADO. No se expone contenido de proyectos o estudiantes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quiz-media', 'quiz-media', false, 52428800,
  array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml','video/mp4','video/webm']
)
on conflict (id) do nothing;

-- Cada fichero comienza con el ID UUID de usuario autenticado.
drop policy if exists quiz_media_select_own on storage.objects;
create policy quiz_media_select_own on storage.objects
for select to authenticated
using (bucket_id = 'quiz-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists quiz_media_insert_own on storage.objects;
create policy quiz_media_insert_own on storage.objects
for insert to authenticated
with check (bucket_id = 'quiz-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists quiz_media_update_own on storage.objects;
create policy quiz_media_update_own on storage.objects
for update to authenticated
using (bucket_id = 'quiz-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'quiz-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists quiz_media_delete_own on storage.objects;
create policy quiz_media_delete_own on storage.objects
for delete to authenticated
using (bucket_id = 'quiz-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Los recursos para participantes se servirán con URLs firmadas de corta duración
-- cuando el motor de salas distribuido esté implementado. No cambiar el bucket a public.
