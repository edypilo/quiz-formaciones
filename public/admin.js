// Gestión de proyectos: logo, colores corporativos, portada y entidades financiadoras.
const DEFAULT_COLORS = ['#1F3A93', '#00A8A8', '#0F1B3D', '#F2A900', '#E4572E', '#6A4C93', '#2E7D32', '#455A64'];

let projects = [];
let current = null;
let dirty = false;

// ---------- Utilidades ----------

function markDirty(value = true) {
  dirty = value;
  $('#state').textContent = dirty ? 'Cambios sin guardar' : current?.id ? 'Guardado' : '';
}

function normalizeHex(v) {
  let h = String(v || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(h) ? `#${h.toUpperCase()}` : null;
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// ---------- Lista de proyectos ----------

async function loadProjects(selectId) {
  projects = await (await fetch('/api/projects')).json();
  renderList();
  const target = projects.find((p) => p.id === selectId) || projects[0];
  if (target) select(target);
  else newProject();
}

function renderList() {
  $('#plist').innerHTML = projects.map((p) => `
    <li data-id="${escapeHtml(p.id)}" class="${current?.id === p.id ? 'active' : ''}">
      <span class="swatches">${p.colors.slice(0, 5).map((c) => `<span style="background:${c}"></span>`).join('')}</span>
      <span class="pname">${escapeHtml(p.name)}</span>
    </li>`).join('') || '<li class="muted">Aún no hay proyectos</li>';
}

function confirmDiscard() {
  return !dirty || confirm('Hay cambios sin guardar. ¿Descartarlos?');
}

$('#plist').onclick = (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li || li.dataset.id === current?.id || !confirmDiscard()) return;
  select(projects.find((p) => p.id === li.dataset.id));
};

$('#new').onclick = () => { if (confirmDiscard()) newProject(); };

function select(p) {
  current = structuredClone(p);
  renderEditor();
  markDirty(false);
}

function newProject() {
  current = {
    id: null, name: '', title: '', organization: '', logo: null, cover: null, funders: [],
    fundersPlacement: 'lobby', colors: DEFAULT_COLORS.slice(0, 2), roles: { primary: 0, accent: 1, background: 'auto' },
  };
  renderEditor();
  markDirty(false);
  $('#f-name').focus();
}

// ---------- Editor ----------

function renderEditor() {
  renderList();
  $('#f-name').value = current.name;
  $('#f-title').value = current.title;
  $('#f-org').value = current.organization || '';
  $('#f-placement').value = current.fundersPlacement;
  $('#delete').classList.toggle('hidden', !current.id);
  $('#duplicate').classList.toggle('hidden', !current.id);
  renderColors();
  renderImages();
  renderPreview();
}

for (const [id, key] of [['#f-name', 'name'], ['#f-title', 'title'], ['#f-org', 'organization'], ['#f-placement', 'fundersPlacement']]) {
  $(id).addEventListener('input', () => { current[key] = $(id).value; markDirty(); renderPreview(); });
}

// --- Colores ---

function renderColors() {
  const c = current.colors;
  $('#f-ncolors').value = c.length;
  $('#colors').innerHTML = c.map((hex, i) => {
    const uses = [
      current.roles.primary === i && 'principal',
      current.roles.accent === i && 'acento',
      current.roles.background === i && 'fondo',
    ].filter(Boolean).join(', ');
    return `<div class="color-row" data-i="${i}">
      <span class="num">${i + 1}</span>
      <input type="color" value="${hex}" aria-label="Color ${i + 1}">
      <input type="text" value="${hex}" maxlength="7" aria-label="Código del color ${i + 1}">
      <span class="tags">${uses ? `usado como ${uses}` : ''}</span>
    </div>`;
  }).join('');

  const opts = c.map((hex, i) => `<option value="${i}">Color ${i + 1} · ${hex}</option>`).join('');
  $('#r-primary').innerHTML = opts;
  $('#r-accent').innerHTML = opts;
  $('#r-background').innerHTML = '<option value="auto">Automático (versión oscura del principal)</option>' + opts;
  $('#r-primary').value = current.roles.primary;
  $('#r-accent').value = current.roles.accent;
  $('#r-background').value = current.roles.background;
}

$('#f-ncolors').addEventListener('change', () => {
  const n = Math.max(1, Math.min(12, Number($('#f-ncolors').value) || 1));
  const c = current.colors;
  while (c.length < n) c.push(DEFAULT_COLORS.find((d) => !c.includes(d)) || '#888888');
  c.length = n;
  for (const k of ['primary', 'accent']) if (current.roles[k] >= n) current.roles[k] = 0;
  if (current.roles.background !== 'auto' && current.roles.background >= n) current.roles.background = 'auto';
  markDirty();
  renderColors();
  renderPreview();
});

$('#colors').addEventListener('input', (e) => {
  const row = e.target.closest('.color-row');
  if (!row) return;
  const i = Number(row.dataset.i);
  const [picker, text] = row.querySelectorAll('input');
  if (e.target === picker) {
    current.colors[i] = picker.value.toUpperCase();
    text.value = current.colors[i];
  } else {
    const hex = normalizeHex(text.value);
    if (!hex) return;
    current.colors[i] = hex;
    picker.value = hex;
  }
  markDirty();
  renderPreview();
});

// Al salir del campo de texto, se corrige el formato (o se restaura si no es válido).
$('#colors').addEventListener('focusout', (e) => {
  if (e.target.type === 'text') renderColors();
});

for (const [id, key] of [['#r-primary', 'primary'], ['#r-accent', 'accent'], ['#r-background', 'background']]) {
  $(id).addEventListener('change', () => {
    current.roles[key] = $(id).value === 'auto' ? 'auto' : Number($(id).value);
    markDirty();
    renderColors();
    renderPreview();
  });
}

// --- Imágenes ---

function dropHtml(slot) {
  const value = current[slot];
  if (slot === 'funders' || !value) {
    const label = slot === 'funders' ? 'Añadir banner o logos' : slot === 'cover' ? 'Subir portada' : 'Subir logo';
    return `<div>📁 <strong>${label}</strong><br>Arrastra aquí o haz clic para elegir</div>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" ${slot === 'funders' ? 'multiple' : ''}>`;
  }
  return `<img src="${escapeHtml(value)}" alt="">
    <div class="imgactions"><button class="secondary" data-act="change">Cambiar</button><button class="danger" data-act="remove">Quitar</button></div>
    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml">`;
}

function renderImages() {
  document.querySelectorAll('.drop').forEach((el) => { el.innerHTML = dropHtml(el.dataset.slot); });
  $('#funders').innerHTML = current.funders.map((src, i) => `
    <div class="fitem" data-i="${i}">
      <img src="${escapeHtml(src)}" alt="Financiador ${i + 1}">
      <button class="secondary" data-act="up" ${i === 0 ? 'disabled' : ''} title="Subir">↑</button>
      <button class="secondary" data-act="down" ${i === current.funders.length - 1 ? 'disabled' : ''} title="Bajar">↓</button>
      <button class="danger" data-act="remove" title="Quitar">✕</button>
    </div>`).join('');
}

async function addFiles(slot, files) {
  try {
    const images = await Promise.all([...files].map(readImage));
    if (!images.length) return;
    if (slot === 'funders') current.funders.push(...images);
    else current[slot] = images[0];
    markDirty();
    renderImages();
    renderPreview();
  } catch (err) {
    toast(err.message, true);
  }
}

document.querySelectorAll('.drop').forEach((el) => {
  const slot = el.dataset.slot;
  el.addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (act === 'remove') { current[slot] = null; markDirty(); renderImages(); renderPreview(); return; }
    if (e.target.tagName !== 'INPUT') el.querySelector('input').click();
  });
  el.addEventListener('change', (e) => { addFiles(slot, e.target.files); });
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); addFiles(slot, e.dataTransfer.files); });
});

$('#funders').onclick = (e) => {
  const act = e.target.dataset.act;
  const item = e.target.closest('.fitem');
  if (!act || !item) return;
  const i = Number(item.dataset.i);
  const f = current.funders;
  if (act === 'remove') f.splice(i, 1);
  if (act === 'up') [f[i - 1], f[i]] = [f[i], f[i - 1]];
  if (act === 'down') [f[i + 1], f[i]] = [f[i], f[i + 1]];
  markDirty();
  renderImages();
  renderPreview();
};

// --- Vista previa ---

function renderPreview() {
  const c = applyBranding({ ...current, title: current.title || current.name }, $('#preview'));
  $('#cover-thumb').innerHTML = current.cover ? `<img src="${escapeHtml(current.cover)}" alt="Portada">` : 'Sin portada';
  $('#cover-thumb').style.setProperty('--bg', c.background);

  const warn = [];
  if (contrast(c.accent, c.background) < 1.8) warn.push('El color de acento se parece mucho al fondo: los botones apenas se distinguirán.');
  if (current.colors.length > 1 && c.primary === c.accent) warn.push('Principal y acento son el mismo color; puede quedar plano.');
  $('#contrast-warn').innerHTML = warn.map(escapeHtml).join('<br>');
  $('#contrast-warn').classList.toggle('hidden', !warn.length);
}

// ---------- Guardar / duplicar / eliminar ----------

async function send(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: 'Respuesta no válida del servidor' }));
  if (!res.ok) throw new Error(data.error || 'No se pudo guardar');
  return data;
}

$('#save').onclick = async () => {
  if (!current.name.trim()) { toast('Ponle un nombre al proyecto', true); $('#f-name').focus(); return; }
  $('#save').disabled = true;
  $('#state').textContent = 'Guardando…';
  try {
    const saved = await send(current.id ? 'PUT' : 'POST', current.id ? `/api/projects/${current.id}` : '/api/projects', current);
    dirty = false;
    await loadProjects(saved.id);
    toast('Proyecto guardado');
  } catch (err) {
    toast(err.message, true);
    markDirty();
  } finally {
    $('#save').disabled = false;
  }
};

// Al duplicar, las imágenes se copian para que cada proyecto tenga las suyas.
$('#duplicate').onclick = async () => {
  if (!confirmDiscard()) return;
  const toData = async (url) => (url ? readAsDataURL(await (await fetch(url)).blob()) : null);
  const copy = structuredClone(current);
  copy.id = null;
  copy.name = `${copy.name} (copia)`;
  copy.logo = await toData(copy.logo);
  copy.cover = await toData(copy.cover);
  copy.funders = await Promise.all(copy.funders.map(toData));
  current = copy;
  renderEditor();
  markDirty();
  $('#f-name').select();
};

$('#delete').onclick = async () => {
  if (!confirm(`¿Eliminar el proyecto «${current.name}» y sus imágenes? No se puede deshacer.`)) return;
  await send('DELETE', `/api/projects/${current.id}`);
  dirty = false;
  current = null;
  await loadProjects();
  toast('Proyecto eliminado');
};

window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

loadProjects(new URLSearchParams(location.search).get('id'));
