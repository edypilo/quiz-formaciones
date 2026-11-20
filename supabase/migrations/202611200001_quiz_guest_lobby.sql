-- Quizzz! · Entrada de invitados a sala de espera (Preview).
-- Ejecutar DESPUÉS de 202611170002_quiz_rooms.sql.
-- Los invitados no obtienen acceso a las tablas de preguntas, resultados ni medios.

alter table public.quiz_rooms
  add column if not exists is_joinable boolean not null default false;

create table if not exists public.quiz_room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.quiz_rooms(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 32),
  token_digest bytea not null unique,
  joined_at timestamptz not null default now()
);
create unique index if not exists quiz_room_players_unique_name
  on public.quiz_room_players (room_id, lower(nickname));
create index if not exists quiz_room_players_by_room
  on public.quiz_room_players (room_id, joined_at);

alter table public.quiz_room_players enable row level security;
revoke all on public.quiz_room_players from anon, authenticated;
grant select (id, room_id, owner_id, nickname, joined_at)
  on public.quiz_room_players to authenticated;
drop policy if exists quiz_room_players_owner_select on public.quiz_room_players;
create policy quiz_room_players_owner_select on public.quiz_room_players
  for select to authenticated using (owner_id = (select auth.uid()));

-- Un contador privado por minuto/día reduce el abuso en el prototipo.
-- Requiere protección adicional antes de publicación masiva.
create table if not exists public.quiz_guest_quotas (
  bucket text primary key,
  attempts integer not null default 0 check (attempts >= 0)
);
revoke all on public.quiz_guest_quotas from anon, authenticated;

-- El formador abre explícitamente su sala. No es posible reabrir una cerrada.
create or replace function public.quiz_host_open_room(p_room_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_rows integer;
begin
  if (select auth.uid()) is null then return false; end if;
  update public.quiz_rooms
     set is_joinable = true
   where id = p_room_id
     and owner_id = (select auth.uid())
     and status = 'waiting'
     and expires_at > now();
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;
revoke execute on function public.quiz_host_open_room(uuid) from public, anon, authenticated;
grant execute on function public.quiz_host_open_room(uuid) to authenticated;

-- Solo devuelve un token secreto para el jugador; se almacena el hash.
-- No devuelve preguntas ni datos privados del anfitrión.
create or replace function public.quiz_guest_join(p_pin text, p_nickname text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.quiz_rooms%rowtype;
  v_name text;
  v_count integer;
  v_quota integer;
  v_token uuid;
  v_player uuid;
begin
  -- Cuotas globales transaccionales. Limitan los intentos incluso con PIN erróneo.
  insert into public.quiz_guest_quotas(bucket, attempts)
    values ('minute:' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MI'), 1)
  on conflict(bucket) do update
    set attempts = public.quiz_guest_quotas.attempts + 1
    where public.quiz_guest_quotas.attempts < 300
  returning attempts into v_quota;
  if v_quota is null then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  v_quota := null;
  insert into public.quiz_guest_quotas(bucket, attempts)
    values ('day:' || to_char(now() at time zone 'UTC', 'YYYYMMDD'), 1)
  on conflict(bucket) do update
    set attempts = public.quiz_guest_quotas.attempts + 1
    where public.quiz_guest_quotas.attempts < 3000
  returning attempts into v_quota;
  if v_quota is null then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  v_name := btrim(coalesce(p_nickname, ''));
  if p_pin is null or p_pin !~ '^[0-9]{6}$'
     or char_length(v_name) < 2 or char_length(v_name) > 32
     or v_name ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'error', 'invalid_data');
  end if;
  select * into v_room
    from public.quiz_rooms
   where pin = p_pin and is_joinable = true
     and status = 'waiting' and expires_at > now()
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'room_unavailable');
  end if;
  select count(*) into v_count
    from public.quiz_room_players where room_id = v_room.id;
  if v_count >= 60 then
    return jsonb_build_object('ok', false, 'error', 'room_full');
  end if;
  if exists(select 1 from public.quiz_room_players
    where room_id = v_room.id and lower(nickname) = lower(v_name)) then
    return jsonb_build_object('ok', false, 'error', 'name_taken');
  end if;
  v_token := gen_random_uuid();
  insert into public.quiz_room_players(room_id, owner_id, nickname, token_digest)
    values(v_room.id, v_room.owner_id, v_name,
      extensions.digest(v_token::text, 'sha256'))
    returning id into v_player;
  return jsonb_build_object(
    'ok', true, 'player_id', v_player, 'token', v_token,
    'pin', v_room.pin, 'nickname', v_name, 'expires_at', v_room.expires_at
  );
end;
$$;
revoke execute on function public.quiz_guest_join(text, text) from public, anon, authenticated;
grant execute on function public.quiz_guest_join(text, text) to anon, authenticated;

create or replace function public.quiz_guest_status(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_room public.quiz_rooms%rowtype; v_nickname text; v_count integer;
begin
  select r.*, p.nickname into v_room, v_nickname
    from public.quiz_room_players p
    join public.quiz_rooms r on r.id = p.room_id
   where p.token_digest = extensions.digest(p_token::text, 'sha256');
  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  select count(*) into v_count
    from public.quiz_room_players where room_id = v_room.id;
  return jsonb_build_object('ok', true, 'pin', v_room.pin,
    'nickname', v_nickname,
    'room_status', case when v_room.status = 'waiting' and
      v_room.expires_at > now() then 'waiting' else 'closed' end,
    'player_count', v_count);
end;
$$;
revoke execute on function public.quiz_guest_status(uuid) from public, anon, authenticated;
grant execute on function public.quiz_guest_status(uuid) to anon, authenticated;

-- Solo cierra la sesión de invitado que presenta su propio token.
create or replace function public.quiz_guest_leave(p_token uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  delete from public.quiz_room_players
   where token_digest = extensions.digest(p_token::text, 'sha256');
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;
revoke execute on function public.quiz_guest_leave(uuid) from public, anon, authenticated;
grant execute on function public.quiz_guest_leave(uuid) to anon, authenticated;

-- Estas funciones son el ÚNICO acceso de invitados a la BD.
-- No otorgar acceso directo a public.quiz_rooms, public.quiz_quizzes
-- ni public.quiz_room_players al rol anon.
