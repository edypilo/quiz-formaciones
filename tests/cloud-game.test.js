'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { makeRouter } = require('../cloud/api');
const userId = '1570d6d0-6b12-48ca-a565-4a08a7dcb170';
const roomId = 'd5f47ca1-a416-43a3-8341-6dffca530f3f';
async function api(fetcher, cb) {
  const keys = ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'];
  const old = keys.map(k=>process.env[k]);
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const app = express();
  app.use('/api/cloud', makeRouter(fetcher));
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try { await cb('http://127.0.0.1:'+server.address().port); }
  finally {
    await new Promise(resolve=>server.close(resolve));
    keys.forEach((key,i)=>{ if(old[i] === undefined)delete process.env[key];else process.env[key]=old[i]; });
  }
}
function mock(value,status=200) {
  return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
}
test('solo formador autenticado inicia, avanza y consulta puntuación de partida', async()=>{
  const calls=[];
  const fake = async(url,options)=>{
    calls.push({url:String(url),options});
    if(String(url).endsWith('/auth/v1/user'))return mock({id:userId});
    if(String(url).endsWith('/rpc/quiz_host_start_game'))return mock({ok:true,phase:'question',index:0});
    if(String(url).endsWith('/rpc/quiz_host_advance_game'))return mock({ok:true,phase:'reveal',index:0});
    if(String(url).endsWith('/rpc/quiz_host_game_scores'))
      return mock({ok:true,scores:[{nickname:'Koala Veloz',score:1000,answered:1}]});
    throw Error('Unexpected URL');
  };
  await api(fake,async base=>{
    const auth={Authorization:'Bearer test.jwt.signature'};
    for(const cmd of ['start','advance','scores']){
      const target=base+'/api/cloud/rooms/'+roomId+'/'+cmd;
      assert.equal((await fetch(target,{method:'POST'})).status,401);
      const response=await fetch(target,{method:'POST',headers:auth});
      assert.equal(response.status,200);
      assert.equal((await response.json()).ok,true);
    }
    assert.equal((await fetch(base+'/api/cloud/rooms/bad-id/start',{method:'POST',headers:auth})).status,400);
    const rpcs=calls.filter(c=>c.url.includes('/rpc/'));
    assert.equal(rpcs.length,3);
    assert.ok(rpcs.every(c=>c.options.headers.Authorization==='Bearer test.jwt.signature'));
    assert.ok(rpcs.every(c=>JSON.parse(c.options.body).p_room_id===roomId));
  });
});
test('formador consulta estado de pregunta con filtro por propietario',async()=>{
  let read='';
  await api(async (url,options)=>{
    if(String(url).endsWith('/auth/v1/user'))return mock({id:userId});
    read=String(url);
    return mock([{id:roomId,game_phase:'question',game_question_index:0,
      game_questions:[{text:'¿Qué es IA?',type:'quiz',options:['A','B'],correct:[0]}],
      question_ends_at:'2026-11-20T12:00:00Z'}]);
  },async base=>{
    const headers={Authorization:'Bearer test.jwt.signature'};
    const response=await fetch(base+'/api/cloud/rooms/'+roomId+'/game',{headers});
    assert.equal(response.status,200);
    const game=await response.json();
    assert.equal(game.phase,'question');
    assert.equal(game.question.text,'¿Qué es IA?');
    assert.equal(game.question.correct,null);
    assert.ok(read.includes('owner_id=eq.'+userId));
    assert.equal((await fetch(base+'/api/cloud/rooms/'+roomId+'/game')).status,401);
  });
});
test('migración de motor mantiene funciones separadas, índices únicos y respuestas sin filtración anticipada',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/202611200002_quiz_game_engine.sql'),'utf8');
  assert.match(sql,/^begin;/m);
  assert.match(sql,/^commit;/m);
  assert.match(sql,/unique \(room_id, player_id, question_index\)/);
  assert.match(sql,/on conflict\(room_id,player_id,question_index\) do nothing/);
  assert.match(sql,/v_room\.game_phase <> 'question'/);
  assert.match(sql,/clock_timestamp\(\) >= v_room\.question_ends_at/);
  assert.match(sql,/case when v_phase = 'reveal'/);
  assert.match(sql,/revoke all on public\.quiz_room_answers from anon, authenticated/);
  assert.ok(sql.includes("or (p_selected->>0) !~ '^[0-9]{1,2}$' then"));
  assert.equal((sql.match(/\$\$/g)||[]).length,10);
  assert.equal((sql.match(/create or replace function public\.quiz_guest_status/g)||[]).length,1);
  assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
});

test('feedback de cada jugador se calcula solo en revelación usando su propio token',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/202611200003_quiz_guest_feedback.sql'),'utf8');
  assert.match(sql,/create or replace function public\.quiz_guest_feedback\(p_token uuid\)/);
  assert.match(sql,/p\.token_digest = extensions\.digest\(p_token::text, 'sha256'\)/);
  assert.match(sql,/v_room\.game_phase <> 'reveal'/);
  assert.match(sql,/a\.player_id = v_player_id/);
  assert.match(sql,/a\.question_index = v_room\.game_question_index/);
  assert.match(sql,/'outcome', 'unanswered', 'points', 0, 'selected', null/);
  assert.match(sql,/v_selected = v_correct/);
  assert.match(sql,/v_outcome := 'participated'/);
  assert.match(sql,/'points', coalesce\(v_score, 0\)/);
  assert.doesNotMatch(sql,/grant (select|update|delete|insert) on public\.quiz_room_answers to anon/);
  assert.equal((sql.match(/create or replace function public\.quiz_guest_feedback/g)||[]).length,1);
  assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
  assert.equal((sql.match(/\$\$/g)||[]).length,2);
});

test('pantalla de invitados contempla los cuatro resultados y evita consultar antes de revelar',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../cloud/join.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../cloud/join.html'),'utf8');
  assert.match(js,/phase === 'reveal'/);
  assert.match(js,/rpc\('quiz_guest_feedback', \{ p_token: token \}\)/);
  assert.match(js,/currentQuestionKey !== key/);
  assert.match(js,/feedbackCompletedKey !== key/);
  assert.match(js,/feedbackPendingKey === key/);
  for(const outcome of ['correct','incorrect','unanswered','participated']){
    assert.ok(js.includes(outcome));
  }
  for(const id of ['guest-feedback','guest-feedback-title','guest-feedback-message',
                   'guest-feedback-points','guest-feedback-present']){
    assert.ok(html.includes('id="'+id+'"'));
  }
  assert.match(html,/aria-live="polite"/);
  assert.match(html,/prefers-reduced-motion/);
});

test('presentador separado: funciones privadas y distribución de votos solo en revelación',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/202611200004_quiz_presenter.sql'),'utf8');
  assert.match(sql,/create or replace function public\.quiz_host_presenter_state\(p_room_id uuid\)/);
  assert.match(sql,/create or replace function public\.quiz_host_reveal_due\(p_room_id uuid\)/);
  assert.match(sql,/create or replace function public\.quiz_guest_standing\(p_token uuid\)/);
  assert.match(sql,/r\.owner_id = \(select auth\.uid\(\)\)/);
  assert.match(sql,/case when v_room\.game_phase='reveal'/);
  assert.match(sql,/question_ends_at <= clock_timestamp\(\)/);
  assert.match(sql,/v_room\.game_phase not in \('reveal','finished'\)/);
  assert.match(sql,/revoke execute on function public\.quiz_host_presenter_state/);
  assert.match(sql,/revoke execute on function public\.quiz_guest_standing/);
  assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
  assert.equal((sql.match(/\$\$/g)||[]).length,6);
});
test('móvil recibe formas y puesto sin consultar clasificación antes de mostrar resultado',()=>{
  const js=fs.readFileSync(path.join(__dirname,'../cloud/join.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../cloud/join.html'),'utf8');
  assert.match(js,/const shapes = \['▲','◆','●','■'\]/);
  assert.match(js,/rpc\('quiz_guest_standing', \{ p_token: token \}\)/);
  assert.match(js,/currentQuestionKey.endsWith\(':reveal'\)/);
  assert.match(js,/if \(phase === 'finished'\)/);
  assert.match(html,/id="guest-final"/);
  for(const name of ['c0','c1','c2','c3'])assert.match(html,new RegExp('\\.'+name));
});
test('presentador usa token transmitido por origen verificado sin incluirlo en URL',()=>{
  const admin=fs.readFileSync(path.join(__dirname,'../cloud/admin.js'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../cloud/presenter.js'),'utf8');
  assert.match(admin,/presenterWindows\.get\(roomId\) !== event\.source/);
  assert.match(admin,/event\.origin !== window\.location\.origin/);
  assert.match(js,/e\.origin !== location\.origin \|\| e\.source !== window\.opener/);
  assert.match(js,/quizzz:presenter-auth-request/);
  assert.match(js,/!live\?\.isLive\(\)/);
  assert.match(js,/if \(!document\.hidden\) void refresh\(\)/);
  assert.match(js,/hostCommand\('auto-reveal'\)/);
  assert.match(js,/const shapes = \['▲', '◆', '●', '■'\]/);
});
test('estado agregado exige autorización y bloqueo correcto por rol',async()=>{
  const keys=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'];
  const old=keys.map(k=>process.env[k]);
  process.env.SUPABASE_URL='https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const calls=[];
  try{
    await api(async(url,options)=>{
      calls.push(String(url));
      if(String(url).endsWith('/auth/v1/user'))return mock({id:userId});
      if(String(url).endsWith('/rpc/quiz_host_presenter_state'))return mock({ok:true,phase:'question',player_count:3,answered_count:2});
      if(String(url).endsWith('/rpc/quiz_host_reveal_due'))return mock({ok:true,changed:true,phase:'reveal'});
      throw Error('Unexpected URL');
    },async base=>{
      for(const [action,expected] of [['presenter','question'],['auto-reveal','reveal']]){
        const uri=base+'/api/cloud/rooms/'+roomId+'/'+action;
        assert.equal((await fetch(uri,{method:'POST'})).status,401);
        const res=await fetch(uri,{method:'POST',headers:{Authorization:'Bearer test.jwt.signature'}});
        assert.equal(res.status,200);
        const body=await res.json();
        assert.equal(body.phase,expected);
      }
    });
    assert.ok(calls.some(x=>x.endsWith('/rpc/quiz_host_presenter_state')));
    assert.ok(calls.some(x=>x.endsWith('/rpc/quiz_host_reveal_due')));
  }finally{
    keys.forEach((key,i)=>{if(old[i]===undefined)delete process.env[key];else process.env[key]=old[i];});
  }
});

test('Realtime: notificaciones de cambios sin publicar respuestas ni secretos',()=>{
  const sql=fs.readFileSync(path.join(__dirname,
    '../supabase/migrations/202611200005_quiz_realtime_host.sql'),'utf8');
  assert.match(sql,/create policy quizzz_host_receive on realtime\.messages/);
  assert.match(sql,/realtime\.messages\.extension = 'broadcast'/);
  assert.match(sql,/r\.owner_id = \(select auth\.uid\(\)\)/);
  assert.match(sql,/quizzz:host:/);
  assert.match(sql,/perform realtime\.send/);
  assert.match(sql,/new\.room_id,'kind','answer'/);
  assert.match(sql,/after insert on public\.quiz_room_answers/);
  assert.match(sql,/after insert or delete on public\.quiz_room_players/);
  assert.match(sql,/after update of game_phase, game_question_index, status, is_joinable/);
  assert.doesNotMatch(sql,/jsonb_build_object\([^)]*selected/);
  assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
  assert.equal((sql.match(/\$\$/g)||[]).length,6);
});

test('Realtime: presentador mantiene fallback y no inserta JWT en URL WebSocket',()=>{
  const ws=fs.readFileSync(path.join(__dirname,'../cloud/realtime-host.js'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'../cloud/presenter.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../cloud/presenter.html'),'utf8');
  assert.match(ws,/private: true, broadcast:/);
  assert.match(ws,/event: 'phx_join'/);
  assert.match(ws,/event: 'phx_join', ref: joinRef/);
  assert.match(ws,/access_token: currentJwt/);
  assert.match(ws,/send\('access_token', \{ access_token: jwt \}\)/);
  assert.match(ws,/message\.payload\?\.payload\?\.room_id === roomId/);
  assert.match(ws,/25000/);
  assert.match(ws,/queueReconnect\(\)/);
  assert.doesNotMatch(ws,/encodeURIComponent\(currentJwt\)/);
  assert.match(js,/live\?\.setToken\(token\)/);
  assert.match(js,/!live\?\.isLive\(\)/);
  assert.match(html,/cloud-realtime-host\.js/);
});

test('Realtime invitado: tema opaco, aviso mínimo y RPC protegida con token',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/202611200006_quiz_realtime_guests.sql'),'utf8');
  assert.match(sql,/create or replace function public\.quiz_guest_stream\(p_token uuid\)/);
  assert.match(sql,/p\.token_digest = extensions\.digest\(p_token::text, 'sha256'\)/);
  assert.match(sql,/v_status <> 'waiting' or v_expires <= now\(\)/);
  assert.match(sql,/encode\(extensions\.digest\(v_secret::text \|\| ':guest-events:v1','sha256'\),'hex'\)/);
  assert.match(sql,/jsonb_build_object\('kind','phase'\)/);
  assert.match(sql,/jsonb_build_object\('kind','participant'\)/);
  assert.match(sql,/after update of game_phase, game_question_index, status, is_joinable/);
  assert.match(sql,/after insert or delete on public\.quiz_room_players/);
  assert.doesNotMatch(sql,/jsonb_build_object\('kind','answer'\)/);
  assert.doesNotMatch(sql,/jsonb_build_object\('nickname'/);
  assert.doesNotMatch(sql,/grant select on public\.quiz_room/);
  assert.equal((sql.match(/\$\$/g)||[]).length,6);
  assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
});
test('Realtime invitado: WebSocket no revela token y conserva consultas de respaldo',()=>{
  const client=fs.readFileSync(path.join(__dirname,'../cloud/realtime-guest.js'),'utf8');
  const join=fs.readFileSync(path.join(__dirname,'../cloud/join.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../cloud/join.html'),'utf8');
  assert.match(client,/rpc\('quiz_guest_stream', \{ p_token: playerToken \}\)/);
  assert.match(client,/^.{0,300}private: false/m);
  assert.match(client,/topic = 'realtime:' \+ result\.topic/);
  assert.match(client,/new WebSocket\(url\)/);
  assert.match(client,/setInterval\(\(\) => send\('heartbeat'/);
  assert.match(client,/schedule\(\)/);
  assert.doesNotMatch(client,/encodeURIComponent\(playerToken\)/);
  assert.doesNotMatch(client,/access_token: playerToken/);
  assert.match(join,/realtime\.start\(token\)/);
  assert.match(join,/realtime\?\.stop\(\)/);
  assert.match(join,/checkBusy/);
  assert.match(join,/checkAgain/);
  assert.match(join,/!realtime\?\.isLive\(\)/);
  assert.match(html,/cloud-realtime-guest\.js/);
  assert.match(html,/id="guest-connection-mode"/);
});
