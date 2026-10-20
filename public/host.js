const socket = io();
let room = null;
let currentQuestion = null;
let countdown = null;

loadBranding();
document.body.dataset.view = 'v-setup';

// Previsualiza la marca del proyecto elegido mientras se prepara la sesión.
async function previewProject() {
  const res = await fetch(`/api/branding?project=${encodeURIComponent($('#project').value)}`);
  applyBranding(await res.json());
}

socket.emit('host:init', null, (res) => {
  if (res.error) return showSetupError('Esta pantalla solo funciona desde el ordenador que hace de servidor.');
  $('#quiz').innerHTML = res.quizzes.map((q) =>
    `<option value="${escapeHtml(q.id)}" data-project="${escapeHtml(q.project || '')}" ${q.ready ? '' : 'disabled'}>
      ${escapeHtml(q.title)} (${q.count} preguntas)${q.ready ? '' : ' — incompleto, revísalo en el editor'}</option>`).join('');
  const firstReady = res.quizzes.find((q) => q.ready);
  if (firstReady) $('#quiz').value = firstReady.id;
  $('#project').innerHTML = res.projects.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
  $('#address').innerHTML = `<optgroup label="Misma red Wi-Fi que este ordenador">${res.addresses.map((a) =>
    `<option value="${a.address}">${escapeHtml(a.name)} — ${a.address}</option>`).join('')}</optgroup>
    <optgroup label="Desde cualquier red"><option value="internet">🌐 Internet (datos móviles o cualquier Wi-Fi)</option></optgroup>
    <optgroup label="Pruebas"><option value="localhost">Solo este equipo</option></optgroup>`;
  // Se recuerda la última elección de red.
  try {
    const last = localStorage.getItem('quiz-address');
    if (last && [...$('#address').options].some((o) => o.value === last)) $('#address').value = last;
  } catch {}
  addressHint();
  if (res.update) {
    $('#update').innerHTML = `🎉 Hay una versión nueva (${escapeHtml(res.update.version)}).
      <a href="${escapeHtml(res.update.url)}" target="_blank" rel="noopener">Ver cómo actualizar</a>`;
    $('#update').classList.remove('hidden');
  }
  $('#data-dir').textContent = `Versión ${res.version} · Tus datos se guardan en ${res.dataDir}`;
  if (!res.quizzes.length) showSetupError('Aún no hay cuestionarios. Créalos en el editor.');
  if (!res.projects.length) showSetupError('Crea primero un proyecto en «Gestionar proyectos».');
  selectQuizProject();
});

// Si el cuestionario indica su proyecto, se preselecciona.
function selectQuizProject() {
  const p = $('#quiz').selectedOptions[0]?.dataset.project;
  if (p && [...$('#project').options].some((o) => o.value === p)) $('#project').value = p;
  previewProject();
}
$('#quiz').onchange = selectQuizProject;
$('#project').onchange = previewProject;

function addressHint() {
  const v = $('#address').value;
  $('#address-hint').textContent = v === 'internet'
    ? 'Los asistentes podrán entrar desde cualquier red. La dirección es temporal y desaparece al cerrar la aplicación.'
    : v === 'localhost' ? 'Solo para probar en este ordenador: los móviles no podrán entrar.'
      : 'Los asistentes deben estar conectados a la misma red Wi-Fi que este ordenador.';
}
$('#address').onchange = () => {
  addressHint();
  try { localStorage.setItem('quiz-address', $('#address').value); } catch {}
};

function showSetupError(msg) {
  const el = $('#setup-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

$('#create').onclick = () => {
  const payload = { quizId: $('#quiz').value, projectId: $('#project').value, address: $('#address').value };
  const btn = $('#create');
  btn.disabled = true;
  btn.textContent = payload.address === 'internet' ? 'Conectando a internet… (unos segundos)' : 'Creando sala…';
  $('#setup-error').classList.add('hidden');
  socket.emit('host:create', payload, (res) => {
    btn.disabled = false;
    btn.textContent = 'Crear sala';
    if (res.error) return showSetupError(res.error);
    room = res;
    applyBranding(res.branding);
    $('#qr').src = res.qr;
    $('#pin').textContent = res.pin;
    $('#join-url').textContent = res.joinUrl;
    $('#quiz-title').textContent = res.title;
    $('#csv').href = `/api/results/${res.pin}.csv?key=${res.hostKey}`;
    $('#show-cover').classList.toggle('hidden', !res.branding.cover);
    if (res.branding.cover) {
      $('#cover').src = res.branding.cover;
      show('v-cover');
    } else {
      show('v-lobby');
    }
  });
};

// Portada: clic, Enter o espacio para pasar a la sala; botón para volver a ella.
$('#v-cover').onclick = () => show('v-lobby');
$('#show-cover').onclick = () => show('v-cover');
document.addEventListener('keydown', (e) => {
  if (document.body.dataset.view === 'v-cover' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); show('v-lobby'); }
  // F: pantalla completa (útil al proyectar)
  if (e.key.toLowerCase() === 'f' && !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();
  }
});

socket.on('room:players', (players) => {
  $('#player-count').textContent = `${players.length} ${players.length === 1 ? 'participante' : 'participantes'}`;
  $('#players').innerHTML = players.map((p) =>
    `<span class="chip ${p.connected ? '' : 'off'}" data-id="${p.id}" title="Expulsar">${p.emoji} ${escapeHtml(p.name)}</span>`).join('');
  $('#start').disabled = players.length === 0;
});

$('#players').onclick = (e) => {
  const chip = e.target.closest('.chip');
  if (chip && confirm(`¿Expulsar a ${chip.textContent.trim()}?`)) socket.emit('host:kick', chip.dataset.id);
};

$('#start').onclick = () => socket.emit('host:next', { from: 'lobby' });
$('#skip').onclick = () => socket.emit('host:next', { from: 'question' });
$('#to-ranking').onclick = () => socket.emit('host:next', { from: 'reveal' });
$('#next').onclick = () => socket.emit('host:next', { from: 'leaderboard' });

socket.on('question:show', (q) => {
  currentQuestion = q;
  show('v-question');
  $('#q-counter').textContent = `Pregunta ${q.index + 1} de ${q.total}`;
  $('#q-text').textContent = q.text;
  $('#answered').textContent = '0';
  $('#q-media').innerHTML = mediaHtml(q.media, { autoplay: true });
  $('#q-media').classList.toggle('hidden', !q.media);
  $('#q-badge').textContent = q.type === 'poll' ? '📊 Encuesta' : q.points === 2 ? '⭐ Puntos dobles' : q.points === 0 ? 'Sin puntos' : '';
  $('#explanation').classList.add('hidden');
  $('#v-question').classList.remove('with-expl');
  $('#bars').classList.add('hidden');
  $('#reveal-actions').classList.add('hidden');
  $('#skip').classList.remove('hidden');
  $('#q-answers').innerHTML = q.options.map((o, i) =>
    `<div class="answer c${i}"><span class="shape">${SHAPES[i]}</span>${escapeHtml(o)}</div>`).join('');

  clearInterval(countdown);
  const end = Date.now() + q.time * 1000;
  const tick = () => {
    const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    $('#timer').textContent = left;
    if (!left) clearInterval(countdown);
  };
  tick();
  countdown = setInterval(tick, 250);
});

socket.on('question:answerCount', ({ answered }) => { $('#answered').textContent = answered; });

socket.on('question:reveal', ({ scored, correct, distribution, explanation }) => {
  clearInterval(countdown);
  $('#timer').textContent = '✓';
  $('#skip').classList.add('hidden');
  Sound.reveal();
  // Al revelar se para el vídeo para que no tape la explicación.
  $('#q-media').querySelectorAll('video').forEach((v) => v.pause());
  const max = Math.max(1, ...distribution);
  const bars = $('#bars');
  bars.innerHTML = distribution.map((n, i) =>
    `<div class="vbar c${i}" style="height:${15 + (n / max) * 85}%">${n}${correct.includes(i) ? ' ✓' : ''}</div>`).join('');
  bars.classList.remove('hidden');
  if (scored) {
    document.querySelectorAll('#q-answers .answer').forEach((el, i) => {
      el.classList.toggle('right', correct.includes(i));
      el.classList.toggle('dim', !correct.includes(i));
    });
  }
  // La explicación ocupa en grande el hueco del multimedia, con la respuesta correcta como titular.
  if (explanation) {
    const right = correct.map((i) => currentQuestion.options[i]).join(' / ');
    $('#explanation').innerHTML = `${scored ? `<div class="expl-answer">✅ ${escapeHtml(right)}</div>` : ''}
      <div class="expl-text">💡 ${escapeHtml(explanation)}</div>`;
    $('#q-media').querySelectorAll('iframe').forEach((f) => f.remove()); // detiene YouTube
    $('#q-media').classList.add('hidden');
  }
  $('#explanation').classList.toggle('hidden', !explanation);
  $('#v-question').classList.toggle('with-expl', !!explanation);
  $('#reveal-actions').classList.remove('hidden');
});

// ---------- Clasificación animada ----------
// Cada fila empieza en su puesto anterior y se desliza al nuevo mientras los puntos suben.

const ROW = 84; // alto de fila + separación, en px
const TOP = 5;

socket.on('leaderboard', ({ top, leaving, last }) => {
  $('#next').textContent = last ? 'Ver resultados finales 🏆' : 'Siguiente pregunta ▶';
  show('v-ranking');
  const board = $('#ranking');
  const rows = [...top, ...leaving.map((r) => ({ ...r, out: true }))];
  board.style.height = `${Math.max(top.length, 1) * ROW}px`;
  board.innerHTML = rows.map((r) => {
    const move = r.prevPosition ? r.prevPosition - r.position : 0;
    const arrow = move > 0 ? `<span class="up">▲${move}</span>` : move < 0 ? `<span class="down">▼${-move}</span>` : '';
    const gain = r.score - r.prevScore;
    return `<div class="rrow" role="listitem" data-id="${r.id}">
      <span class="rpos">${r.prevPosition && r.prevPosition <= TOP ? r.prevPosition : ''}</span>
      <span class="rname">${r.emoji} ${escapeHtml(r.name)}</span>
      <span class="rmove">${arrow}</span>
      <span class="rgain">${gain > 0 ? `+${gain}` : ''}</span>
      <span class="rscore">${r.prevScore}</span>
    </div>`;
  }).join('');

  const els = [...board.children];
  const slotOf = (r, final) => (final ? (r.out ? TOP : r.position - 1)
    : r.prevPosition && r.prevPosition <= TOP ? r.prevPosition - 1 : TOP);
  const place = (el, r, final) => {
    const slot = slotOf(r, final);
    el.style.transform = `translateY(${slot * ROW}px)`;
    el.style.opacity = slot >= TOP ? 0 : 1;
  };
  rows.forEach((r, i) => place(els[i], r, false));

  const finish = () => rows.forEach((r, i) => {
    const el = els[i];
    el.classList.add('moving');
    el.style.transitionDelay = r.prevPosition ? '0ms' : `${(r.position - 1) * 120}ms`; // los nuevos entran en cascada
    place(el, r, true);
    el.querySelector('.rpos').textContent = r.out ? '' : r.position;
    countUp(el.querySelector('.rscore'), r.prevScore, r.score, 1100);
    el.classList.add('done');
  });
  if (reducedMotion()) return finish();
  setTimeout(() => { Sound.whoosh(); finish(); }, 700);
});

// ---------- Podio ----------

let lastEnd = null;
let podiumTimers = [];

const MEDALS = ['🥇', '🥈', '🥉'];

function runPodium({ ranking }) {
  podiumTimers.forEach(clearTimeout);
  podiumTimers = [];
  show('v-podium');
  const at = (ms, fn) => podiumTimers.push(setTimeout(fn, reducedMotion() ? 0 : ms));
  const title = $('#podium-title');
  title.textContent = ranking.length ? 'Y el ganador es…' : 'Fin de la partida';

  // Orden visual 2-1-3, como un podio real.
  const order = [1, 0, 2].filter((i) => ranking[i]);
  $('#stage').innerHTML = order.map((i) => {
    const p = ranking[i];
    return `<div class="place place-${i + 1}" data-place="${i + 1}">
      <div class="avatar"><span class="animal">${p.emoji}</span><span class="medal">${MEDALS[i]}</span></div>
      <div class="pname">${escapeHtml(p.name)}</div>
      <div class="pscore">${p.score} puntos</div>
      <div class="pedestal"><span>${i + 1}</span></div>
    </div>`;
  }).join('');
  $('#podium-actions').classList.add('hidden');

  const reveal = (n) => {
    const el = $(`#stage [data-place="${n}"]`);
    if (!el) return;
    el.classList.add('show');
    Sound.pop();
  };
  Sound.drumroll(2.4);
  at(2500, () => reveal(3));
  at(4300, () => reveal(2));
  at(4800, () => Sound.drumroll(2.3));
  at(7200, () => {
    reveal(1);
    if (ranking[0]) title.textContent = `🏆 ¡Enhorabuena, ${ranking[0].name}!`;
    Sound.fanfare();
    confetti({ duration: 5000 });
    document.querySelectorAll('#stage .place.show:not(.place-1)').forEach((el) => el.classList.add('celebrate'));
  });
  at(8400, () => $('#stage .place-1')?.classList.add('celebrate')); // tras «aterrizar»
  at(9500, () => $('#podium-actions').classList.remove('hidden'));
}

$('#replay-podium').onclick = () => lastEnd && runPodium(lastEnd);
$('#to-stats').onclick = () => show('v-end');
$('#back-podium').onclick = () => {
  show('v-podium');
  document.querySelectorAll('#stage .place').forEach((el) => el.classList.add('show', 'celebrate'));
  $('#podium-actions').classList.remove('hidden');
};

// ---------- Sonido ----------

function paintSound() {
  $('#sound').textContent = Sound.enabled ? '🔊' : '🔇';
}
$('#sound').onclick = () => { Sound.toggle(); paintSound(); };
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'm' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    Sound.toggle();
    paintSound();
  }
});
paintSound();

socket.on('game:end', (end) => {
  lastEnd = end;
  const { stats } = end;
  runPodium(end);
  $('#stats').innerHTML = '<tr><th>#</th><th>Pregunta</th><th>Resultado</th><th></th></tr>' + stats.map((s) => {
    if (s.poll) {
      const total = s.votes.reduce((a, v) => a + v.count, 0) || 1;
      const top = s.votes.reduce((a, v) => (v.count > a.count ? v : a), s.votes[0]);
      return `<tr><td>${s.index + 1}</td><td>${escapeHtml(s.text)} <span class="muted">· encuesta</span></td>
        <td>Más votada: ${escapeHtml(top.option)} (${Math.round((top.count / total) * 100)}%)</td>
        <td><div class="pollbar">${s.votes.map((v, i) => `<span class="c${i}" style="flex:${v.count}" title="${escapeHtml(v.option)}: ${v.count}"></span>`).join('')}</div></td></tr>`;
    }
    return `<tr><td>${s.index + 1}</td><td>${escapeHtml(s.text)}</td><td>${s.pct}% de acierto (${s.correct}/${s.players})</td>
      <td><div class="meter"><span style="width:${s.pct}%"></span></div></td></tr>`;
  }).join('');
});

window.addEventListener('beforeunload', (e) => {
  if (room) { e.preventDefault(); e.returnValue = ''; }
});
