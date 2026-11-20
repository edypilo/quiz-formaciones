'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const login = $('login-section');
  const dashboard = $('dashboard-section');
  const form = $('login-form');
  const status = $('login-status');
  const dashboardStatus = $('dashboard-status');
  const submit = $('sign-in');
  let config;
  let accessToken = '';
  let refreshToken = '';
  let expiresAt = 0;
  let userEmail = '';
  let pendingRefresh = null;
  let projectsCache = [];
  let editingProjectId = null;
  let quizzesCache = [];
  let quizDraft = null;
  let quizSelection = 0;
  let quizDirty = false;
  let ownerId = '';
  let mediaPreviewUrl = '';
  let mediaPreviewVersion = 0;
  let mediaUploading = false;
  let activeRooms = [];
  let roomPlayerCounts = new Map();
  let playerRefreshBusy = false;
  let playerPolling = null;
  let selectedQrRoomId = '';
  const pollingMs = 5000;

  const allowedMedia = Object.freeze({
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/webm': 'webm',
  });



  function message(el, text, type = '') {
    el.textContent = text;
    el.dataset.type = type;
  }
  async function json(res) {
    try { return await res.json(); } catch { return null; }
  }
  function safeArray(value) { return Array.isArray(value) ? value : []; }
  function openProjectEditor(project = null) {
    editingProjectId = project?.id || null;
    $('project-form-title').textContent = project ? 'Editar proyecto' : 'Nuevo proyecto';
    $('project-name').value = project?.name || '';
    $('project-title').value = project?.title || '';
    $('project-org').value = project?.organization || '';
    $('project-primary').value = project?.branding?.colors?.[0] || '#6989e6';
    $('project-accent').value = project?.branding?.colors?.[1] || '#efa6a4';
    message($('project-status'), '');
    $('project-editor').hidden = false;
    $('project-name').focus();
  }
  function closeProjectEditor() {
    editingProjectId = null;
    $('project-editor').hidden = true;
    $('project-form').reset();
  }

  function renderList(id, records, kind) {
    const container = $(id);
    container.replaceChildren();
    if (!records.length) {
      const li = document.createElement('li');
      li.textContent = kind === 'proyectos' ? 'Todavía no tienes proyectos en la nube.' : 'Todavía no tienes cuestionarios en la nube.';
      container.append(li);
      return;
    }
    for (const record of records) {
      const li = document.createElement('li');
      const title = document.createElement('span');
      title.className = 'name';
      title.textContent = String(record.name || record.title || 'Sin título');
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = kind === 'cuestionarios' ? (String(record.description || '').slice(0, 120) || 'Cuestionario') : (String(record.organization || '').slice(0, 80) || 'Proyecto');
      const content = document.createElement('div');
      content.append(title, sub);
      if (kind === 'cuestionarios') {
        li.classList.add('project-row');
        const edit = document.createElement('button');
        edit.className = 'minor';
        edit.type = 'button';
        edit.textContent = 'Editar';
        edit.addEventListener('click', () => openQuizEditor(record));
        const duplicate = document.createElement('button');
        duplicate.className = 'minor';
        duplicate.type = 'button';
        duplicate.textContent = 'Duplicar';
        duplicate.addEventListener('click', () => quizAction(record, 'duplicate'));
        const remove = document.createElement('button');
        remove.className = 'minor';
        remove.type = 'button';
        remove.textContent = 'Eliminar';
        remove.addEventListener('click', () => quizAction(record, 'delete'));
        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.style.margin = '0';
        const prepare = document.createElement('button');
        prepare.className = 'minor';
        prepare.type = 'button';
        prepare.textContent = 'Preparar sala';
        prepare.title = 'Genera un PIN privado para esta prueba; todavía no admite jugadores';
        prepare.addEventListener('click', () => createRoom(record));
        actions.append(edit, duplicate, remove, prepare);
        li.append(content, actions);
      } else if (kind === 'proyectos') {
        li.classList.add('project-row');
        const edit = document.createElement('button');
        edit.className = 'minor';
        edit.type = 'button';
        edit.textContent = 'Editar';
        edit.addEventListener('click', () => openProjectEditor(record));
        li.append(content, edit);
      } else {
        li.append(content);
      }
      container.append(li);
    }
  }

  async function refreshAccess() {
    if (Date.now() < expiresAt - 60000) return true;
    if (!refreshToken || !config) return false;
    if (pendingRefresh) return pendingRefresh;
    pendingRefresh = (async () => {
      try {
        const response = await fetch(config.supabaseUrl + '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          headers: { 'apikey': config.publishableKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
          cache: 'no-store',
        });
        const data = await json(response);
        if (!response.ok || !data || !data.access_token) return false;
        saveSession(data);
        return true;
      } catch { return false; }
    })();
    try { return await pendingRefresh; } finally { pendingRefresh = null; }
  }
  function saveSession(data) {
    accessToken = data.access_token;
    refreshToken = data.refresh_token || refreshToken;
    expiresAt = Date.now() + Math.max(1, Number(data.expires_in || 3600)) * 1000;
    userEmail = String(data.user?.email || userEmail || '');
  }
  function closeSession() {
    const token = accessToken;
    accessToken = ''; refreshToken = ''; expiresAt = 0; userEmail = '';
    $('password').value = '';
    dashboard.hidden = true;
    login.hidden = false;
    $('project-list').replaceChildren();
    $('quiz-list').replaceChildren();
    $('room-list').replaceChildren();
    if (playerPolling) window.clearInterval(playerPolling);
    playerPolling = null;
    activeRooms = [];
    roomPlayerCounts = new Map();
    selectedQrRoomId = '';
    hideRoomQr();
    roomMessage('');
    projectsCache = [];
    ownerId = '';
    quizzesCache = [];
    closeProjectEditor();
    closeQuizEditor(true);
    if (token && config) {
      void fetch(config.supabaseUrl + '/auth/v1/logout', {
        method: 'POST',
        headers: { 'apikey': config.publishableKey, 'Authorization': 'Bearer ' + token },
        cache: 'no-store',
      }).catch(() => {});
    }
  }
  async function loadData() {
    message(dashboardStatus, 'Consultando tus datos…');
    if (!(await refreshAccess())) {
      closeSession();
      message(status, 'La sesión ha caducado. Vuelve a entrar.', 'error');
      return;
    }
    try {
      const headers = { Authorization: 'Bearer ' + accessToken };
      const responses = await Promise.all([
        fetch('/api/cloud/me', { headers, cache: 'no-store' }),
        fetch('/api/cloud/projects', { headers, cache: 'no-store' }),
        fetch('/api/cloud/quizzes', { headers, cache: 'no-store' }),
      ]);
      if (responses.some((r) => r.status === 401)) {
        closeSession();
        message(status, 'No se pudo verificar la sesión. Vuelve a entrar.', 'error');
        return;
      }
      if (responses.some((r) => !r.ok)) {
        message(dashboardStatus, 'La conexión con Supabase no está disponible o la consulta falló.', 'error');
        return;
      }
      const [identity, projects, quizzes] = await Promise.all(responses.map(json));
      if (!identity?.id || !Array.isArray(projects) || !Array.isArray(quizzes)) throw new Error('invalid_data');
      ownerId = identity.id;
      projectsCache = safeArray(projects);
      renderList('project-list', projectsCache, 'proyectos');
      quizzesCache = safeArray(quizzes);
      renderList('quiz-list', quizzesCache, 'cuestionarios');
      await refreshRooms();
      message(dashboardStatus, 'Conexión verificada. Consulta de solo lectura.', 'success');
    } catch {
      message(dashboardStatus, 'No se han podido cargar los datos. Comprueba la conexión.', 'error');
    }
  }




  function roomMessage(text, type = '') {
    message($('room-status'), text, type);
  }
  async function refreshRooms() {
    if (!(await refreshAccess())) {
      roomMessage('Vuelve a iniciar sesión.', 'error');
      return;
    }
    try {
      const response = await fetch('/api/cloud/rooms', {
        headers: { Authorization: 'Bearer ' + accessToken }, cache: 'no-store',
      });
      if (!response.ok) {
        const body = await json(response);
        roomMessage(body?.error === 'rooms_unavailable_or_migration_required'
          ? 'Primero debes ejecutar la migración SQL de salas en Supabase.'
          : 'No se pudieron consultar las salas.', 'error');
        return;
      }
      const rooms = await json(response);
      if (!Array.isArray(rooms)) throw new Error('invalid_rooms');
      const list = $('room-list');
      list.replaceChildren();
      if (!rooms.length) {
        const li = document.createElement('li');
        li.textContent = 'No hay salas preparadas.';
        list.append(li);
      }
      for (const room of rooms) {
        const li = document.createElement('li');
        li.className = 'project-row';
        const detail = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = quizzesCache.find(q => q.id === room.quiz_id)?.title || 'Cuestionario';
        const pin = document.createElement('p');
        pin.style.margin = '6px 0 0';
        pin.textContent = 'PIN de prueba: ' + room.pin + ' · Caduca: ' +
          new Date(room.expires_at).toLocaleString('es-ES');
        detail.append(name, pin);
        const people = document.createElement('div');
        people.className = 'room-participants';
        people.id = 'room-participants-' + room.id;
        detail.append(people);
        const controls = document.createElement('div');
        controls.className = 'actions';
        controls.style.margin = '0';
        if (!room.is_joinable) {
          const open = document.createElement('button');
          open.type = 'button'; open.className = 'minor';
          open.textContent = 'Habilitar invitados';
          open.addEventListener('click', () => void openRoom(room));
          controls.append(open);
        } else {
          const url = new URL('/join', window.location.origin);
          url.searchParams.set('pin', room.pin);
          url.searchParams.set('invite', room.join_secret);
          const showQr = document.createElement('button');
          showQr.type = 'button'; showQr.className = 'minor';
          showQr.textContent = 'Mostrar QR';
          showQr.addEventListener('click', () => void showRoomQr(room, url.href));
          controls.append(showQr);
          const invite = document.createElement('button');
          invite.type = 'button'; invite.className = 'minor';
          invite.textContent = 'Copiar invitación';
          invite.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(url.href);
              roomMessage('Invitación copiada. El destinatario necesitará acceso autorizado a Vercel Preview.', 'success');
            } catch {
              window.prompt('Copia esta invitación:', url.href);
            }
          });
          const players = document.createElement('button');
          players.type = 'button'; players.className = 'minor';
          players.textContent = 'Ver participantes';
          players.addEventListener('click', () => void viewPlayers(room));
          controls.append(invite, players);
        }
        const close = document.createElement('button');
        close.type = 'button'; close.className = 'minor'; close.textContent = 'Cerrar sala';
        close.addEventListener('click', () => closeRoom(room));
        controls.append(close);
        li.append(detail, controls);
        list.append(li);
      }
      activeRooms = rooms;
      renderParticipantLists();
      if (!playerPolling) playerPolling = window.setInterval(() => {
        if (!document.hidden && !dashboard.hidden) void updatePlayers();
      }, pollingMs);
      await updatePlayers();
      roomMessage('Listado de salas actualizado.', 'success');
    } catch {
      roomMessage('No se pudieron consultar las salas.', 'error');
    }
  }

  function renderParticipantLists() {
    for (const room of activeRooms) {
      const target = $('room-participants-' + room.id);
      if (!target) continue;
      const players = roomPlayerCounts.get(room.id) || [];
      target.replaceChildren();
      const header = document.createElement('strong');
      header.textContent = players.length + (players.length === 1 ? ' participante' : ' participantes');
      target.append(header);
      const list = document.createElement('ul');
      if (!players.length) {
        const li = document.createElement('li');
        li.textContent = 'Esperando jugadores…';
        list.append(li);
      } else {
        players.forEach((player) => {
          const li = document.createElement('li');
          li.textContent = player.nickname;
          list.append(li);
        });
      }
      target.append(list);
    }
    if (selectedQrRoomId && $('room-qr-dialog').open) {
      const players = roomPlayerCounts.get(selectedQrRoomId) || [];
      $('room-qr-count').textContent = players.length +
        (players.length === 1 ? ' participante conectado' : ' participantes conectados');
      const names = $('room-qr-names');
      names.replaceChildren();
      if (!players.length) names.textContent = 'Esperando jugadores…';
      else players.forEach((player) => {
        const span = document.createElement('span');
        span.textContent = player.nickname;
        names.append(span);
      });
    }
  }
  async function updatePlayers() {
    if (playerRefreshBusy || dashboard.hidden || !accessToken) return;
    if (!activeRooms.length) {
      roomPlayerCounts.clear();
      renderParticipantLists();
      return;
    }
    playerRefreshBusy = true;
    const ids = activeRooms.filter(room => room.is_joinable).slice(0, 6).map(room => room.id);
    if (!ids.length) {
      roomPlayerCounts.clear();
      renderParticipantLists();
      playerRefreshBusy = false;
      return;
    }
    try {
      if (!(await refreshAccess())) return;
      const response = await fetch('/api/cloud/rooms/players?ids=' +
        encodeURIComponent(ids.join(',')), {
        headers: { Authorization: 'Bearer ' + accessToken },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('player_refresh_failed');
      const records = await json(response);
      if (!Array.isArray(records)) throw new Error('invalid_player_response');
      const next = new Map();
      ids.forEach(id => next.set(id, []));
      for (const player of records) {
        if (next.has(player.room_id)) next.get(player.room_id).push(player);
      }
      roomPlayerCounts = next;
      renderParticipantLists();
    } catch {
      if ($('room-qr-dialog').open)
        message($('room-qr-status'), 'La lista de jugadores no se pudo actualizar. Se volverá a intentar.', 'error');
    } finally {
      playerRefreshBusy = false;
    }
  }

  $('refresh-rooms').addEventListener('click', () => void refreshRooms());

  async function createRoom(quiz) {
    if (!(await refreshAccess())) {
      closeSession(); message(status, 'La sesión ha caducado.', 'error');
      return;
    }
    roomMessage('Preparando sala en Supabase…');
    try {
      const response = await fetch('/api/cloud/rooms', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz_id: quiz.id }),
        cache: 'no-store',
      });
      const result = await json(response);
      if (!response.ok) {
        const errors = {
          quiz_has_incomplete_questions: 'Este cuestionario tiene preguntas sin completar.',
          quiz_room_already_open: 'Ya existe una sala abierta para este cuestionario. Ciérrala primero.',
          rooms_unavailable_or_migration_required: 'Falta ejecutar la migración SQL de salas en Supabase.',
        };
        roomMessage(errors[result?.error] || 'No se ha podido preparar la sala.', 'error');
        return;
      }
      await refreshRooms();
      roomMessage('Sala creada con PIN ' + result.pin +
        '. Es solo una prueba privada; los jugadores todavía no pueden entrar.', 'success');
    } catch {
      roomMessage('Error de conexión al crear la sala.', 'error');
    }
  }


  let roomQrObjectUrl = '';
  function hideRoomQr() {
    const dialog = $('room-qr-dialog');
    if (dialog.open) dialog.close();
    $('room-qr-image').removeAttribute('src');
    if (roomQrObjectUrl) URL.revokeObjectURL(roomQrObjectUrl);
    roomQrObjectUrl = '';
    selectedQrRoomId = '';
  }
  $('room-qr-close').addEventListener('click', hideRoomQr);
  $('room-qr-dialog').addEventListener('close', hideRoomQr);
  async function showRoomQr(room, joinUrl) {
    if (!(await refreshAccess())) {
      closeSession();
      message(status, 'La sesión ha caducado.', 'error');
      return;
    }
    hideRoomQr();
    selectedQrRoomId = room.id;
    $('room-qr-pin').textContent = room.pin;
    renderParticipantLists();
    message($('room-qr-status'), 'Generando QR seguro…');
    $('room-qr-dialog').showModal();
    try {
      const response = await fetch('/api/cloud/rooms/' + encodeURIComponent(room.id) + '/qr', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: joinUrl }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('qr_error');
      const blob = await response.blob();
      if (!$('room-qr-dialog').open) return;
      roomQrObjectUrl = URL.createObjectURL(blob);
      $('room-qr-image').src = roomQrObjectUrl;
      message($('room-qr-status'), 'QR preparado. Comprueba que los móviles tienen acceso a Vercel Preview.', 'success');
      await updatePlayers();
    } catch {
      message($('room-qr-status'), 'No se pudo generar el QR. Prueba a copiar la invitación.', 'error');
    }
  }

  async function openRoom(room) {
    if (!window.confirm('¿Habilitar la entrada de invitados a esta sala? Sigue siendo una prueba protegida por Vercel.')) return;
    if (!(await refreshAccess())) {
      closeSession(); message(status, 'La sesión ha caducado.', 'error'); return;
    }
    try {
      const response = await fetch('/api/cloud/rooms/' + encodeURIComponent(room.id) + '/open', {
        method: 'POST', headers: { Authorization: 'Bearer ' + accessToken },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('open_failed');
      await refreshRooms();
      roomMessage('Inscripciones habilitadas. Utiliza «Copiar invitación» para la prueba móvil.', 'success');
    } catch {
      roomMessage('No se pudo abrir la inscripción. Comprueba que has ejecutado la migración nueva.', 'error');
    }
  }
  async function viewPlayers(room) {
    if (!(await refreshAccess())) return;
    try {
      const response = await fetch('/api/cloud/rooms/' + encodeURIComponent(room.id) + '/players', {
        headers: { Authorization: 'Bearer ' + accessToken }, cache: 'no-store',
      });
      if (!response.ok) throw new Error('players_failed');
      const players = await json(response);
      if (!Array.isArray(players)) throw new Error('invalid_response');
      const details = players.length
        ? players.map((player, i) => (i + 1) + '. ' + player.nickname).join(' · ')
        : 'Todavía no hay jugadores.';
      roomMessage('Participantes (' + players.length + '): ' + details, 'success');
    } catch {
      roomMessage('No se ha podido consultar la lista de participantes.', 'error');
    }
  }
  async function closeRoom(room) {
    if (!window.confirm('¿Cerrar la sala ' + room.pin + '?')) return;
    if (!(await refreshAccess())) {
      closeSession(); message(status, 'La sesión ha caducado.', 'error'); return;
    }
    try {
      const response = await fetch('/api/cloud/rooms/' + encodeURIComponent(room.id) + '/close', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('close_room_failed');
      await refreshRooms();
      roomMessage('Sala cerrada correctamente.', 'success');
    } catch {
      roomMessage('No se pudo cerrar la sala.', 'error');
    }
  }

  async function quizAction(record, operation) {
    const duplicate = operation === 'duplicate';
    const confirmation = duplicate
      ? '¿Crear una copia de «' + record.title + '»?'
      : '¿Eliminar «' + record.title + '»? No se puede deshacer.';
    if (!window.confirm(confirmation)) return;
    if (!(await refreshAccess())) {
      closeSession();
      message(status, 'La sesión ha caducado. Vuelve a entrar.', 'error');
      return;
    }
    const target = '/api/cloud/quizzes/' + encodeURIComponent(record.id) + (duplicate ? '/duplicate' : '');
    try {
      message(dashboardStatus, duplicate ? 'Duplicando cuestionario…' : 'Eliminando cuestionario…');
      const response = await fetch(target, {
        method: duplicate ? 'POST' : 'DELETE',
        headers: { Authorization: 'Bearer ' + accessToken },
        cache: 'no-store',
      });
      if (response.status === 401) {
        closeSession();
        message(status, 'La sesión ha caducado. Vuelve a entrar.', 'error');
        return;
      }
      if (!response.ok) {
        message(dashboardStatus, 'No se pudo completar la operación.', 'error');
        return;
      }
      if (!duplicate && quizDraft?.id === record.id) closeQuizEditor(true);
      await loadData();
      message(dashboardStatus,
        duplicate ? 'Copia guardada correctamente.' : 'Cuestionario eliminado.', 'success');
    } catch {
      message(dashboardStatus, 'No se pudo conectar con el servidor.', 'error');
    }
  }


  let importPreview = null;

  function clearImportPreview() {
    importPreview = null;
    $('quiz-import-preview').hidden = true;
    $('quiz-import-file').value = '';
  }

  // Descarga autorizada usando el token, sin exponer un enlace directo con JWT.
  async function downloadCloud(url, filename) {
    if (!(await refreshAccess())) {
      closeSession();
      message(status, 'La sesión ha caducado. Vuelve a entrar.', 'error');
      return;
    }
    try {
      const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + accessToken },
        cache: 'no-store',
      });
      if (response.status === 401) {
        closeSession();
        message(status, 'La sesión ha caducado. Vuelve a entrar.', 'error');
        return;
      }
      if (!response.ok) throw Error('download_failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      message(dashboardStatus, 'No se pudo descargar el archivo.', 'error');
    }
  }

  $('quiz-template-xlsx').addEventListener('click',
    () => downloadCloud('/api/cloud/templates/xlsx', 'plantilla-quizzz.xlsx'));
  $('quiz-template-docx').addEventListener('click',
    () => downloadCloud('/api/cloud/templates/docx', 'plantilla-quizzz.docx'));

  async function downloadQuiz(format) {
    if (!quizDraft) return;
    if (quizDraft.id && quizDirty && !window.confirm(
      'La exportación utiliza la última versión guardada. ¿Continuar sin guardar los cambios actuales?')) return;
    if (!quizDraft.id) {
      message($('quiz-status'), 'Guarda primero el cuestionario para exportarlo.', 'error');
      return;
    }
    await downloadCloud(
      '/api/cloud/quizzes/' + encodeURIComponent(quizDraft.id) + '/export.' + format,
      'quizzz-cuestionario.' + format);
  }
  $('quiz-export-xlsx').addEventListener('click', () => downloadQuiz('xlsx'));
  $('quiz-export-docx').addEventListener('click', () => downloadQuiz('docx'));
  $('quiz-import').addEventListener('click', () => {
    if (quizDraft) $('quiz-import-file').click();
  });
  $('quiz-import-cancel').addEventListener('click', clearImportPreview);
  $('quiz-import-file').addEventListener('change', async () => {
    const file = $('quiz-import-file').files[0];
    $('quiz-import-file').value = '';
    if (!file) return;
    if (!/\.(xlsx|docx)$/i.test(file.name) || file.size > 5 * 1024 * 1024 || file.size === 0) {
      message($('quiz-status'), 'Selecciona un .xlsx o .docx de hasta 5 MB.', 'error');
      return;
    }
    if (!(await refreshAccess())) {
      closeSession();
      message(status, 'La sesión ha caducado. Vuelve a entrar.', 'error');
      return;
    }
    try {
      message($('quiz-status'), 'Analizando archivo…');
      const response = await fetch('/api/cloud/import', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/octet-stream',
          'X-Filename': file.name,
        },
        body: file,
        cache: 'no-store',
      });
      if (response.status === 401) {
        closeSession();
        message(status, 'La sesión ha caducado. Vuelve a entrar.', 'error');
        return;
      }
      const result = await json(response);
      if (!response.ok || !Array.isArray(result?.questions))
        throw Error('import_failed');
      if (!result.questions.length) {
        message($('quiz-status'), 'El archivo no contiene preguntas.', 'error');
        return;
      }
      importPreview = result;
      $('quiz-import-summary').textContent =
        result.questions.length + ' preguntas encontradas en «' + file.name + '». Comprueba los avisos antes de importar.';
      const warnings = $('quiz-import-warnings');
      warnings.replaceChildren();
      for (const warning of (result.warnings || []).slice(0, 100)) {
        const p = document.createElement('p');
        p.textContent = '⚠ ' + warning;
        warnings.append(p);
      }
      if (result.warnings?.length > 100) {
        const p = document.createElement('p');
        p.textContent = 'Hay más avisos. Revisa el archivo antes de continuar.';
        warnings.append(p);
      }
      $('quiz-import-preview').hidden = false;
      message($('quiz-status'), 'Archivo analizado. Decide cómo importar las preguntas.');
    } catch {
      message($('quiz-status'), 'No se ha podido leer el archivo. Comprueba que utilizas la plantilla.', 'error');
    }
  });

  function applyImportedQuestions(replace) {
    if (!quizDraft || !importPreview) return;
    const questions = importPreview.questions.map((q) => structuredClone(q));
    if (!replace && quizDraft.questions.length + questions.length > 200) {
      message($('quiz-status'), 'Un cuestionario no puede superar 200 preguntas.', 'error');
      return;
    }
    if (replace && !window.confirm('Se sustituirán todas las preguntas actuales sin guardar. ¿Continuar?')) return;
    const previousLength = quizDraft.questions.length;
    quizDraft.questions = replace ? questions : [...quizDraft.questions, ...questions];
    quizSelection = replace ? 0 : previousLength;
    clearImportPreview();
    markQuizDirty();
    renderQuestionNav();
    renderQuestionEditor();
    message($('quiz-status'), 'Preguntas incorporadas al borrador. Pulsa Guardar cuestionario para conservarlas.', 'success');
  }
  $('quiz-import-append').addEventListener('click', () => applyImportedQuestions(false));
  $('quiz-import-replace').addEventListener('click', () => applyImportedQuestions(true));


  function closeMediaLightbox() {
    const dialog = $('media-lightbox');
    if (dialog.open) dialog.close();
    $('media-lightbox-image').removeAttribute('src');
  }
  $('media-lightbox-close').addEventListener('click', closeMediaLightbox);
  $('media-lightbox').addEventListener('click', (event) => {
    if (event.target === $('media-lightbox')) closeMediaLightbox();
  });
  $('media-lightbox').addEventListener('close', () => {
    $('media-lightbox-image').removeAttribute('src');
  });

  function clearMediaPreview() {
    closeMediaLightbox();
    mediaPreviewVersion++;
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    mediaPreviewUrl = '';
    $('question-media-preview').replaceChildren();
  }
  function youtubeIdFromUrl(source) {
    try {
      const u = new URL(source);
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
      const host = u.hostname.toLowerCase();
      if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(host)) return null;
      let id = null;
      if (host === 'youtu.be') id = u.pathname.slice(1);
      else if (u.pathname === '/watch') id = u.searchParams.get('v');
      else if (/^\/(shorts|embed|live)\/[A-Za-z0-9_-]{11}$/.test(u.pathname)) id = u.pathname.split('/')[2];
      return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
    } catch { return null; }
  }
  async function renderMediaPreview() {
    const q = quizDraft?.questions[quizSelection];
    clearMediaPreview();
    const token = mediaPreviewVersion;
    $('question-media-youtube-form').hidden = true;
    $('question-media-remove').hidden = !q?.media;
    message($('question-media-status'),
      'PNG, JPG, WEBP, GIF, MP4 o WEBM (máx. 6 MB). Sin SVG.');
    if (!q?.media) return;
    if (q.media.type === 'youtube') {
      const id = youtubeIdFromUrl(q.media.src);
      if (!id) {
        message($('question-media-status'), 'El enlace de YouTube no es válido.', 'error');
        return;
      }
      const a = document.createElement('a');
      a.href = 'https://www.youtube.com/watch?v=' + id;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'Ver vídeo de YouTube';
      $('question-media-preview').append(a);
      return;
    }
    if (!ownerId || !config || !q.media.src.startsWith(ownerId + '/assets/')) {
      message($('question-media-status'), 'El archivo no pertenece a la cuenta activa.', 'error');
      return;
    }
    if (!(await refreshAccess())) return;
    try {
      const response = await fetch(config.supabaseUrl + '/storage/v1/object/authenticated/quiz-media/' + q.media.src, {
        headers: { apikey: config.publishableKey, Authorization: 'Bearer ' + accessToken },
        cache: 'no-store',
      });
      if (!response.ok) throw Error('not_found');
      const blob = await response.blob();
      if (token !== mediaPreviewVersion) return;
      const url = URL.createObjectURL(blob);
      mediaPreviewUrl = url;
      const el = document.createElement(q.media.type === 'video' ? 'video' : 'img');
      el.src = url;
      if (q.media.type === 'video') {
        el.controls = true;
        el.preload = 'metadata';
        $('question-media-preview').append(el);
      } else {
        el.alt = 'Vista previa de la pregunta';
        const zoom = document.createElement('button');
        zoom.type = 'button';
        zoom.className = 'media-zoom';
        zoom.setAttribute('aria-label', 'Ampliar imagen de la pregunta');
        zoom.title = 'Pulsa para ampliar la imagen';
        zoom.addEventListener('click', () => {
          $('media-lightbox-image').src = url;
          $('media-lightbox').showModal();
        });
        zoom.append(el);
        $('question-media-preview').append(zoom);
      }
    } catch {
      if (token === mediaPreviewVersion)
        message($('question-media-status'), 'No se ha podido cargar el archivo privado.', 'error');
    }
  }

  $('question-media-upload').addEventListener('click', () => {
    if (quizDraft && !mediaUploading) $('question-media-file').click();
  });
  $('question-media-file').addEventListener('change', async () => {
    const file = $('question-media-file').files[0];
    $('question-media-file').value = '';
    if (!file || !quizDraft || mediaUploading) return;
    const ext = allowedMedia[file.type];
    // Para cargas estándar se limita a 6 MB. Vídeos grandes usarán TUS reanudable.
    const limit = 6 * 1024 * 1024;
    if (!ext || !file.size || file.size > limit) {
      message($('question-media-status'), 'Formato no admitido o archivo demasiado grande.', 'error');
      return;
    }
    if (!ownerId || !(await refreshAccess())) {
      message($('question-media-status'), 'No se ha podido verificar tu sesión.', 'error');
      return;
    }
    const currentQuestion = quizDraft.questions[quizSelection];
    const currentQuiz = quizDraft;
    const id = crypto.randomUUID();
    const path = ownerId + '/assets/' + id + '.' + ext;
    mediaUploading = true;
    $('question-media-upload').disabled = true;
    message($('question-media-status'), 'Subiendo a tu almacenamiento privado…');
    try {
      const response = await fetch(config.supabaseUrl + '/storage/v1/object/quiz-media/' + path, {
        method: 'POST',
        headers: {
          apikey: config.publishableKey,
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': file.type,
          'x-upsert': 'false',
          'cache-control': 'no-store',
        },
        body: file,
      });
      if (!response.ok) throw Error('upload_failed');
      if (currentQuiz !== quizDraft || !currentQuiz.questions.includes(currentQuestion)) return;
      currentQuestion.media = { type: file.type.startsWith('video/') ? 'video' : 'image', src: path };
      markQuizDirty();
      await renderMediaPreview();
      message($('question-media-status'), 'Archivo subido. Guarda el cuestionario para conservar la referencia.', 'success');
    } catch {
      message($('question-media-status'), 'No se pudo subir el archivo. Comprueba permisos y conexión.', 'error');
    } finally {
      mediaUploading = false;
      $('question-media-upload').disabled = false;
    }
  });
  $('question-media-youtube').addEventListener('click', () => {
    if (!quizDraft) return;
    $('question-media-youtube-form').hidden = false;
    $('question-media-youtube-url').focus();
  });
  $('question-media-youtube-save').addEventListener('click', () => {
    if (!quizDraft) return;
    const id = youtubeIdFromUrl($('question-media-youtube-url').value.trim());
    if (!id) {
      message($('question-media-status'), 'Introduce una URL válida de YouTube.', 'error');
      return;
    }
    quizDraft.questions[quizSelection].media = { type: 'youtube', src: 'https://www.youtube.com/watch?v=' + id };
    $('question-media-youtube-url').value = '';
    markQuizDirty();
    void renderMediaPreview();
  });
  $('question-media-remove').addEventListener('click', () => {
    if (!quizDraft) return;
    quizDraft.questions[quizSelection].media = null;
    markQuizDirty();
    void renderMediaPreview();
  });

  function blankQuestion(type = 'quiz') {
    return {
      type, text: '',
      options: type === 'truefalse' ? ['Verdadero', 'Falso'] : ['', '', '', ''],
      correct: [], time: Number($('quiz-time').value || 20),
      points: type === 'poll' ? 0 : 1, explanation: '', media: null,
    };
  }
  function markQuizDirty() {
    quizDirty = true;
    $('quiz-dirty').textContent = 'Cambios sin guardar';
  }
  function closeQuizEditor(force = false) {
    if (!force && quizDirty && !window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;
    quizDraft = null;
    quizDirty = false;
    clearMediaPreview();
    clearImportPreview();
    $('quiz-editor').hidden = true;
    $('quiz-question-editor').hidden = true;
  }
  function renderQuestionNav() {
    const list = $('quiz-question-list');
    list.replaceChildren();
    quizDraft.questions.forEach((q, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'question-card';
      button.setAttribute('aria-current', String(quizSelection === i));
      button.textContent = (i + 1) + '. ' + (q.text || 'Pregunta sin completar') + ' · ' +
        (q.type === 'truefalse' ? 'Verdadero/Falso' : q.type === 'poll' ? 'Encuesta' : 'Quiz');
      button.addEventListener('click', () => {
        quizSelection = i;
        renderQuestionNav();
        renderQuestionEditor();
      });
      const wrapper = document.createElement('div');
      wrapper.className = 'question-nav-row';
      wrapper.append(button);
      for (const [direction, label] of [[-1, 'Subir'], [1, 'Bajar']]) {
        const nextIndex = i + direction;
        const move = document.createElement('button');
        move.type = 'button';
        move.className = 'minor';
        move.textContent = direction < 0 ? '↑' : '↓';
        move.title = label + ' pregunta';
        move.setAttribute('aria-label', label + ' pregunta ' + (i + 1));
        move.disabled = nextIndex < 0 || nextIndex >= quizDraft.questions.length;
        move.addEventListener('click', () => {
          const qs = quizDraft.questions;
          [qs[i], qs[nextIndex]] = [qs[nextIndex], qs[i]];
          if (quizSelection === i) quizSelection = nextIndex;
          else if (quizSelection === nextIndex) quizSelection = i;
          markQuizDirty();
          renderQuestionNav(); renderQuestionEditor();
        });
        wrapper.append(move);
      }
      list.append(wrapper);
    });
  }
  function renderQuestionEditor() {
    const q = quizDraft.questions[quizSelection];
    $('quiz-question-editor').hidden = !q;
    if (!q) return;
    $('question-type').value = q.type;
    $('question-time').value = String(q.time || 20);
    $('question-text').value = q.text || '';
    $('question-points').value = String(q.points ?? 1);
    $('question-points').disabled = q.type === 'poll';
    $('question-explanation').value = q.explanation || '';
    void renderMediaPreview();
    const options = $('question-options');
    options.replaceChildren();
    const values = q.type === 'truefalse' ? ['Verdadero', 'Falso'] : (q.options || []).concat(['', '', '', '']).slice(0, 4);
    values.forEach((answer, i) => {
      const row = document.createElement('label');
      row.className = 'question-option';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = (q.correct || []).includes(i);
      check.disabled = q.type === 'poll';
      check.title = 'Respuesta correcta';
      check.addEventListener('change', () => {
        if (q.type === 'truefalse' && check.checked) q.correct = [i];
        else if (check.checked) q.correct = [...new Set([...(q.correct || []), i])];
        else q.correct = (q.correct || []).filter((value) => value !== i);
        markQuizDirty();
        renderQuestionEditor();
      });
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 120;
      input.value = answer;
      input.placeholder = 'Respuesta ' + (i + 1);
      input.disabled = q.type === 'truefalse';
      input.addEventListener('input', () => {
        q.options[i] = input.value;
        markQuizDirty();
      });
      row.append(check, input);
      options.append(row);
    });
  }
  function openQuizEditor(quiz = null) {
    if (quizDraft && quizDirty && !window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;
    closeProjectEditor();
    const defaultTime = Number(quiz?.settings?.defaultTime || 20);
    quizDraft = quiz ? structuredClone(quiz) : {
      title: 'Cuestionario sin título', description: '', project_id: null,
      settings: { defaultTime: 20, showTextOnDevice: false, allowLateJoin: true },
      questions: [blankQuestion()],
    };
    quizDraft.questions = Array.isArray(quizDraft.questions) ? quizDraft.questions : [];
    clearImportPreview();
    $('quiz-editor-heading').textContent = quiz ? 'Editar cuestionario' : 'Nuevo cuestionario';
    $('quiz-title').value = quizDraft.title;
    $('quiz-description').value = quizDraft.description || '';
    $('quiz-time').value = String(defaultTime);
    $('quiz-device-text').checked = !!quizDraft.settings?.showTextOnDevice;
    $('quiz-late').checked = quizDraft.settings?.allowLateJoin !== false;
    const projectsSelect = $('quiz-project');
    projectsSelect.replaceChildren(new Option('Sin proyecto', ''));
    projectsCache.forEach((project) => projectsSelect.add(new Option(project.name, project.id)));
    projectsSelect.value = quizDraft.project_id || '';
    quizSelection = 0;
    quizDirty = false;
    $('quiz-dirty').textContent = '';
    message($('quiz-status'), '');
    $('quiz-editor').hidden = false;
    renderQuestionNav();
    renderQuestionEditor();
    $('quiz-title').focus();
  }

  $('new-quiz').addEventListener('click', () => openQuizEditor());
  $('quiz-cancel').addEventListener('click', () => closeQuizEditor());
  $('quiz-add-question').addEventListener('click', () => {
    if (!quizDraft || quizDraft.questions.length >= 200) return;
    quizDraft.questions.push(blankQuestion());
    quizSelection = quizDraft.questions.length - 1;
    markQuizDirty();
    renderQuestionNav();
    renderQuestionEditor();
  });
  $('question-duplicate').addEventListener('click', () => {
    if (!quizDraft || quizDraft.questions.length >= 200) return;
    quizDraft.questions.splice(quizSelection + 1, 0, structuredClone(quizDraft.questions[quizSelection]));
    quizSelection++;
    markQuizDirty(); renderQuestionNav(); renderQuestionEditor();
  });
  $('question-remove').addEventListener('click', () => {
    if (!quizDraft || !window.confirm('¿Eliminar esta pregunta?')) return;
    quizDraft.questions.splice(quizSelection, 1);
    quizSelection = Math.max(0, Math.min(quizSelection, quizDraft.questions.length - 1));
    markQuizDirty(); renderQuestionNav(); renderQuestionEditor();
  });
  for (const [id, property] of [
    ['quiz-title', 'title'], ['quiz-description', 'description'],
  ]) $(''+id).addEventListener('input', () => { if (quizDraft) { quizDraft[property] = $(id).value; markQuizDirty(); } });
  $('quiz-project').addEventListener('change', () => { quizDraft.project_id = $('quiz-project').value || null; markQuizDirty(); });
  $('quiz-time').addEventListener('change', () => { quizDraft.settings.defaultTime = Number($('quiz-time').value); markQuizDirty(); });
  $('quiz-device-text').addEventListener('change', () => { quizDraft.settings.showTextOnDevice = $('quiz-device-text').checked; markQuizDirty(); });
  $('quiz-late').addEventListener('change', () => { quizDraft.settings.allowLateJoin = $('quiz-late').checked; markQuizDirty(); });
  $('question-type').addEventListener('change', () => {
    const q = quizDraft.questions[quizSelection], type = $('question-type').value;
    q.type = type;
    q.correct = [];
    q.options = type === 'truefalse' ? ['Verdadero', 'Falso'] : ['', '', '', ''];
    q.points = type === 'poll' ? 0 : 1;
    markQuizDirty(); renderQuestionNav(); renderQuestionEditor();
  });
  $('question-time').addEventListener('change', () => { quizDraft.questions[quizSelection].time = Number($('question-time').value); markQuizDirty(); });
  $('question-text').addEventListener('input', () => { quizDraft.questions[quizSelection].text = $('question-text').value; markQuizDirty(); renderQuestionNav(); });
  $('question-points').addEventListener('change', () => { quizDraft.questions[quizSelection].points = Number($('question-points').value); markQuizDirty(); });
  $('question-explanation').addEventListener('input', () => { quizDraft.questions[quizSelection].explanation = $('question-explanation').value; markQuizDirty(); });

  $('quiz-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!quizDraft || !(await refreshAccess())) {
      closeSession(); message(status, 'La sesión ha caducado. Vuelve a entrar.', 'error'); return;
    }
    const save = $('quiz-submit');
    save.disabled = true;
    message($('quiz-status'), 'Guardando cuestionario…');
    try {
      const editing = !!quizDraft.id;
      const url = editing ? '/api/cloud/quizzes/' + encodeURIComponent(quizDraft.id) : '/api/cloud/quizzes';
      const response = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: quizDraft.title, description: quizDraft.description,
          project_id: quizDraft.project_id, settings: quizDraft.settings, questions: quizDraft.questions,
        }), cache: 'no-store',
      });
      if (response.status === 401) {
        closeSession(); message(status, 'La sesión ha caducado. Vuelve a entrar.', 'error'); return;
      }
      if (!response.ok) {
        message($('quiz-status'), 'No se pudo guardar. Comprueba las preguntas y el proyecto.', 'error'); return;
      }
      const saved = await json(response);
      if (!saved?.id) throw new Error('save_response');
      quizDraft = saved;
      quizDirty = false;
      $('quiz-dirty').textContent = '';
      message($('quiz-status'), 'Borrador guardado correctamente en Supabase.', 'success');
      await loadData();
      renderQuestionNav();
    } catch {
      message($('quiz-status'), 'Error de conexión al guardar el cuestionario.', 'error');
    } finally { save.disabled = false; }
  });

  $('new-project').addEventListener('click', () => openProjectEditor());
  $('project-cancel').addEventListener('click', closeProjectEditor);
  $('project-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!(await refreshAccess())) {
      closeSession();
      message(status, 'La sesión ha caducado. Vuelve a entrar.', 'error');
      return;
    }
    const saveButton = $('project-submit');
    const editing = editingProjectId;
    const existing = editing ? projectsCache.find((project) => project.id === editing) : null;
    const primary = $('project-primary').value;
    const accent = $('project-accent').value;
    const original = existing?.branding || {};
    const colors = [primary, accent];
    const data = {
      name: $('project-name').value.trim(),
      title: $('project-title').value.trim(),
      organization: $('project-org').value.trim(),
      branding: {
        colors,
        roles: { primary: 0, accent: 1, background: 'auto' },
        fundersPlacement: original.fundersPlacement === 'always' ? 'always' : 'lobby',
      },
    };
    if (!data.name || !data.title) {
      message($('project-status'), 'Indica un nombre y un título.', 'error');
      return;
    }
    saveButton.disabled = true;
    message($('project-status'), 'Guardando en Supabase…');
    try {
      const response = await fetch(editing
        ? '/api/cloud/projects/' + encodeURIComponent(editing)
        : '/api/cloud/projects', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(data), cache: 'no-store',
      });
      if (response.status === 401) {
        closeSession();
        message(status, 'La sesión ha caducado. Vuelve a entrar.', 'error');
        return;
      }
      if (!response.ok) {
        message($('project-status'), 'No se pudo guardar el proyecto. Revisa los datos y vuelve a intentarlo.', 'error');
        return;
      }
      closeProjectEditor();
      await loadData();
      message(dashboardStatus, editing ? 'Proyecto actualizado en Supabase.' : 'Proyecto creado en Supabase.', 'success');
    } catch {
      message($('project-status'), 'Error de conexión al guardar el proyecto.', 'error');
    } finally {
      saveButton.disabled = false;
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!config) return;
    const email = $('email').value.trim();
    const password = $('password').value;
    if (!email || !password) return;
    submit.disabled = true;
    message(status, 'Validando credenciales…');
    try {
      const response = await fetch(config.supabaseUrl + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        cache: 'no-store',
      });
      const data = await json(response);
      if (!response.ok || !data?.access_token || !data?.user?.id) {
        message(status, 'No se ha podido iniciar sesión. Revisa tus credenciales y la confirmación de correo.', 'error');
        return;
      }
      saveSession(data);
      $('password').value = '';
      $('signed-user').textContent = userEmail;
      login.hidden = true;
      dashboard.hidden = false;
      await loadData();
    } catch {
      message(status, 'No se pudo conectar con la autenticación. Inténtalo de nuevo.', 'error');
    } finally { submit.disabled = false; }
  });
  $('sign-out').addEventListener('click', () => {
    closeSession();
    message(status, 'Sesión cerrada.', 'success');
  });

  (async () => {
    try {
      const response = await fetch('/api/cloud/config', { cache: 'no-store' });
      const data = await json(response);
      if (!response.ok || typeof data?.supabaseUrl !== 'string' ||
          !/^https:\/\/[a-z0-9.-]+$/.test(data.supabaseUrl) ||
          typeof data.publishableKey !== 'string' || !data.publishableKey) {
        throw new Error('not_configured');
      }
      config = data;
      message(status, 'Introduce tus credenciales para continuar.');
    } catch {
      submit.disabled = true;
      message(status, 'Falta configurar la conexión a Supabase en este despliegue.', 'error');
    }
  })();
})();
