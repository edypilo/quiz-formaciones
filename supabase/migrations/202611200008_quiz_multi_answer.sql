begin;

-- Quizzz! · Quiz con varias respuestas correctas.

-- Ejecutar tras la migración 202611200007_quiz_guest_media.sql.

-- Se revela únicamente si la pregunta es de selección múltiple, nunca cuáles son correctas.

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
       or ((q->>'type') <> 'poll' and (jsonb_typeof(q->'correct') <> 'array'
          or jsonb_array_length(q->'correct') < 1
          or jsonb_array_length(q->'correct') > 4
          or ((q->>'type') = 'truefalse' and jsonb_array_length(q->'correct') <> 1)))
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

create or replace function public.quiz_guest_answer(p_token uuid, p_selected jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.quiz_rooms%rowtype;
  v_room_id uuid;
  v_player uuid;
  v_question jsonb;
  v_options jsonb;
  v_correct jsonb;
  v_n integer;
  v_item jsonb;
  v_seen integer[] := '{}';
  v_selected jsonb;
  v_score integer := 0;
  v_equal boolean;
  v_rows integer;
begin
  if p_token is null or p_selected is null
     or jsonb_typeof(p_selected) <> 'array'
     or jsonb_array_length(p_selected) < 1
     or jsonb_array_length(p_selected) > 4 then
    return jsonb_build_object('ok',false,'error','invalid_answer');
  end if;
  select p.id, p.room_id into v_player, v_room_id
    from public.quiz_room_players p
   where p.token_digest = extensions.digest(p_token::text, 'sha256');
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into v_room from public.quiz_rooms where id = v_room_id;
  if v_room.status <> 'waiting' or v_room.expires_at <= now()
     or v_room.game_phase <> 'question' or clock_timestamp() >= v_room.question_ends_at then
    return jsonb_build_object('ok',false,'error','question_closed');
  end if;
  v_question := v_room.game_questions->v_room.game_question_index;
  v_options := v_question->'options';
  v_correct := coalesce(v_question->'correct','[]'::jsonb);
  if (v_question->>'type' <> 'quiz' or jsonb_array_length(v_correct) = 1)
     and jsonb_array_length(p_selected) <> 1 then
    return jsonb_build_object('ok',false,'error','invalid_answer');
  end if;
  for v_item in select value from jsonb_array_elements(p_selected) loop
    if jsonb_typeof(v_item) <> 'number' or v_item::text !~ '^[0-3]$' then
      return jsonb_build_object('ok',false,'error','invalid_answer');
    end if;
    v_n := (v_item::text)::integer;
    if v_n >= jsonb_array_length(v_options) or
       nullif(btrim(v_options->>v_n),'') is null or v_n = any(v_seen) then
      return jsonb_build_object('ok',false,'error','invalid_answer');
    end if;
    v_seen := array_append(v_seen,v_n);
  end loop;
  select coalesce(jsonb_agg(x order by x),'[]'::jsonb)
    into v_selected from unnest(v_seen) as x;
  v_equal := (jsonb_typeof(v_correct) = 'array' and v_selected = v_correct);
  if coalesce(v_question->>'type','') <> 'poll' and v_equal then
    v_score := (case when (v_question->>'points')::integer = 2 then 2000
                     when (v_question->>'points')::integer = 0 then 0
                     else 1000 end);
  end if;
  insert into public.quiz_room_answers(room_id,player_id,question_index,selected,score)
    values(v_room.id,v_player,v_room.game_question_index,v_selected,v_score)
  on conflict(room_id,player_id,question_index) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('ok',false,'error','already_answered'); end if;
  return jsonb_build_object('ok',true,'accepted',true);
end;
$$;

create or replace function public.quiz_guest_status(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.quiz_rooms%rowtype;
  v_room_id uuid;
  v_player uuid;
  v_nickname text;
  v_count integer;
  v_question jsonb;
  v_public jsonb := 'null'::jsonb;
  v_answered boolean := false;
  v_phase text;
begin
  select p.room_id, p.id, p.nickname into v_room_id, v_player, v_nickname
    from public.quiz_room_players p
   where p.token_digest = extensions.digest(p_token::text, 'sha256');
  if not found then return jsonb_build_object('ok',false,'error','session_not_found'); end if;
  select * into v_room from public.quiz_rooms where id = v_room_id;
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
      'type',v_question->>'type',
      'multiple',case when v_question->>'type'='quiz' and jsonb_typeof(v_question->'correct')='array'
                  then jsonb_array_length(v_question->'correct')>1 else false end,
      'text',v_question->>'text',
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

create or replace function public.quiz_host_presenter_state(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.quiz_rooms%rowtype;
  v_title text;
  v_question jsonb := 'null'::jsonb;
  v_public_question jsonb := 'null'::jsonb;
  v_players jsonb := '[]'::jsonb;
  v_scores jsonb := '[]'::jsonb;
  v_distribution jsonb := '[]'::jsonb;
  v_answered integer := 0;
  v_player_count integer := 0;
  v_count integer := 0;
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select * into v_room from public.quiz_rooms r
    where r.id = p_room_id and r.owner_id = (select auth.uid());
  if not found then return jsonb_build_object('ok', false, 'error', 'room_not_found'); end if;
  select q.title into v_title from public.quiz_quizzes q
    where q.id = v_room.quiz_id and q.owner_id = v_room.owner_id;
  select count(*) into v_player_count from public.quiz_room_players p
    where p.room_id = v_room.id;
  select coalesce(jsonb_agg(p.nickname order by p.joined_at), '[]'::jsonb)
    into v_players from public.quiz_room_players p where p.room_id = v_room.id;
  select coalesce(jsonb_agg(jsonb_build_object(
       'nickname', s.nickname, 'score', s.score, 'answered', s.answered,
       'previous_score', s.previous_score
     ) order by s.score desc, s.nickname asc), '[]'::jsonb)
    into v_scores from (
    select p.nickname,
           coalesce(sum(a.score),0)::integer as score,
           count(a.id)::integer as answered,
           coalesce(sum(a.score) filter (
             where a.question_index < v_room.game_question_index
           ),0)::integer as previous_score
      from public.quiz_room_players p
      left join public.quiz_room_answers a
        on a.player_id = p.id and a.room_id = v_room.id
      where p.room_id = v_room.id
      group by p.id, p.nickname
    ) s;
  if jsonb_typeof(v_room.game_questions) = 'array' then
    v_count := jsonb_array_length(v_room.game_questions);
  end if;
  if v_room.game_question_index >= 0 and v_room.game_question_index < v_count
    and v_room.game_phase in ('question', 'reveal') then
    v_question := v_room.game_questions -> v_room.game_question_index;
    select count(*) into v_answered
      from public.quiz_room_answers a
      where a.room_id = v_room.id and a.question_index = v_room.game_question_index;
    if v_room.game_phase = 'reveal' then
      select coalesce(jsonb_agg(
          (select count(*)::integer
             from public.quiz_room_answers a
            where a.room_id = v_room.id
              and a.question_index = v_room.game_question_index
              and a.selected @> jsonb_build_array(gs.choice))
          order by gs.choice
        ), '[]'::jsonb)
        into v_distribution
        from generate_series(0, jsonb_array_length(v_question->'options') - 1) as gs(choice);
    end if;
    v_public_question := jsonb_build_object(
      'text', v_question->>'text',
      'type', v_question->>'type',
      'multiple',case when v_question->>'type'='quiz' and jsonb_typeof(v_question->'correct')='array'
                   then jsonb_array_length(v_question->'correct')>1 else false end,
      'options', v_question->'options',
      'points', v_question->'points',
      'explanation', case when v_room.game_phase='reveal'
        then v_question->>'explanation' else null end,
      'media', case when v_question->'media'->>'type'='youtube'
        then v_question->'media' else 'null'::jsonb end,
      'correct', case when v_room.game_phase='reveal'
        then coalesce(v_question->'correct','[]'::jsonb) else 'null'::jsonb end
    );
  end if;
  return jsonb_build_object(
    'ok', true, 'room_id', v_room.id, 'pin', v_room.pin,
    'join_secret', v_room.join_secret, 'is_joinable', v_room.is_joinable,
    'quiz_title', coalesce(v_title,'Cuestionario'),
    'status', case when v_room.status='waiting' and v_room.expires_at>now()
      then 'open' else 'closed' end,
    'phase', v_room.game_phase, 'index', v_room.game_question_index,
    'count', v_count, 'ends_at', v_room.question_ends_at,
    'server_time', clock_timestamp(),
    'question', v_public_question, 'player_count', v_player_count,
    'players', v_players, 'answered_count', v_answered,
    'distribution', v_distribution, 'scores', v_scores
  );
end;
$$;

revoke execute on function public.quiz_host_start_game(uuid) from public, anon, authenticated;

grant execute on function public.quiz_host_start_game(uuid) to authenticated;

revoke execute on function public.quiz_guest_answer(uuid,jsonb) from public, anon, authenticated;

grant execute on function public.quiz_guest_answer(uuid,jsonb) to anon, authenticated;

revoke execute on function public.quiz_guest_status(uuid) from public, anon, authenticated;

grant execute on function public.quiz_guest_status(uuid) to anon, authenticated;

revoke execute on function public.quiz_host_presenter_state(uuid) from public, anon, authenticated;

grant execute on function public.quiz_host_presenter_state(uuid) to authenticated;

commit;