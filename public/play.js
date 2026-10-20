const socket = io();
const params = new URLSearchParams(location.search);
let pin = params.get('pin') || '';
let me = null;

loadBranding(pin);

// Guardamos el id por sala para que, si el móvil recarga o se bloquea, recupere su nombre y puntos.
const storeKey = (p) => `quiz-player-${p}`;
const savedId = (p) => { try { return sessionStorage.getItem(storeKey(p)); } catch { return null; } };
const saveId = (p, id) => { try { sessionStorage.setItem(storeKey(p), id); } catch {} };

function setFeedback(html, cls = '') {
  const v = $('#v-feedback');
  v.className = `view ${cls}`;
  $('#feedback').innerHTML = html;
  show('v-feedback');
}

function updateStatus(score) {
  $('#st-name').textContent = `${me.emoji} ${me.name}`;
  if (score !== undefined) $('#st-score').textContent = score;
  $('#status').classList.remove('hidden');
}

function join() {
  socket.emit('player:join', { pin, playerId: savedId(pin) }, (res) => {
    if (res.error) {
      $('#join-error').textContent = res.error;
      $('#join-error').classList.remove('hidden');
      return show('v-join');
    }
    me = res;
    saveId(pin, res.playerId);
    loadBranding(pin);
    $('#emoji').textContent = res.emoji;
    $('#nick').textContent = res.name;
    $('#rename').classList.toggle('hidden', res.state !== 'lobby');
    $('#wait-msg').textContent = res.state === 'lobby'
      ? 'Mira la pantalla, la partida empezará enseguida.'
      : 'Te has unido. Espera a la siguiente pregunta.';
    updateStatus(res.score);
    show('v-wait');
  });
}

$('#join').onclick = () => { pin = $('#pin').value.trim(); join(); };
$('#pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#join').click(); });

$('#rename').onclick = () => socket.emit('player:rename', null, (res) => {
  if (res.error) return;
  Object.assign(me, res);
  $('#emoji').textContent = res.emoji;
  $('#nick').textContent = res.name;
  updateStatus();
});

// Al (re)conectar el socket, volvemos a entrar en la sala automáticamente.
socket.on('connect', () => { if (pin) join(); else $('#pin').focus(); });

socket.on('question:show', (q) => {
  $('#a-counter').textContent = `Pregunta ${q.index + 1} de ${q.total}`;
  $('#a-text').classList.toggle('hidden', !q.text);
  $('#a-text').textContent = q.text || '';
  $('#answers').innerHTML = q.options.map((o, i) =>
    `<button class="answer c${i} ${o ? 'has-text' : ''}" data-i="${i}">
       <span class="shape">${SHAPES[i]}</span>${escapeHtml(o)}</button>`).join('');
  show('v-answer');
});

$('#answers').onclick = (e) => {
  const btn = e.target.closest('.answer');
  if (!btn) return;
  document.querySelectorAll('#answers .answer').forEach((b) => { b.disabled = true; });
  if (navigator.vibrate) navigator.vibrate(30);
  socket.emit('player:answer', { choice: Number(btn.dataset.i) }, (res) => {
    if (res.error) return setFeedback('<h2>¡Tiempo agotado!</h2>');
    setFeedback(`<div class="big-emoji">${SHAPES[btn.dataset.i]}</div><h2>¡Respuesta enviada!</h2><p class="muted">¿Habrás acertado?</p>`);
  });
};

socket.on('question:result', (r) => {
  updateStatus(r.score);
  const why = r.explanation ? `<p class="why">💡 ${escapeHtml(r.explanation)}</p>` : '';
  if (!r.scored) {
    return setFeedback(r.answered
      ? `<div class="big-emoji">🙌</div><h2>¡Gracias por tu respuesta!</h2>${why}`
      : `<div class="big-emoji">⏰</div><h2>No has respondido</h2>${why}`);
  }
  const solution = !r.correct && r.correctOptions.length
    ? `<p>Correcta: <strong>${r.correctOptions.map(escapeHtml).join(' / ')}</strong></p>` : '';
  // Puesto actual y, si ha cambiado, cuántos se sube o se baja.
  const diff = r.prevPosition ? r.prevPosition - r.position : 0;
  const moved = diff > 0 ? ` <span class="move up">▲ Subes ${diff} ${diff === 1 ? 'puesto' : 'puestos'}</span>`
    : diff < 0 ? ` <span class="move down">▼ Bajas ${-diff} ${diff === -1 ? 'puesto' : 'puestos'}</span>` : '';
  const pos = `<p>Vas en el puesto <strong>${r.position}</strong>${moved}</p>`;
  if (!r.answered) {
    return setFeedback(`<div class="big-emoji">⏰</div><h2>Sin respuesta</h2>${solution}${why}${pos}`, 'result-ko');
  }
  setFeedback(r.correct
    ? `<div class="big-emoji">✅</div><h2>¡Correcto!</h2><div class="nick">+${r.points}</div>${why}${pos}`
    : `<div class="big-emoji">❌</div><h2>Incorrecto</h2>${solution}${why}${pos}`,
    r.correct ? 'result-ok' : 'result-ko');
});

// Al terminar, el móvil espera a que el podio se revele en pantalla para no destripar el resultado.
socket.on('game:end', ({ score, position, total, revealIn = 0 }) => {
  setFeedback('<div class="big-emoji drum">🥁</div><h2>¡Mira la pantalla!</h2><p class="muted">Vamos a conocer el podio…</p>');
  setTimeout(() => {
    const medal = ['🥇', '🥈', '🥉'][position - 1];
    setFeedback(`<div class="big-emoji ${medal ? 'winner' : ''}">${medal || '🎉'}</div>
      <h2>${medal ? '¡Estás en el podio!' : `Puesto ${position} de ${total}`}</h2>
      ${medal ? `<p>Puesto ${position} de ${total}</p>` : ''}
      <div class="nick">${score} puntos</div><p class="muted">¡Gracias por participar!</p>`);
    if (medal) confetti({ duration: 4000, count: 140 });
  }, Math.max(0, revealIn - 2300)); // coincide con la aparición del 1.º en pantalla
});

socket.on('kicked', () => { pin = ''; setFeedback('<h2>Has salido de la sala</h2>'); });
socket.on('room:closed', () => { pin = ''; setFeedback('<h2>La sesión ha terminado</h2><p class="muted">El presentador ha cerrado la sala.</p>'); });

if (pin) $('#pin').value = pin;
