begin;
-- Quizzz! · Feedback individual al revelar las respuestas.
-- Se ejecuta DESPUÉS de 202611200002_quiz_game_engine.sql.
-- No altera los datos existentes ni cambia quiz_guest_status.
-- La función solo devuelve el resultado del jugador que presenta su token.

create or replace function public.quiz_guest_feedback(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player_id uuid;
  v_room_id uuid;
  v_room public.quiz_rooms%rowtype;
  v_question jsonb;
  v_selected jsonb;
  v_score integer;
  v_correct jsonb;
  v_outcome text;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  select p.id, p.room_id
    into v_player_id, v_room_id
    from public.quiz_room_players p
   where p.token_digest = extensions.digest(p_token::text, 'sha256');

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_session');
  end if;

  select * into v_room
    from public.quiz_rooms r
   where r.id = v_room_id;

  if not found or v_room.status <> 'waiting' or v_room.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'room_closed');
  end if;

  -- No filtrar ni resultado, ni puntos, ni selección antes de la revelación.
  if v_room.game_phase <> 'reveal' then
    return jsonb_build_object('ok', false, 'error', 'result_not_ready');
  end if;

  if v_room.game_question_index < 0
     or jsonb_typeof(v_room.game_questions) <> 'array'
     or v_room.game_question_index >= jsonb_array_length(v_room.game_questions) then
    return jsonb_build_object('ok', false, 'error', 'invalid_question');
  end if;

  v_question := v_room.game_questions -> v_room.game_question_index;

  select a.selected, a.score
    into v_selected, v_score
    from public.quiz_room_answers a
   where a.room_id = v_room_id
     and a.player_id = v_player_id
     and a.question_index = v_room.game_question_index;

  if not found then
    return jsonb_build_object(
      'ok', true, 'index', v_room.game_question_index,
      'outcome', 'unanswered', 'points', 0, 'selected', null
    );
  end if;

  if v_question ->> 'type' = 'poll' then
    v_outcome := 'participated';
  else
    v_correct := coalesce(v_question -> 'correct', '[]'::jsonb);
    if jsonb_typeof(v_correct) = 'array' and v_selected = v_correct then
      v_outcome := 'correct';
    else
      v_outcome := 'incorrect';
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'index', v_room.game_question_index,
    'outcome', v_outcome,
    'points', coalesce(v_score, 0),
    'selected', v_selected
  );
end;
$$;

revoke execute on function public.quiz_guest_feedback(uuid)
  from public, anon, authenticated;
grant execute on function public.quiz_guest_feedback(uuid)
  to anon, authenticated;

commit;
