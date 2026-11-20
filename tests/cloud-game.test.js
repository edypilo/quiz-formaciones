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
  assert.match(sql,/begin;/i);
  assert.match(sql,/commit;/i);
  assert.match(sql,/unique \(room_id, player_id, question_index\)/);
  assert.match(sql,/on conflict\(room_id,player_id,question_index\) do nothing/);
  assert.match(sql,/v_room\.game_phase <> 'question'/);
  assert.match(sql,/clock_timestamp\(\) >= v_room\.question_ends_at/);
  assert.match(sql,/case when v_phase = 'reveal'/);
  assert.match(sql,/revoke all on public\.quiz_room_answers from anon, authenticated/);
  assert.equal((sql.match(/create or replace function public\.quiz_guest_status/g)||[]).length,1);
  assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
});
