begin;
-- Quizzz! · Avisos Realtime privados SOLO para docentes autenticados.
-- Se ejecuta después de 202611200004_quiz_presenter.sql.
-- Sin claves secretas, sin canal público, sin acceso a respuestas de otros jugadores.
-- Cada mensaje únicamente indica que el presentador debe actualizar datos.

-- Autorización en el canal. No se concede INSERT a clientes (solo lectura).
drop policy if exists quizzz_host_receive on realtime.messages;
create policy quizzz_host_receive on realtime.messages
for select to authenticated using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1 from public.quiz_rooms r
     where r.owner_id = (select auth.uid())
       and (select realtime.topic()) = ('quizzz:host:' || r.id::text)
  )
);

create or replace function public.quizzz_notify_room_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (old.game_phase, old.game_question_index, old.status, old.is_joinable)
    is distinct from
     (new.game_phase, new.game_question_index, new.status, new.is_joinable) then
    perform realtime.send(
      jsonb_build_object('room_id',new.id,'kind','phase'),
      'changed', 'quizzz:host:' || new.id::text, true
    );
  end if;
  return new;
end;
$$;
revoke all on function public.quizzz_notify_room_update() from public, anon, authenticated;
drop trigger if exists quizzz_rt_room on public.quiz_rooms;
create trigger quizzz_rt_room
after update of game_phase, game_question_index, status, is_joinable
on public.quiz_rooms
for each row execute function public.quizzz_notify_room_update();

create or replace function public.quizzz_notify_answer()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('room_id',new.room_id,'kind','answer'),
    'changed','quizzz:host:' || new.room_id::text,true
  );
  return new;
end;
$$;
revoke all on function public.quizzz_notify_answer() from public, anon, authenticated;
drop trigger if exists quizzz_rt_answer on public.quiz_room_answers;
create trigger quizzz_rt_answer
after insert on public.quiz_room_answers
for each row execute function public.quizzz_notify_answer();

create or replace function public.quizzz_notify_participants()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_room uuid;
begin
  if tg_op = 'DELETE' then v_room := old.room_id;
  else v_room := new.room_id; end if;
  perform realtime.send(
    jsonb_build_object('room_id',v_room,'kind','participant'),
    'changed','quizzz:host:' || v_room::text,true
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.quizzz_notify_participants() from public, anon, authenticated;
drop trigger if exists quizzz_rt_participants on public.quiz_room_players;
create trigger quizzz_rt_participants
after insert or delete on public.quiz_room_players
for each row execute function public.quizzz_notify_participants();

commit;
