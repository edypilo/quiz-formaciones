'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const invitation = params.get('invite') || '';
  const initialPin = params.get('pin') || '';
  $('pin').value = /^[0-9]{6}$/.test(initialPin) ? initialPin : '';
  let settings = null;
  let token = '';
  let nickname = '';
  let polling = null;
  const storageKey = 'quizzz_lobby_preview';
  const message = (id, text, type = '') => {
    const node = $(id);
    node.textContent = text;
    node.dataset.type = type;
  };
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
    $('join-section').hidden = false;
  }
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
      if (result.room_status === 'closed') {
        clearPolling();
        $('waiting-text').textContent = 'La sala ha cerrado.';
        message('waiting-status', 'Ya puedes salir de esta pantalla.');
      } else {
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
    polling = setInterval(() => void checkRoom(), 5000);
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
          name_taken: 'Ese nombre ya está en uso. Elige otro.',
          rate_limited: 'Demasiados intentos. Inténtalo más tarde.',
        };
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