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
      if (kind === 'proyectos') {
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
    projectsCache = [];
    closeProjectEditor();
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
      projectsCache = safeArray(projects);
      renderList('project-list', projectsCache, 'proyectos');
      renderList('quiz-list', safeArray(quizzes), 'cuestionarios');
      message(dashboardStatus, 'Conexión verificada. Consulta de solo lectura.', 'success');
    } catch {
      message(dashboardStatus, 'No se han podido cargar los datos. Comprueba la conexión.', 'error');
    }
  }

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
