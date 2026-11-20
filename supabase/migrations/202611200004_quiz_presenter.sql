begin;
-- Quizzz! · Presentador cloud y puesto personal.
-- DESPUÉS de 202611200003_quiz_guest_feedback.sql.
-- No se conceden permisos directos a tablas de respuestas ni preguntas a invitados.

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
              and a.selected @> jsonb_build_array(i))
          order by i
        ), '[]'::jsonb)
        into v_distribution
        from generate_series(0, jsonb_array_length(v_question->'options') - 1) as i;
    end if;
    v_public_question := jsonb_build_object(
      'text', v_question->>'text',
      'type', v_question->>'type',
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
revoke execute on function public.quiz_host_presenter_state(uuid)
  from public, anon, authenticated;
grant execute on function public.quiz_host_presenter_state(uuid) to authenticated;

-- Revelación idempotente: nunca pasa a la siguiente pregunta automáticamente.
-- Solo funciona después del plazo registrado en PostgreSQL.
create or replace function public.quiz_host_reveal_due(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.quiz_rooms%rowtype;
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('ok',false,'error','unauthorized');
  end if;
  select * into v_room from public.quiz_rooms r
    where r.id=p_room_id and r.owner_id=(select auth.uid()) for update;
  if not found then return jsonb_build_object('ok',false,'error','room_not_found'); end if;
  if v_room.status<>'waiting' or v_room.expires_at<=now() then
    return jsonb_build_object('ok',false,'error','room_closed');
  end if;
  if v_room.game_phase='question' and v_room.question_ends_at <= clock_timestamp() then
    update public.quiz_rooms set game_phase='reveal' where id=p_room_id;
    return jsonb_build_object('ok',true,'changed',true,'phase','reveal');
  end if;
  return jsonb_build_object('ok',true,'changed',false,'phase',v_room.game_phase);
end;
$$;
revoke execute on function public.quiz_host_reveal_due(uuid)
  from public, anon, authenticated;
grant execute on function public.quiz_host_reveal_due(uuid) to authenticated;

-- Solo entrega al jugador la posición y la puntuación propias.
-- No revela rankings ni resultados mientras se responde una pregunta.
create or replace function public.quiz_guest_standing(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_player uuid;
  v_room public.quiz_rooms%rowtype;
  v_room_id uuid;
  v_score integer;
  v_position integer;
  v_previous integer;
  v_total integer;
begin
  if p_token is null then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;
  select p.id, p.room_id into v_player, v_room_id
    from public.quiz_room_players p
    where p.token_digest=extensions.digest(p_token::text,'sha256');
  if not found then return jsonb_build_object('ok',false,'error','invalid_session'); end if;
  select * into v_room from public.quiz_rooms r where r.id=v_room_id;
  if not found or v_room.status<>'waiting' or v_room.expires_at<=now() then
    return jsonb_build_object('ok',false,'error','room_closed');
  end if;
  if v_room.game_phase not in ('reveal','finished') then
    return jsonb_build_object('ok',false,'error','result_not_ready');
  end if;
  with totals as (
    select p.id, p.nickname,
           coalesce(sum(a.score),0)::integer as points,
           coalesce(sum(a.score) filter(
             where a.question_index < v_room.game_question_index
           ),0)::integer as previous_points
    from public.quiz_room_players p
    left join public.quiz_room_answers a
      on a.player_id=p.id and a.room_id=v_room.id
    where p.room_id=v_room.id
    group by p.id,p.nickname
  ), ranked as (
    select id, points,
           row_number() over (order by points desc, nickname asc)::integer as position,
           row_number() over (order by previous_points desc, nickname asc)::integer as previous_position
    from totals
  )
  select r.points,r.position,r.previous_position,(select count(*)::integer from totals)
    into v_score,v_position,v_previous,v_total
    from ranked r where r.id=v_player;
  return jsonb_build_object('ok',true,'score',v_score,'position',v_position,
    'previous_position',v_previous,'total',v_total);
end;
$$;
revoke execute on function public.quiz_guest_standing(uuid)
  from public, anon, authenticated;
grant execute on function public.quiz_guest_standing(uuid) to anon, authenticated;
commit;
