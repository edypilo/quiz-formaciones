'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const invitation = params.get('invite') || '';
  const initialPin = params.get('pin') || '';
  $('pin').value = /^[0-9]{6}$/.test(initialPin) ? initialPin : '';
  $('qr-instructions').hidden = !(/^[0-9]{6}$/.test(initialPin) && invitation);
  $('pin').readOnly = !!(/^[0-9]{6}$/.test(initialPin) && invitation);
  function assignNewName() {
    const generate = window.QuizzzNames?.generateName;
    if (typeof generate !== 'function') {
      $('name-display').textContent = 'No se pueden generar nombres.';
      $('join-button').disabled = true;
      return;
    }
    const current = $('nickname').value;
    let candidate = generate();
    for (let i = 0; i < 10 && candidate.name === current; i++) candidate = generate();
    $('nickname').value = candidate.name;
    $('name-display').textContent = candidate.emoji + ' ' + candidate.name;
    message('join-status', '');
  }
  $('shuffle-name').addEventListener('click', assignNewName);
  let settings = null;
  let token = '';
  let nickname = '';
  let polling = null;
  let realtime = null;
  let checkBusy = false;
  let checkAgain = false;
  let fallbackTicks = 0;
  function ensureRealtime() {
    if (!settings || !token || !window.QuizzzGuestRealtime) return;
    if (!realtime) {
      realtime = window.QuizzzGuestRealtime.createGuestRealtime({
        rpc, config: settings,
        onChange: () => void checkRoom(),
        onStatus: (mode) => {
          $('guest-connection-mode').textContent = mode === 'live'
            ? '● En directo' : mode === 'connecting' ? '◌ Conectando…'
              : mode === 'off' ? '' : '◌ Sincronización de respaldo';
        },
      });
    }
    realtime.start(token);
  }
  let currentQuestionKey = '';
  let answerSubmitting = false;
  let deadline = 0;
  let lastGamePhase = '';
  let feedbackCompletedKey = '';
  let feedbackPendingKey = '';
  let feedbackSequence = 0;
  let presenceConfirmedKey = '';
  let finalLoadStarted = false;
  let lastStanding = null;
  const shapes = ['▲','◆','●','■'];
  const encouragements = Object.freeze([
    '¡Casi! La próxima puede ser la tuya.',
    '¡Sigue jugando, que aún queda partida!',
    '¡Buen intento! A por la siguiente.',
    '¡Ni los mejores aciertan siempre!',
    '¡Cada pregunta es una nueva oportunidad!',
    '¡No te rindas! La remontada empieza ahora.',
  ]);
  const positiveMessages = Object.freeze([
    '¡Tu cerebro está en modo turbo!',
    '¡Respuesta brillante! Sigue así.',
    '¡Lo has clavado!',
    '¡Menuda jugada! A por la siguiente.',
    '¡Imparable! Has dado en el blanco.',
  ]);
  const absentMessages = Object.freeze([
    '¿Sigues ahí? ¡Te esperamos en la próxima!',
    '¡Eh, explorador! ¿Todo bien por ahí?',
    'No pasa nada, ¡todavía puedes remontar!',
    '¿Te hemos pillado despistado? ¡Vuelve al juego!',
  ]);
  const choose = (values) => values[Math.floor(Math.random() * values.length)];

  const storageKey = 'quizzz_lobby_preview';
  const message = (id, text, type = '') => {
    const node = $(id);
    node.textContent = text;
    node.dataset.type = type;
  };
  assignNewName();
  async function rpc(name, payload) {
    if (!settings) throw new Error('not_configured');
    const response = await fetch(settings.supabaseUrl + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: settings.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('rpc_unavailable');
    return response.json();
  }
  function clearPolling() {
    if (polling !== null) clearInterval(polling);
    polling = null;
  }
  function closeSession() {
    clearPolling();
    realtime?.stop();
    token = '';
    nickname = '';
    sessionStorage.removeItem(storageKey);
    $('waiting-section').hidden = true;
    $('guest-game').hidden = true;
    currentQuestionKey = '';
    lastGamePhase = '';
    finalLoadStarted = false;
    lastStanding = null;
    $('guest-final').hidden = true;
    resetPersonalFeedback();
    $('join-section').hidden = false;
  }


  function resetPersonalFeedback() {
    feedbackSequence++;
    feedbackCompletedKey = '';
    feedbackPendingKey = '';
    presenceConfirmedKey = '';
    $('guest-feedback-standing').hidden = true;
    $('guest-feedback-standing').textContent = '';
    $('guest-feedback').hidden = true;
    $('guest-feedback').removeAttribute('data-outcome');
    $('guest-feedback-present').hidden = true;
    $('guest-feedback-next').textContent = 'Esperando la siguiente pregunta…';
  }
  function drawPersonalFeedback(data, key) {
    const outcome = data.outcome;
    if (!['correct', 'incorrect', 'unanswered', 'participated'].includes(outcome)) return false;
    const points = Number(data.points);
    if (!Number.isSafeInteger(points) || points < 0) return false;
    const themes = {
      correct: ['🎉', '¡Has acertado!', choose(positiveMessages)],
      incorrect: ['💪', '¡Buen intento!', choose(encouragements)],
      unanswered: ['👀', '¿Sigues ahí?', choose(absentMessages)],
      participated: ['🙌', '¡Gracias por participar!', '¡Tu opinión cuenta! Vamos con la siguiente.'],
    };
    const [icon, title, msg] = themes[outcome];
    $('guest-feedback-icon').textContent = icon;
    $('guest-feedback-title').textContent = title;
    $('guest-feedback-message').textContent = msg;
    $('guest-feedback-points').textContent = points > 0
      ? '+' + points.toLocaleString('es-ES') + ' puntos'
      : outcome === 'participated' ? 'Encuesta sin puntuación' : '0 puntos en esta pregunta';
    $('guest-feedback').dataset.outcome = outcome;
    const presence = $('guest-feedback-present');
    presence.hidden = outcome !== 'unanswered';
    $('guest-feedback-next').textContent = 'Esperando la siguiente pregunta…';
    presence.textContent = '¡Aquí sigo! 🙌';
    $('guest-feedback').hidden = false;
    feedbackCompletedKey = key;
    return true;
  }
  $('guest-feedback-present').addEventListener('click', () => {
    presenceConfirmedKey = feedbackCompletedKey;
    $('guest-feedback-present').hidden = true;
    $('guest-feedback-title').textContent = '¡Ahí estás! 🙌';
    $('guest-feedback-message').textContent = '¡Genial! Te esperamos en la próxima pregunta.';
  });
  async function loadPersonalFeedback(index) {
    const key = String(index) + ':reveal';
    if (!token || feedbackCompletedKey === key || feedbackPendingKey === key) return;
    feedbackPendingKey = key;
    const sequence = ++feedbackSequence;
    $('guest-feedback').hidden = false;
    $('guest-feedback').dataset.outcome = 'loading';
    $('guest-feedback-icon').textContent = '⏳';
    $('guest-feedback-title').textContent = 'Calculando tu resultado…';
    $('guest-feedback-message').textContent = 'Comprobando tu respuesta.';
    $('guest-feedback-points').textContent = '';
    $('guest-feedback-present').hidden = true;
    try {
      const result = await rpc('quiz_guest_feedback', { p_token: token });
      if (sequence !== feedbackSequence || currentQuestionKey !== key) return;
      if (!result?.ok || result.index !== index || !drawPersonalFeedback(result, key))
        throw new Error('feedback_not_ready');
      await loadPersonalStanding();
    } catch {
      if (sequence === feedbackSequence && currentQuestionKey === key) {
        $('guest-feedback').dataset.outcome = 'loading';
        $('guest-feedback-icon').textContent = '🔄';
        $('guest-feedback-title').textContent = 'Consultando tu resultado…';
        $('guest-feedback-message').textContent = 'La conexión no ha respondido. Lo intentaremos de nuevo.';
        $('guest-feedback-points').textContent = '';
      }
    } finally {
      if (feedbackPendingKey === key) feedbackPendingKey = '';
    }
  }


  async function loadPersonalStanding() {
    if (!token) return;
    try {
      const standing = await rpc('quiz_guest_standing', { p_token: token });
      if (!standing?.ok || !currentQuestionKey.endsWith(':reveal')) return;
      lastStanding = standing;
      const change = Number(standing.previous_position) - Number(standing.position);
      const moved = change > 0 ? ' ▲ Has subido ' + change + ' puesto(s).'
        : change < 0 ? ' ▼ Has bajado ' + Math.abs(change) + ' puesto(s).' : '';
      $('guest-feedback-standing').textContent =
        'Vas en el puesto ' + standing.position + ' de ' + standing.total +
        ' · ' + Number(standing.score).toLocaleString('es-ES') + ' puntos.' + moved;
      $('guest-feedback-standing').hidden = false;
    } catch {
      // El feedback por pregunta funciona independientemente del puesto personal.
    }
  }
  async function loadFinalStanding() {
    if (finalLoadStarted) return;
    finalLoadStarted = true;
    $('guest-final').hidden = false;
    $('guest-final-title').textContent = '¡Mira la pantalla!';
    $('guest-final-emoji').textContent = '🥁';
    $('guest-final-score').textContent = '';
    $('guest-final-description').textContent = 'Vamos a conocer el podio…';
    try {
      const standing = await rpc('quiz_guest_standing', { p_token: token });
      if (!standing?.ok) throw new Error('standing_unavailable');
      lastStanding = standing;
      setTimeout(() => {
        if (!token || $('guest-final').hidden) return;
        const place = Number(standing.position);
        const medal = ['🥇','🥈','🥉'][place - 1];
        $('guest-final-emoji').textContent = medal || '🎉';
        $('guest-final-title').textContent = medal ? '¡Estás en el podio!' : '¡Partida terminada!';
        $('guest-final-description').textContent =
          'Puesto ' + place + ' de ' + standing.total + '. ¡Gracias por participar!';
        $('guest-final-score').textContent = Number(standing.score).toLocaleString('es-ES') + ' puntos';
      }, 4800);
    } catch {
      finalLoadStarted = false;
      $('guest-final-title').textContent = 'Clasificación pendiente';
      $('guest-final-description').textContent = 'Volveremos a intentar recuperar tu puesto.';
    }
  }

  function renderGame(state) {
    const phase = state.game_phase || 'lobby';
    const question = state.question;
    $('guest-game').hidden = !question || !['question', 'reveal'].includes(phase);
    if (phase === 'finished') {
      if (currentQuestionKey !== 'finished') {
        currentQuestionKey = 'finished';
        resetPersonalFeedback();
      }
      $('waiting-text').textContent = '¡Partida terminada! Gracias por participar.';
      void loadFinalStanding();
      return;
    }
    if (finalLoadStarted || !$('guest-final').hidden) {
      finalLoadStarted = false;
      $('guest-final').hidden = true;
    }
    if (!question) {
      if (phase === 'lobby') $('waiting-text').textContent = 'Esperando al formador…';
      return;
    }
    $('waiting-text').textContent = phase === 'question'
      ? '¡Elige una respuesta!' : 'Resultado de la pregunta';
    $('guest-question-step').textContent = 'Pregunta ' + (question.index + 1) + ' de ' + question.count;
    $('guest-question-text').textContent = question.text;
    const key = question.index + ':' + phase;
    const fresh = currentQuestionKey !== key;
    if (fresh) {
      currentQuestionKey = key;
      $('guest-question-options').replaceChildren();
      resetPersonalFeedback();
    }
    const revealing = phase === 'reveal';
    $('guest-question-text').hidden = revealing;
    $('guest-question-time').hidden = revealing;
    $('guest-question-options').hidden = revealing;
    $('guest-question-message').hidden = revealing;
    deadline = question.ends_at ? Date.parse(question.ends_at) : 0;
    if (revealing) {
      if (feedbackCompletedKey !== key) void loadPersonalFeedback(question.index);
      return;
    }
    if (fresh) {
      const answers = $('guest-question-options');
      (question.options || []).forEach((option, index) => {
        if (!option) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'c' + (index % 4);
        button.dataset.index = String(index);
        const shape = document.createElement('span');
        shape.className = 'shape';
        shape.textContent = shapes[index % 4];
        const content = document.createElement('span');
        content.textContent = option;
        button.append(shape, content);
        if (phase === 'reveal' && question.correct?.includes(index)) button.classList.add('correct');
        if (phase !== 'question' || state.answered) button.disabled = true;
        button.addEventListener('click', () => void submitAnswer(index));
        answers.append(button);
      });
    }
    if (!state.answered && phase === 'question' && !answerSubmitting &&
        (!deadline || Date.now() < deadline)) {
      $('guest-question-options').querySelectorAll('button').forEach(button => {
        button.disabled = false;
        button.classList.remove('selected');
      });
    }
    if (state.answered) {
      $('guest-question-options').querySelectorAll('button').forEach(button => { button.disabled = true; });
      message('guest-question-message', phase === 'question'
        ? 'Respuesta recibida. Esperando al resto…'
        : '¡Pregunta terminada!', 'success');
    } else if (phase === 'reveal') {
      message('guest-question-message', 'Estas eran las respuestas correctas.', 'success');
    } else if (fresh) {
      message('guest-question-message', '');
    }
    updateCountdown();
  }
  function updateCountdown() {
    if ($('guest-game').hidden) return;
    if (!currentQuestionKey.endsWith(':question')) {
      $('guest-question-time').textContent = 'Resultado mostrado por el formador.';
      return;
    }
    const remaining = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;
    $('guest-question-time').textContent = 'Tiempo restante: ' + remaining + ' s';
    if (remaining === 0) {
      $('guest-question-options').querySelectorAll('button').forEach(button => { button.disabled = true; });
      if (!answerSubmitting) message('guest-question-message', 'Se ha agotado el tiempo.');
    }
  }
  async function submitAnswer(index) {
    if (!token || answerSubmitting || !currentQuestionKey.endsWith(':question') ||
        (deadline && Date.now() >= deadline)) return;
    answerSubmitting = true;
    const buttons = $('guest-question-options').querySelectorAll('button');
    buttons.forEach(button => { button.disabled = true; });
    const selected = Array.from(buttons).find(button => Number(button.dataset.index) === index);
    if (selected) selected.classList.add('selected');
    message('guest-question-message', 'Enviando respuesta…');
    try {
      const response = await rpc('quiz_guest_answer', {
        p_token: token, p_selected: [index],
      });
      if (!response?.ok) {
        message('guest-question-message', response?.error === 'already_answered'
          ? 'La respuesta ya se había registrado.'
          : 'No se pudo registrar la respuesta. Comprueba si el tiempo ha terminado.', 'error');
      } else {
        message('guest-question-message', '¡Respuesta registrada!', 'success');
      }
      void checkRoom();
    } catch {
      message('guest-question-message', 'Error de conexión. Comprueba el estado de la pregunta.', 'error');
      void checkRoom();
    } finally { answerSubmitting = false; }
  }
  setInterval(updateCountdown, 500);

  async function checkRoom() {
    if (!token) return;
    if (checkBusy) {
      checkAgain = true;
      return;
    }
    checkBusy = true;
    try {
      const result = await rpc('quiz_guest_status', { p_token: token });
      if (!result?.ok) {
        closeSession();
        message('join-status', 'Esta sesión ya no está disponible. Consulta al formador.', 'error');
        return;
      }
      $('welcome').textContent = 'Jugador: ' + result.nickname + ' · PIN ' + result.pin;
      $('participant-count').textContent = String(result.player_count) + ' participante(s)';
      renderGame(result);
      if (result.room_status === 'closed') {
        clearPolling();
        $('waiting-text').textContent = 'La sala ha cerrado.';
        message('waiting-status', 'Ya puedes salir de esta pantalla.');
      } else {
        if (result.game_phase === 'lobby' || !result.game_phase)
          $('waiting-text').textContent = 'Esperando al formador…';
        message('waiting-status', 'Conexión comprobada.', 'success');
      }
    } catch {
      message('waiting-status', 'Conexión interrumpida. Volveremos a comprobarla.', 'error');
    } finally {
      checkBusy = false;
      if (checkAgain && token) {
        checkAgain = false;
        void checkRoom();
      } else checkAgain = false;
    }
  }
  function showWaiting() {
    $('join-section').hidden = true;
    $('waiting-section').hidden = false;
    $('welcome').textContent = 'Jugador: ' + nickname;
    clearPolling();
    ensureRealtime();
    void checkRoom();
    fallbackTicks = 0;
    polling = setInterval(() => {
      if (document.hidden) return;
      // Consulta cada 3 s sin Realtime, cada 15 s si está conectado.
      if (!realtime?.isLive() || ++fallbackTicks % 5 === 0) void checkRoom();
    }, 3000);
  }
  $('join-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const pin = $('pin').value.trim();
    const name = $('nickname').value.trim();
    if (!/^[0-9]{6}$/.test(pin) || name.length < 2 || name.length > 32 ||
        !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(invitation)) {
      message('join-status', 'Utiliza el enlace de invitación del formador y escribe un PIN y nombre válidos.', 'error');
      return;
    }
    $('join-button').disabled = true;
    message('join-status', 'Comprobando invitación…');
    try {
      const result = await rpc('quiz_guest_join', {
        p_pin: pin, p_invite: invitation, p_nickname: name,
      });
      if (!result?.ok || !result.token) {
        const errors = {
          invalid_data: 'Comprueba el PIN y el nombre.',
          room_unavailable: 'La sala no está abierta, ha caducado o el enlace no coincide.',
          room_full: 'La sala ha alcanzado su capacidad.',
          name_taken: 'Ese nombre ya está en uso. Hemos generado otro para ti.',
          rate_limited: 'Demasiados intentos. Inténtalo más tarde.',
        };
        if (result?.error === 'name_taken') assignNewName();
        message('join-status', errors[result?.error] || 'No se pudo acceder a la sala.', 'error');
        return;
      }
      token = result.token;
      nickname = result.nickname;
      sessionStorage.setItem(storageKey, JSON.stringify({
        token, nickname, expiresAt: result.expires_at,
      }));
      // El enlace de invitación deja de figurar en la barra una vez utilizado.
      window.history.replaceState(null, '', '/join');
      showWaiting();
    } catch {
      message('join-status', 'Error de conexión. Inténtalo de nuevo.', 'error');
    } finally {
      $('join-button').disabled = false;
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && token) void checkRoom();
  });
  $('leave').addEventListener('click', async () => {
    const currentToken = token;
    $('leave').disabled = true;
    try {
      if (currentToken) await rpc('quiz_guest_leave', { p_token: currentToken });
    } catch {
      message('waiting-status', 'No se pudo confirmar la salida. Puedes intentar de nuevo.', 'error');
      $('leave').disabled = false;
      return;
    }
    closeSession();
    $('leave').disabled = false;
    message('join-status', 'Has salido de la sala.', 'success');
  });
  (async () => {
    try {
      const response = await fetch('/api/cloud/config', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !/^https:\/\/[a-z0-9.-]+$/i.test(data.supabaseUrl || '') ||
        typeof data.publishableKey !== 'string' || !data.publishableKey)
        throw new Error('not_configured');
      settings = data;
      const cached = sessionStorage.getItem(storageKey);
      if (cached) {
        const saved = JSON.parse(cached);
        if (saved.token && saved.expiresAt && new Date(saved.expiresAt).getTime() > Date.now()) {
          token = saved.token;
          nickname = saved.nickname || '';
          showWaiting();
        } else sessionStorage.removeItem(storageKey);
      }
    } catch {
      $('join-button').disabled = true;
      message('join-status', 'No se ha podido configurar la conexión.', 'error');
    }
  })();
})();