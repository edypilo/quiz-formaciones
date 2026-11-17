-- Quizzz! · fase cloud: salas del formador, todavía sin acceso público.
-- Ejecutar DESPUÉS de 202611170001_quiz_cloud.sql en Supabase SQL Editor.
-- No habilita anon, no crea RPC públicas ni expone preguntas o jugadores.

create table if not exists public.quiz_rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  quiz_id uuid not null,
  pin text not null check (pin ~ '^[0-9]{6}$'),
  status text not null default 'waiting'
    check (status in ('waiting', 'closed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '4 hours'),
  constraint quiz_rooms_own_quiz_fk
    foreign key (owner_id, quiz_id)
    references public.quiz_quizzes(owner_id, id)
    on delete cascade,
  constraint quiz_rooms_expiry_check check (expires_at > created_at)
);

create unique index if not exists quiz_rooms_waiting_pin_unique
  on public.quiz_rooms(pin) where status = 'waiting';
create unique index if not exists quiz_rooms_one_waiting_per_quiz
  on public.quiz_rooms(owner_id, quiz_id) where status = 'waiting';
create index if not exists quiz_rooms_owner_created_idx
  on public.quiz_rooms(owner_id, created_at desc);

alter table public.quiz_rooms enable row level security;
revoke all on public.quiz_rooms from anon;
grant select, insert on public.quiz_rooms to authenticated;
-- Sólo se puede modificar status, nunca PIN, dueño, caducidad o cuestionario.
grant update(status) on public.quiz_rooms to authenticated;

drop policy if exists quiz_rooms_select_own on public.quiz_rooms;
create policy quiz_rooms_select_own on public.quiz_rooms
for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists quiz_rooms_insert_own on public.quiz_rooms;
create policy quiz_rooms_insert_own on public.quiz_rooms
for insert to authenticated with check (
  owner_id = (select auth.uid())
  and status = 'waiting'
  and expires_at <= now() + interval '4 hours 5 minutes'
);

drop policy if exists quiz_rooms_update_own on public.quiz_rooms;
create policy quiz_rooms_update_own on public.quiz_rooms
for update to authenticated using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()) and status = 'closed');

-- No se autoriza DELETE todavía; los PIN se liberan cerrando la sala.
-- El acceso de los participantes se implementará en una migración posterior,
-- con controles de abuso y pruebas específicas de aislamiento.
