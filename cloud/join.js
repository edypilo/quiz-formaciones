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
  let currentQuestionKey = '';
  let answerSubmitting = false;
  let deadline = 0;
  let lastGamePhase = '';

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
    token = '';
    nickname = '';
    sessionStorage.removeItem(storageKey);
    $('waiting-section').hidden = true;
    $('guest-game').hidden = true;
    currentQuestionKey = '';
    lastGamePhase = '';
    $('join-section').hidden = false;
  }

  function renderGame(state) {
    const phase = state.game_phase || 'lobby';
    const question = state.question;
    $('guest-game').hidden = !question || !['question', 'reveal'].includes(phase);
    if (phase === 'finished') {
      $('waiting-text').textContent = '¡Partida terminada! Gracias por participar.';
      return;
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
    }
    deadline = question.ends_at ? Date.parse(question.ends_at) : 0;
    if (fresh) {
      const answers = $('guest-question-options');
      (question.options || []).forEach((option, index) => {
        if (!option) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = (index + 1) + '. ' + option;
        if (phase === 'reveal' && question.correct?.includes(index)) button.classList.add('correct');
        if (phase !== 'question' || state.answered) button.disabled = true;
        button.addEventListener('click', () => void submitAnswer(index));
        answers.append(button);
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
    if (buttons[index]) buttons[index].classList.add('selected');
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
    }
  }
  function showWaiting() {
    $('join-section').hidden = true;
    $('waiting-section').hidden = false;
    $('welcome').textContent = 'Jugador: ' + nickname;
    clearPolling();
    void checkRoom();
    polling = setInterval(() => void checkRoom(), 3000);
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