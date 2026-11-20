begin;
-- Quizzz! · avisos Realtime para jugadores sin cuenta Supabase.
-- Ejecutar después de 202611200005_quiz_realtime_host.sql.
-- Canal público con identificador aleatorio NO enumerable, derivado por SHA-256
-- del secreto de invitación de sala. Jamás se difunden preguntas, respuestas,
-- puntos, apodos, tokens o el secreto original. El mensaje no es autoridad:
-- el móvil consulta siempre la RPC privada con SU token.
-- Si Supabase deshabilita los canales públicos, sigue el polling de respaldo.

create or replace function public.quiz_guest_stream(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_secret uuid;
  v_status text;
  v_expires timestamptz;
begin
  if p_token is null then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;
  select r.join_secret, r.status, r.expires_at
    into v_secret, v_status, v_expires
  from public.quiz_room_players p
  join public.quiz_rooms r on r.id = p.room_id
  where p.token_digest = extensions.digest(p_token::text, 'sha256');
  if not found then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;
  if v_status <> 'waiting' or v_expires <= now() then
    return jsonb_build_object('ok',false,'error','room_closed');
  end if;
  return jsonb_build_object('ok',true,
    'topic', 'quizzz:guest:' ||
       encode(extensions.digest(v_secret::text || ':guest-events:v1','sha256'),'hex'));
end;
$$;
revoke execute on function public.quiz_guest_stream(uuid) from public, anon, authenticated;
grant execute on function public.quiz_guest_stream(uuid) to anon, authenticated;

-- Cambios de fase, sin revelar nada sobre la pregunta ni respuestas.
create or replace function public.quizzz_notify_guest_phase()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (old.game_phase, old.game_question_index, old.status, old.is_joinable)
     is distinct from
     (new.game_phase, new.game_question_index, new.status, new.is_joinable) then
    perform realtime.send(
      jsonb_build_object('kind','phase'),
      'changed',
      'quizzz:guest:' ||
        encode(extensions.digest(new.join_secret::text || ':guest-events:v1','sha256'),'hex'),
      false
    );
  end if;
  return new;
end;
$$;
revoke execute on function public.quizzz_notify_guest_phase() from public, anon, authenticated;
drop trigger if exists quizzz_rt_guest_phase on public.quiz_rooms;
create trigger quizzz_rt_guest_phase
after update of game_phase, game_question_index, status, is_joinable on public.quiz_rooms
for each row execute function public.quizzz_notify_guest_phase();

-- Notificar a los jugadores el cambio de número de participantes.
create or replace function public.quizzz_notify_guest_players()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_room_id uuid;
  v_secret uuid;
begin
  if tg_op = 'DELETE' then v_room_id := old.room_id;
  else v_room_id := new.room_id; end if;
  select r.join_secret into v_secret
    from public.quiz_rooms r where r.id = v_room_id;
  if v_secret is not null then
    perform realtime.send(
      jsonb_build_object('kind','participant'),
      'changed',
      'quizzz:guest:' ||
        encode(extensions.digest(v_secret::text || ':guest-events:v1','sha256'),'hex'),
      false
    );
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke execute on function public.quizzz_notify_guest_players() from public, anon, authenticated;
drop trigger if exists quizzz_rt_guest_players on public.quiz_room_players;
create trigger quizzz_rt_guest_players
after insert or delete on public.quiz_room_players
for each row execute function public.quizzz_notify_guest_players();

commit;
