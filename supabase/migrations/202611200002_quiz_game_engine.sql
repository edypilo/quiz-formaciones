begin;
-- Quizzz! · Fase 1 del juego cloud: primera pregunta, envío de respuesta y avance manual.
-- Ejecutar DESPUÉS de 202611200001_quiz_guest_lobby.sql. No modifica main ni la versión local.

alter table public.quiz_rooms add column if not exists game_phase text not null default 'lobby';
alter table public.quiz_rooms add column if not exists game_question_index integer not null default -1;
alter table public.quiz_rooms add column if not exists game_questions jsonb not null default '[]'::jsonb;
alter table public.quiz_rooms add column if not exists question_started_at timestamptz;
alter table public.quiz_rooms add column if not exists question_ends_at timestamptz;

-- No se conceden permisos directos a invitados ni de escritura sobre game_* al formador.
create table if not exists public.quiz_room_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.quiz_rooms(id) on delete cascade,
  player_id uuid not null references public.quiz_room_players(id) on delete cascade,
  question_index integer not null check (question_index >= 0),
  selected jsonb not null check (jsonb_typeof(selected) = 'array'),
  score integer not null default 0 check (score >= 0),
  submitted_at timestamptz not null default clock_timestamp(),
  unique (room_id, player_id, question_index)
);
create index if not exists quiz_room_answers_room_idx
  on public.quiz_room_answers(room_id, question_index);
alter table public.quiz_room_answers enable row level security;
revoke all on public.quiz_room_answers from anon, authenticated;

-- Solo el propietario autenticado inicia un juego. Se guarda una copia
-- inmutable del cuestionario para evitar modificaciones durante la partida.
create or replace function public.quiz_host_start_game(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.quiz_rooms%rowtype;
  v_questions jsonb;
  v_time integer;
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select * into v_room from public.quiz_rooms
    where id = p_room_id and owner_id = (select auth.uid())
    for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'room_not_found'); end if;
  if v_room.status <> 'waiting' or not v_room.is_joinable or v_room.expires_at <= now()
     or v_room.game_phase <> 'lobby' then
    return jsonb_build_object('ok', false, 'error', 'room_not_ready');
  end if;
  if not exists (select 1 from public.quiz_room_players where room_id = p_room_id) then
    return jsonb_build_object('ok', false, 'error', 'no_players');
  end if;
  select questions into v_questions from public.quiz_quizzes
    where id = v_room.quiz_id and owner_id = v_room.owner_id;
  if v_questions is null or jsonb_typeof(v_questions) <> 'array'
     or jsonb_array_length(v_questions) < 1
     or jsonb_array_length(v_questions) > 200 then
    return jsonb_build_object('ok', false, 'error', 'invalid_questions');
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_questions) q
    where nullif(btrim(q->>'text'),'') is null
       or jsonb_typeof(q->'options') <> 'array'
       or jsonb_array_length(q->'options') < 2
       or coalesce((q->>'type') not in ('quiz','truefalse','poll'), true)
  ) then return jsonb_build_object('ok', false, 'error', 'invalid_questions'); end if;
  v_time := greatest(5, least(240,
    coalesce(nullif(v_questions->0->>'time','')::integer,20)));
  update public.quiz_rooms
    set game_phase = 'question', game_question_index = 0,
        game_questions = v_questions, question_started_at = clock_timestamp(),
        question_ends_at = clock_timestamp() + make_interval(secs => v_time)
    where id = p_room_id;
  return jsonb_build_object('ok', true, 'phase','question','index',0);
end;
$$;
revoke execute on function public.quiz_host_start_game(uuid) from public, anon, authenticated;
grant execute on function public.quiz_host_start_game(uuid) to authenticated;

-- El formador avanza de pregunta a revelación, y de revelación a siguiente pregunta.
create or replace function public.quiz_host_advance_game(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.quiz_rooms%rowtype;
  v_next integer;
  v_time integer;
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select * into v_room from public.quiz_rooms
    where id = p_room_id and owner_id = (select auth.uid())
    for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'room_not_found'); end if;
  if v_room.status <> 'waiting' or v_room.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'room_closed');
  end if;
  if v_room.game_phase = 'question' then
    update public.quiz_rooms set game_phase = 'reveal' where id = p_room_id;
    return jsonb_build_object('ok', true, 'phase','reveal','index',v_room.game_question_index);
  elsif v_room.game_phase = 'reveal' then
    v_next := v_room.game_question_index + 1;
    if v_next >= jsonb_array_length(v_room.game_questions) then
      update public.quiz_rooms set game_phase = 'finished',
        question_started_at = null, question_ends_at = null where id = p_room_id;
      return jsonb_build_object('ok', true, 'phase','finished','index',v_room.game_question_index);
    end if;
    v_time := greatest(5, least(240,
      coalesce(nullif(v_room.game_questions->v_next->>'time','')::integer,20)));
    update public.quiz_rooms
      set game_phase = 'question', game_question_index = v_next,
          question_started_at = clock_timestamp(),
          question_ends_at = clock_timestamp() + make_interval(secs => v_time)
      where id = p_room_id;
    return jsonb_build_object('ok', true, 'phase','question','index',v_next);
  end if;
  return jsonb_build_object('ok', false, 'error','invalid_phase');
end;
$$;
revoke execute on function public.quiz_host_advance_game(uuid) from public, anon, authenticated;
grant execute on function public.quiz_host_advance_game(uuid) to authenticated;

-- El jugador solo conoce sus opciones, nunca los índices correctos
-- mientras se está respondiendo. La DB determina el plazo real.
create or replace function public.quiz_guest_answer(p_token uuid, p_selected jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.quiz_rooms%rowtype;
  v_player uuid;
  v_question jsonb;
  v_options jsonb;
  v_correct jsonb;
  v_n integer;
  v_score integer := 0;
  v_equal boolean;
  v_rows integer;
begin
  if p_token is null or p_selected is null
     or jsonb_typeof(p_selected) <> 'array'
     or jsonb_array_length(p_selected) <> 1 then
    return jsonb_build_object('ok',false,'error','invalid_answer');
  end if;
  select p.id, r.id into v_player, v_room.id
    from public.quiz_room_players p
    join public.quiz_rooms r on r.id = p.room_id
   where p.token_digest = extensions.digest(p_token::text, 'sha256');
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into v_room from public.quiz_rooms where id = v_room.id;
  if v_room.status <> 'waiting' or v_room.expires_at <= now()
     or v_room.game_phase <> 'question' or clock_timestamp() >= v_room.question_ends_at then
    return jsonb_build_object('ok',false,'error','question_closed');
  end if;
  v_question := v_room.game_questions->v_room.game_question_index;
  v_options := v_question->'options';
  if jsonb_typeof(p_selected->0) <> 'number'
      or (p_selected->>0) !~ '^[0-9]+$' then
    return jsonb_build_object('ok',false,'error','invalid_answer');
  end if;
  v_n := (p_selected->>0)::integer;
  if v_n < 0 or v_n >= jsonb_array_length(v_options)
     or nullif(btrim(v_options->>v_n),'') is null then
    return jsonb_build_object('ok',false,'error','invalid_answer');
  end if;
  v_correct := coalesce(v_question->'correct','[]'::jsonb);
  v_equal := exists (select 1 from jsonb_array_elements_text(v_correct) item
                       where item = v_n::text);
  if coalesce(v_question->>'type','') <> 'poll' and v_equal then
    v_score := (case when (v_question->>'points')::integer = 2 then 2000
                     when (v_question->>'points')::integer = 0 then 0
                     else 1000 end);
  end if;
  insert into public.quiz_room_answers(room_id,player_id,question_index,selected,score)
    values(v_room.id,v_player,v_room.game_question_index,p_selected,v_score)
  on conflict(room_id,player_id,question_index) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('ok',false,'error','already_answered'); end if;
  return jsonb_build_object('ok',true,'accepted',true);
end;
$$;
revoke execute on function public.quiz_guest_answer(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.quiz_guest_answer(uuid,jsonb) to anon, authenticated;

-- Sustituye la consulta de lobby sin alterar la firma.
create or replace function public.quiz_guest_status(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.quiz_rooms%rowtype;
  v_player uuid;
  v_nickname text;
  v_count integer;
  v_question jsonb;
  v_public jsonb := 'null'::jsonb;
  v_answered boolean := false;
  v_phase text;
begin
  select r.*, p.id, p.nickname into v_room, v_player, v_nickname
    from public.quiz_room_players p
    join public.quiz_rooms r on r.id = p.room_id
    where p.token_digest = extensions.digest(p_token::text, 'sha256');
  if not found then return jsonb_build_object('ok',false,'error','session_not_found'); end if;
  select count(*) into v_count from public.quiz_room_players where room_id = v_room.id;
  v_phase := v_room.game_phase;
  if v_room.status <> 'waiting' or v_room.expires_at <= now() then v_phase := 'closed'; end if;
  if v_phase in ('question','reveal') and v_room.game_question_index >= 0 then
    v_question := v_room.game_questions->v_room.game_question_index;
    select exists(select 1 from public.quiz_room_answers a
      where a.player_id=v_player and a.room_id=v_room.id and a.question_index=v_room.game_question_index)
      into v_answered;
    v_public := jsonb_build_object(
      'index',v_room.game_question_index, 'count', jsonb_array_length(v_room.game_questions),
      'type',v_question->>'type', 'text',v_question->>'text',
      'options',v_question->'options', 'time',v_question->'time',
      'media',case when v_question->'media'->>'type' = 'youtube'
               then v_question->'media' else 'null'::jsonb end,
      'ends_at',v_room.question_ends_at,
      'correct',case when v_phase = 'reveal'
                   then coalesce(v_question->'correct','[]'::jsonb)
                   else 'null'::jsonb end);
  end if;
  return jsonb_build_object('ok',true,'pin',v_room.pin,
    'nickname',v_nickname,'player_count',v_count,
    'room_status',case when v_phase='closed' then 'closed' else 'waiting' end,
    'game_phase',v_phase,'question',v_public,'answered',v_answered);
end;
$$;
revoke execute on function public.quiz_guest_status(uuid) from public, anon, authenticated;
grant execute on function public.quiz_guest_status(uuid) to anon, authenticated;

-- El formador obtiene la puntuación agregada sin revelar tokens del jugador.
create or replace function public.quiz_host_game_scores(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_owner uuid; v_rows jsonb;
begin
  select owner_id into v_owner from public.quiz_rooms where id=p_room_id;
  if v_owner is distinct from (select auth.uid()) then
    return jsonb_build_object('ok',false,'error','unauthorized');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('nickname',name,'score',points,'answered',answers)
    order by points desc), '[]'::jsonb) into v_rows
    from (select p.nickname as name,coalesce(sum(a.score),0)::integer as points,
                 count(a.id)::integer as answers
          from public.quiz_room_players p
          left join public.quiz_room_answers a on a.player_id = p.id
          where p.room_id=p_room_id
          group by p.id,p.nickname) scores;
  return jsonb_build_object('ok',true,'scores',v_rows);
end;
$$;
revoke execute on function public.quiz_host_game_scores(uuid) from public, anon, authenticated;
grant execute on function public.quiz_host_game_scores(uuid) to authenticated;
commit;
