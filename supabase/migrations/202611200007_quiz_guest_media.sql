begin;
-- Quizzz! · autorización temporal de archivos privados para invitados.
-- Ejecutar después de 202611200006_quiz_realtime_guests.sql.
-- La función solo devuelve la ruta de imagen o vídeo de la pregunta EN CURSO
-- al poseedor de un token válido. Nunca devuelve URLs firmadas ni claves.
create or replace function public.quiz_guest_active_media(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_room public.quiz_rooms%rowtype;
  v_media jsonb;
  v_path text;
  v_type text;
begin
  if p_token is null then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;
  select r.* into v_room
    from public.quiz_room_players p
    join public.quiz_rooms r on r.id = p.room_id
    where p.token_digest = extensions.digest(p_token::text, 'sha256');
  if not found or v_room.status <> 'waiting' or not v_room.is_joinable
     or v_room.expires_at <= now() then
    return jsonb_build_object('ok',false,'error','invalid_session');
  end if;
  if v_room.game_phase <> 'question' or v_room.question_ends_at <= clock_timestamp()
     or v_room.game_question_index < 0
     or jsonb_typeof(v_room.game_questions) <> 'array'
     or v_room.game_question_index >= jsonb_array_length(v_room.game_questions) then
    return jsonb_build_object('ok',false,'error','question_not_active');
  end if;

  v_media := v_room.game_questions -> v_room.game_question_index -> 'media';
  v_type := v_media ->> 'type';
  v_path := v_media ->> 'src';
  if v_type not in ('image','video') or v_path is null then
    return jsonb_build_object('ok',false,'error','no_private_media');
  end if;
  if v_path !~* (
    '^' || v_room.owner_id::text ||
    '/assets/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|gif|mp4|webm)$'
  ) then
    return jsonb_build_object('ok',false,'error','invalid_media');
  end if;
  if (v_type = 'image' and v_path !~* '\.(png|jpg|webp|gif)$')
     or (v_type = 'video' and v_path !~* '\.(mp4|webm)$') then
    return jsonb_build_object('ok',false,'error','invalid_media');
  end if;
  return jsonb_build_object('ok',true,'type',v_type,'path',v_path,
    'owner_id',v_room.owner_id,'index',v_room.game_question_index);
end;
$$;
revoke execute on function public.quiz_guest_active_media(uuid)
  from public, anon, authenticated;
grant execute on function public.quiz_guest_active_media(uuid) to anon, authenticated;
commit;