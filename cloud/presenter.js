'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const roomId = qs.get('room') || '';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const shapes = ['▲', '◆', '●', '■'];
  const colors = ['#e0374b', '#226cd3', '#c38b08', '#289046'];
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nformat = (v) => Number(v).toLocaleString('es-ES');
  const avatar = (name) => window.QuizzzNames?.emojiForName?.(name) || '⭐';
  const status = (text, error = false) => { $('status').textContent = text; $('status').dataset.error = String(error); };
  const nonce = crypto.randomUUID();
  let token = '';
  let lastState = null;
  let statePhase = '';
  let view = '';
  let busy = false;
  let changing = false;
  let nextDueRetry = 0;
  let serverOffsetMs = 0;
  let qrUrl = '';
  let qrObjectUrl = '';
  let animators = [];
  const identity = new Intl.Collator('es', { sensitivity: 'base' });

  function authorize() {
    if (!window.opener || window.opener.closed) {
      status('Abre esta pantalla desde el panel de administración de Quizzz!.', true);
      return;
    }
    window.opener.postMessage({
      type: 'quizzz:presenter-auth-request', roomId, nonce,
    }, location.origin);
  }
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== window.opener) return;
    const msg = e.data;
    if (msg?.type === 'quizzz:presenter-auth' &&
        msg.roomId === roomId && msg.nonce === nonce &&
        typeof msg.token === 'string' && msg.token.length) {
      token = msg.token;
      void refresh();
    }
  });
  if (!uuid.test(roomId)) status('La sala no es válida. Vuelve a abrirla desde el administrador.', true);
  else authorize();

  function cancelAnimation() {
    for (const id of animators) clearTimeout(id);
    animators = [];
  }
  function later(ms, fn) {
    animators.push(setTimeout(fn, reduce() ? 0 : ms));
  }
  function show(name) {
    view = name;
    for (const id of ['lobby','question-screen','ranking-screen','podium-screen']) {
      $(id).hidden = id !== name;
    }
  }
  async function request(command, data = null) {
    if (!token) throw new Error('not_authenticated');
    const response = await fetch('/api/cloud/rooms/' + encodeURIComponent(roomId) + '/' + command, {
      method: 'POST', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (response.status === 401) { token = ''; authorize(); throw new Error('expired_session'); }
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok === false) throw new Error(body?.error || 'server_error');
    return body;
  }
  async function hostCommand(command) {
    if (changing) return;
    changing = true;
    try {
      await request(command);
      await refresh(true);
    } catch (err) {
      status('No se pudo avanzar: ' + String(err.message), true);
    } finally { changing = false; }
  }
  $('fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { status('El navegador no ha permitido pantalla completa.', true); }
  });
  document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'f' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) $('fullscreen').click();
  });
  $('start').addEventListener('click', () => void hostCommand('start'));
  $('ranking-button').addEventListener('click', () => {
    if (lastState?.phase !== 'reveal') return;
    renderRanking(lastState);
  });
  $('next').addEventListener('click', () => void hostCommand('advance'));
  $('replay').addEventListener('click', () => {
    if (lastState?.phase === 'finished') renderPodium(lastState);
  });
  window.addEventListener('beforeunload', () => { if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl); });

  async function loadQr(s) {
    if (!s.is_joinable || !s.join_secret || qrUrl) return;
    const join = new URL('/join', location.origin);
    join.searchParams.set('pin', s.pin);
    join.searchParams.set('invite', s.join_secret);
    qrUrl = join.href;
    try {
      const res = await fetch('/api/cloud/rooms/' + encodeURIComponent(roomId) + '/qr', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: qrUrl }), cache: 'no-store',
      });
      if (!res.ok) throw Error('qr_failed');
      const blob = await res.blob();
      if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
      qrObjectUrl = URL.createObjectURL(blob);
      $('qr').src = qrObjectUrl;
    } catch {
      qrUrl = '';
      status('La sala funciona, pero no se pudo generar el QR. Se reintentará.', true);
    }
  }

  function renderLobby(s) {
    show('lobby');
    $('pin').textContent = s.pin;
    $('room-title').textContent = s.quiz_title || 'Cuestionario';
    $('player-count').textContent = s.player_count +
      (s.player_count === 1 ? ' participante' : ' participantes');
    const container = $('players');
    const old = Array.from(container.children).map(el => el.textContent);
    const names = Array.isArray(s.players) ? s.players : [];
    if (old.length !== names.length || old.some((value,i)=>value !== avatar(names[i])+' '+names[i])) {
      container.replaceChildren();
      names.forEach(name => {
        const item = document.createElement('span');
        item.className = 'person';
        item.textContent = avatar(name) + ' ' + name;
        container.append(item);
      });
    }
    $('start').disabled = !s.is_joinable || !s.player_count || s.status !== 'open';
    void loadQr(s);
  }

  function renderQuestion(s) {
    show('question-screen');
    $('room-title').textContent = s.quiz_title || 'Cuestionario';
    $('step').textContent = 'Pregunta ' + (s.index + 1) + ' de ' + s.count;
    $('question').textContent = s.question?.text || '';
    const container = $('answers');
    container.replaceChildren();
    (s.question?.options || []).forEach((option, i) => {
      if (!option) return;
      const card = document.createElement('div');
      card.className = 'answer c' + (i % 4);
      const shape = document.createElement('span');
      shape.className = 'shape'; shape.textContent = shapes[i % 4];
      const text = document.createElement('span'); text.textContent = option;
      card.append(shape,text); container.append(card);
    });
    $('ranking-button').hidden = true;
    $('distribution').hidden = true;
    $('explanation').hidden = true;
    $('responses').textContent = '0 de ' + s.player_count + ' respuestas';
    updateTimer();
  }

  function reveal(s) {
    show('question-screen');
    $('timer').textContent = '✓';
    $('responses').textContent = s.answered_count + ' de ' + s.player_count + ' respuestas';
    const right = Array.isArray(s.question?.correct) ? s.question.correct : [];
    Array.from($('answers').children).forEach((node, index) => {
      node.classList.toggle('correct', right.includes(index));
      node.classList.toggle('dim', right.length && !right.includes(index));
    });
    const distribution = $('distribution');
    distribution.replaceChildren();
    const values = Array.isArray(s.distribution) ? s.distribution : [];
    if (values.length) {
      const max = Math.max(1, ...values);
      values.forEach((value,i) => {
        const bar = document.createElement('div');bar.className='bar c'+(i%4);
        bar.style.height = (25 + 75 * (value/max))+'%';
        bar.textContent = String(value)+(right.includes(i)?' ✓':'');
        distribution.append(bar);
      });
      distribution.hidden = false;
    }
    const explanation = s.question?.explanation;
    $('explanation').hidden = !explanation;
    if (explanation) $('explanation').textContent = '💡 '+explanation;
    $('ranking-button').hidden = false;
    if (!reduce() && typeof Sound !== 'undefined') Sound.reveal();
  }
  function updateTimer() {
    if (!lastState || lastState.phase !== 'question' || view !== 'question-screen') return;
    const end = Date.parse(lastState.ends_at);
    const left = Number.isFinite(end) ? Math.max(0,Math.ceil((end-Date.now()-serverOffsetMs)/1000)) : 0;
    $('timer').textContent = String(left);
    if (left === 0 && !changing && Date.now() >= nextDueRetry) {
      nextDueRetry = Date.now()+1500;
      void hostCommand('auto-reveal');
    }
  }
  setInterval(updateTimer, 250);

  function sorted(input, key='score') {
    return (Array.isArray(input) ? input : []).slice()
      .sort((a,b) => (Number(b[key])||0)-(Number(a[key])||0) ||
        identity.compare(String(a.nickname||''),String(b.nickname||'')));
  }
  function renderRanking(s) {
    cancelAnimation();
    show('ranking-screen');
    const players = sorted(s.scores);
    const previous = sorted(s.scores,'previous_score');
    const prev = new Map(previous.map((p,i)=>[p.nickname,{rank:i+1,score:p.previous_score||0}]));
    const top = players.slice(0,8);
    const board = $('board');
    board.replaceChildren();
    board.style.height = Math.max(1,top.length)*78+'px';
    $('other-players').textContent = players.length>8?'Y '+(players.length-8)+' participantes más':'';
    $('next').textContent = s.index+1>=s.count?'Ver podio final 🏆':'Siguiente pregunta ▶';
    const rendered=top.map((p,i)=>{
      const node=document.createElement('div');node.className='rank-row';
      const old=prev.get(p.nickname)||{rank:9,score:0};
      const n=document.createElement('span');n.className='rank-pos';n.textContent=old.rank<=8?old.rank:'';
      const name=document.createElement('span');name.className='rank-name';name.textContent=avatar(p.nickname)+' '+p.nickname;
      const gain=document.createElement('span');gain.className='rank-gain';gain.textContent=p.score>old.score?'+'+nformat(p.score-old.score):'';
      const points=document.createElement('span');points.className='rank-score';points.textContent=nformat(old.score);
      node.append(n,name,gain,points);board.append(node);
      node.style.transform='translateY('+(Math.min(old.rank-1,8)*78)+'px)';
      return {node,n,points,p,i};
    });
    later(350,()=>{
      if (!reduce() && typeof Sound !== 'undefined') Sound.whoosh();
      for(const entry of rendered){
        entry.node.style.transform='translateY('+(entry.i*78)+'px)';
        entry.node.style.opacity='1';
        entry.n.textContent=String(entry.i+1);
        entry.points.textContent=nformat(entry.p.score);
      }
    });
  }
  function renderPodium(s) {
    cancelAnimation();
    show('podium-screen');
    const scores=sorted(s.scores);
    $('podium-title').textContent=scores.length?'Y el ganador es…':'¡Fin de la partida!';
    const stage=$('stage');stage.replaceChildren();
    const items=[1,0,2].filter(i=>scores[i]).map(i=>{
      const p=scores[i];const place=document.createElement('div');place.className='place place-'+(i+1);
      const face=document.createElement('div');face.className='avatar';face.textContent=avatar(p.nickname)+['🥇','🥈','🥉'][i];
      const name=document.createElement('div');name.className='place-name';name.textContent=p.nickname;
      const points=document.createElement('div');points.className='place-score';points.textContent=nformat(p.score)+' puntos';
      const pedestal=document.createElement('div');pedestal.className='pedestal';pedestal.textContent=String(i+1);
      place.append(face,name,points,pedestal);stage.append(place);return {i,place};
    });
    const pop=i=>{const it=items.find(x=>x.i===i);if(it){it.place.classList.add('show');if(!reduce()&&typeof Sound!=='undefined')Sound.pop();}};
    if (!reduce() && typeof Sound!=='undefined' && scores.length)Sound.drumroll(2.2);
    later(2200,()=>pop(2));later(3700,()=>pop(1));
    later(5900,()=>{
      pop(0);
      if(scores[0])$('podium-title').textContent='🏆 ¡Enhorabuena, '+scores[0].nickname+'!';
      if(!reduce()){
        if(typeof Sound!=='undefined')Sound.fanfare();
        if(typeof confetti==='function')confetti({duration:4500,count:180,colors:['#6989e6','#efa6a4','#f2bc38','#ffffff']});
      }
    });
  }

  async function refresh(force=false) {
    if (!token || busy || !uuid.test(roomId)) return;
    busy=true;
    try {
      const s=await request('presenter');
      if (!s?.ok) throw Error('presenter_not_ready');
      serverOffsetMs = Date.parse(s.server_time)-Date.now();
      lastState=s;
      status(s.status === 'open' ? 'Conectado · Sala '+s.pin : 'La sala está cerrada.',s.status !== 'open');
      const phaseKey=s.phase+':'+s.index;
      if (phaseKey !== statePhase || force) {
        if (phaseKey !== statePhase) cancelAnimation();
        statePhase=phaseKey;
        if(s.phase==='lobby') renderLobby(s);
        else if(s.phase==='question') renderQuestion(s);
        else if(s.phase==='reveal') {renderQuestion(s);reveal(s);}
        else if(s.phase==='finished') renderPodium(s);
      }
      if(s.phase==='lobby') renderLobby(s);
      if(s.phase==='question'){
        $('responses').textContent=s.answered_count+' de '+s.player_count+' respuestas';
        updateTimer();
      }
      if(s.phase==='reveal' && view==='question-screen'){
        $('responses').textContent=s.answered_count+' de '+s.player_count+' respuestas';
      }
      if(s.phase==='finished' && view!=='podium-screen')renderPodium(s);
    } catch (e) {
      status('Conexión interrumpida: '+String(e.message)+'. Reintentando…',true);
    } finally {busy=false;}
  }
  setInterval(()=>{if(!document.hidden)void refresh();},1000);
  setInterval(()=>{if(!token)authorize();},4000);
})();