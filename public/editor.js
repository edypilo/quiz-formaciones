// Editor de cuestionarios: lista, edición pregunta a pregunta, multimedia e importación Excel/Word.
const { TYPES, TIMES, POINTS, LIMITS, getType, normalizeQuestion, youtubeId } = window.QuestionTypes;

let quiz = null;      // cuestionario abierto
let selected = 0;     // índice de la pregunta en edición
let dirty = false;
let projectList = [];

// ---------- Utilidades ----------

async function api(method, url, body, headers = {}) {
  const isRaw = body instanceof Blob || body instanceof ArrayBuffer;
  const res = await fetch(url, {
    method,
    headers: isRaw ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

function markDirty(value = true) {
  dirty = value;
  updateState();
}

function updateState() {
  const bad = quiz ? quiz.questions.filter((q) => problems(q).length).length : 0;
  $('#state').textContent = dirty ? 'Cambios sin guardar'
    : bad ? `Guardado · ${bad} ${bad === 1 ? 'pregunta incompleta' : 'preguntas incompletas'}` : 'Guardado';
  $('#state').classList.toggle('bad', !dirty && bad > 0);
}

const problems = (q) => normalizeQuestion(q, quiz.settings.defaultTime).errors;

function blankQuestion(type = 'quiz') {
  return {
    type, text: '', options: type === 'truefalse' ? ['Verdadero', 'Falso'] : ['', '', '', ''],
    correct: [], time: quiz?.settings.defaultTime || 20, points: type === 'poll' ? 0 : 1, explanation: '', media: null,
  };
}

// Las preguntas siempre se editan con 4 huecos de respuesta (como en Kahoot).
function padOptions(q) {
  if (q.type !== 'truefalse') q.options = [...q.options, '', '', '', ''].slice(0, 4);
  return q;
}

function confirmDiscard() {
  return !dirty || confirm('Hay cambios sin guardar. ¿Descartarlos?');
}

// ---------- Lista de cuestionarios ----------

async function showList() {
  quiz = null;
  history.replaceState(null, '', '/editor');
  const list = await api('GET', '/api/quizzes');
  const projectName = (id) => projectList.find((p) => p.id === id)?.name;
  $('#quiz-list').innerHTML = list.map((q) => `
    <div class="qcard" data-id="${escapeHtml(q.id)}">
      <h3>${escapeHtml(q.title)}</h3>
      <div class="meta">${q.count} ${q.count === 1 ? 'pregunta' : 'preguntas'}${projectName(q.project) ? ` · ${escapeHtml(projectName(q.project))}` : ''}</div>
      ${q.description ? `<div class="meta">${escapeHtml(q.description)}</div>` : ''}
      ${q.issues ? '<div class="tag-warn">⚠ Incompleto: revísalo antes de jugar</div>' : ''}
      <div class="actions"><button data-act="edit">Editar</button><a class="btnlink" href="/api/quizzes/${encodeURIComponent(q.id)}/export.xlsx" download>⬇ Excel</a></div>
    </div>`).join('') || '<p class="hint">Aún no hay cuestionarios. Crea uno o importa una plantilla.</p>';
  show('v-list');
}

$('#quiz-list').onclick = (e) => {
  const card = e.target.closest('.qcard');
  if (card && e.target.tagName !== 'A') openQuiz(card.dataset.id);
};

$('#new').onclick = async () => {
  const created = await api('POST', '/api/quizzes', { title: 'Cuestionario sin título', questions: [blankQuestion()] });
  await openQuiz(created.id);
  $('#quiz-title').select();
};

// ---------- Abrir y guardar ----------

async function openQuiz(id, index = 0) {
  quiz = await api('GET', `/api/quizzes/${encodeURIComponent(id)}`);
  quiz.questions.forEach(padOptions);
  if (!quiz.questions.length) quiz.questions.push(blankQuestion());
  selected = Math.min(index, quiz.questions.length - 1);
  history.replaceState(null, '', `/editor?id=${encodeURIComponent(id)}`);
  $('#quiz-title').value = quiz.title;
  $('#export').href = `/api/quizzes/${encodeURIComponent(id)}/export.xlsx`;
  $('#s-description').value = quiz.description;
  $('#s-project').innerHTML = '<option value="">Ninguno (se elige al crear la sala)</option>'
    + projectList.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
  $('#s-project').value = quiz.project || '';
  $('#s-time').innerHTML = TIMES.map((t) => `<option value="${t}">${t} segundos</option>`).join('');
  $('#s-time').value = quiz.settings.defaultTime;
  $('#s-text').checked = quiz.settings.showTextOnDevice;
  $('#s-late').checked = quiz.settings.allowLateJoin;
  show('v-edit');
  renderQuestionList();
  renderQuestion();
  markDirty(false);
}

function payload() {
  return {
    title: quiz.title, description: quiz.description, project: quiz.project || null, settings: quiz.settings,
    questions: quiz.questions.map(({ _stash, ...q }) => q),
  };
}

async function save() {
  $('#save').disabled = true;
  $('#state').textContent = 'Guardando…';
  try {
    const saved = await api('PUT', `/api/quizzes/${encodeURIComponent(quiz.id)}`, payload());
    quiz.questions = saved.questions.map(padOptions);
    dirty = false;
    renderQuestionList();
    renderQuestion();
    updateState();
    toast(saved.issues.length ? 'Guardado, pero hay preguntas por completar' : 'Cuestionario guardado', !!saved.issues.length);
  } catch (err) {
    toast(err.message, true);
    markDirty();
  } finally {
    $('#save').disabled = false;
  }
}

$('#save').onclick = save;
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && quiz) { e.preventDefault(); save(); }
});
$('#back').onclick = () => { if (confirmDiscard()) { dirty = false; showList(); } };

$('#quiz-title').addEventListener('input', () => { quiz.title = $('#quiz-title').value; markDirty(); });
$('#s-description').addEventListener('input', () => { quiz.description = $('#s-description').value; markDirty(); });
$('#s-project').addEventListener('change', () => { quiz.project = $('#s-project').value || null; markDirty(); });
$('#s-time').addEventListener('change', () => { quiz.settings.defaultTime = Number($('#s-time').value); markDirty(); });
$('#s-text').addEventListener('change', () => { quiz.settings.showTextOnDevice = $('#s-text').checked; markDirty(); });
$('#s-late').addEventListener('change', () => { quiz.settings.allowLateJoin = $('#s-late').checked; markDirty(); });

$('#duplicate').onclick = async () => {
  if (!confirmDiscard()) return;
  const copy = await api('POST', `/api/quizzes/${encodeURIComponent(quiz.id)}/duplicate`);
  dirty = false;
  await openQuiz(copy.id);
  toast('Se ha creado una copia');
};

$('#delete').onclick = async () => {
  if (!confirm(`¿Eliminar «${quiz.title}» y sus imágenes y vídeos? No se puede deshacer.`)) return;
  await api('DELETE', `/api/quizzes/${encodeURIComponent(quiz.id)}`);
  dirty = false;
  toast('Cuestionario eliminado');
  showList();
};

window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------- Lista de preguntas ----------

function renderQuestionList() {
  $('#qlist').innerHTML = quiz.questions.map((q, i) => {
    const bad = problems(q).length;
    return `<li class="qitem ${i === selected ? 'active' : ''}" data-i="${i}" title="${escapeHtml(q.text)}">
      <span class="qn">${i + 1}</span><span>${getType(q.type)?.icon || '❓'}</span>
      <span class="qt">${escapeHtml(q.text) || '<em>Sin texto</em>'}</span>
      ${bad ? '<span class="qerr" title="Incompleta">⚠</span>' : ''}
      <span class="qactions">
        <button data-act="up" title="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button data-act="down" title="Bajar" ${i === quiz.questions.length - 1 ? 'disabled' : ''}>↓</button>
        <button data-act="dup" title="Duplicar">⧉</button>
        <button data-act="del" title="Eliminar">✕</button>
      </span>
    </li>`;
  }).join('');
}

$('#qlist').onclick = (e) => {
  const li = e.target.closest('.qitem');
  if (!li) return;
  const i = Number(li.dataset.i);
  const qs = quiz.questions;
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'up') { [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]; selected = i - 1; }
  else if (act === 'down') { [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]]; selected = i + 1; }
  else if (act === 'dup') { qs.splice(i + 1, 0, structuredClone(qs[i])); selected = i + 1; }
  else if (act === 'del') {
    if (!confirm(`¿Eliminar la pregunta ${i + 1}?`)) return;
    qs.splice(i, 1);
    if (!qs.length) qs.push(blankQuestion());
    selected = Math.min(i, qs.length - 1);
  } else {
    selected = i;
  }
  if (act) markDirty();
  renderQuestionList();
  renderQuestion();
};

$('#add-q').onclick = () => {
  const prev = quiz.questions[selected];
  // La nueva pregunta hereda el tipo de la actual, salvo que sea encuesta.
  quiz.questions.splice(selected + 1, 0, blankQuestion(prev && prev.type !== 'poll' ? prev.type : 'quiz'));
  selected++;
  markDirty();
  renderQuestionList();
  renderQuestion();
  $('#q-text').focus();
};

// ---------- Edición de una pregunta ----------

const current = () => quiz.questions[selected];

function renderQuestion() {
  const q = current();
  const def = getType(q.type);
  $('#qeditor').innerHTML = `
    <div class="types" role="radiogroup" aria-label="Tipo de pregunta">
      ${TYPES.map((t) => `<button type="button" data-type="${t.id}" class="${t.id === q.type ? 'active' : ''}"
        ${t.available ? '' : 'disabled'} title="${escapeHtml(t.description)}">${t.icon} ${escapeHtml(t.label)}${t.available ? '' : ' <small>· próximamente</small>'}</button>`).join('')}
    </div>
    <p class="hint">${escapeHtml(def.description)}</p>

    <label class="field">Pregunta
      <textarea id="q-text" class="qtext-input" rows="2" maxlength="${LIMITS.text}" placeholder="${q.type === 'truefalse' ? 'Escribe una afirmación' : 'Escribe la pregunta'}">${escapeHtml(q.text)}</textarea>
      <span class="count" id="q-count"></span>
    </label>

    <div class="media-box" id="media-box">${mediaBoxHtml(q)}</div>

    <div class="opts">
      ${q.options.map((o, i) => `
        <div class="opt c${i} ${o ? '' : 'empty'}" data-i="${i}">
          <span class="shape">${SHAPES[i]}</span>
          <input type="text" value="${escapeHtml(o)}" maxlength="${LIMITS.option}" ${def.fixedOptions ? 'readonly' : ''}
            placeholder="Respuesta ${i + 1}${i >= 2 ? ' (opcional)' : ''}" aria-label="Respuesta ${i + 1}">
          ${def.scored ? `<button type="button" class="ok ${q.correct.includes(i) ? 'on' : ''}" title="Marcar como correcta" aria-pressed="${q.correct.includes(i)}">✓</button>` : ''}
        </div>`).join('')}
    </div>
    ${def.scored && q.type === 'quiz' ? '<p class="hint">Pulsa ✓ en la respuesta correcta. Puedes marcar varias.</p>' : ''}

    <div class="grid3">
      <label class="field">⏱ Tiempo límite
        <select id="q-time">${TIMES.map((t) => `<option value="${t}" ${t === q.time ? 'selected' : ''}>${t} segundos</option>`).join('')}</select>
      </label>
      ${def.scored ? `<label class="field">🏆 Puntos
        <select id="q-points">${POINTS.map((p) => `<option value="${p.value}" ${p.value === q.points ? 'selected' : ''}>${p.label}</option>`).join('')}</select>
      </label>` : '<div></div>'}
    </div>

    <label class="field">💡 Explicación de la respuesta (opcional)
      <textarea id="q-explanation" rows="2" maxlength="${LIMITS.explanation}" placeholder="Se muestra en pantalla y en los móviles al revelar la respuesta">${escapeHtml(q.explanation)}</textarea>
    </label>

    <div class="errors hidden" id="q-errors"></div>`;
  updateCount();
  renderErrors();
}

function mediaBoxHtml(q) {
  if (q.media) {
    const label = { image: 'Imagen', video: 'Vídeo', youtube: 'Vídeo de YouTube' }[q.media.type];
    return `<div class="media-preview">${mediaHtml(q.media)}</div>
      <div class="media-buttons"><span class="hint" style="margin:0">${label}</span>
      <button type="button" class="secondary" data-media="file">Cambiar</button>
      <button type="button" class="danger" data-media="remove">Quitar</button></div>`;
  }
  return `<div class="media-buttons">
      <button type="button" class="secondary" data-media="file">🖼 Imagen o vídeo</button>
      <button type="button" class="secondary" data-media="youtube">▶ Enlace de YouTube</button>
    </div>
    <p class="hint" style="margin:8px 0 0">Opcional. También puedes arrastrar aquí una imagen o un vídeo MP4.</p>
    <div class="yt hidden" id="yt-row"><input type="text" id="yt-url" placeholder="https://www.youtube.com/watch?v=…"><button type="button" data-media="yt-ok">Añadir</button></div>`;
}

function updateCount() {
  $('#q-count').textContent = `${current().text.length}/${LIMITS.text}`;
}

function renderErrors() {
  const errs = problems(current());
  $('#q-errors').innerHTML = errs.length ? `<strong>Para poder jugar esta pregunta:</strong><ul>${errs.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` : '';
  $('#q-errors').classList.toggle('hidden', !errs.length);
}

// Cambios que solo afectan al modelo (sin redibujar, para no perder el foco).
function touched() {
  markDirty();
  renderErrors();
  renderQuestionList();
}

$('#qeditor').addEventListener('input', (e) => {
  const q = current();
  if (e.target.id === 'q-text') { q.text = e.target.value; updateCount(); }
  else if (e.target.id === 'q-explanation') q.explanation = e.target.value;
  else if (e.target.closest('.opt') && e.target.type === 'text') {
    const opt = e.target.closest('.opt');
    q.options[Number(opt.dataset.i)] = e.target.value;
    opt.classList.toggle('empty', !e.target.value);
  } else return;
  touched();
});

$('#qeditor').addEventListener('change', (e) => {
  const q = current();
  if (e.target.id === 'q-time') q.time = Number(e.target.value);
  else if (e.target.id === 'q-points') q.points = Number(e.target.value);
  else return;
  touched();
});

$('#qeditor').addEventListener('click', (e) => {
  const q = current();
  const typeBtn = e.target.closest('[data-type]');
  if (typeBtn && !typeBtn.disabled) return changeType(q, typeBtn.dataset.type);

  const ok = e.target.closest('.ok');
  if (ok) {
    const i = Number(ok.closest('.opt').dataset.i);
    if (q.type === 'truefalse') q.correct = [i];
    else q.correct = q.correct.includes(i) ? q.correct.filter((x) => x !== i) : [...q.correct, i].sort();
    document.querySelectorAll('#qeditor .ok').forEach((b, j) => {
      b.classList.toggle('on', q.correct.includes(j));
      b.setAttribute('aria-pressed', q.correct.includes(j));
    });
    return touched();
  }

  const media = e.target.closest('[data-media]')?.dataset.media;
  if (media === 'file') $('#media-file').click();
  if (media === 'remove') { q.media = null; refreshMedia(); touched(); }
  if (media === 'youtube') { $('#yt-row').classList.remove('hidden'); $('#yt-url').focus(); }
  if (media === 'yt-ok') addYoutube();
});

$('#qeditor').addEventListener('keydown', (e) => {
  if (e.target.id === 'yt-url' && e.key === 'Enter') addYoutube();
});

function changeType(q, type) {
  if (type === q.type) return;
  // Al pasar a V/F se guardan las respuestas escritas por si se vuelve atrás.
  if (type === 'truefalse') {
    q._stash = q.options;
    q.options = ['Verdadero', 'Falso'];
    q.correct = q.correct.filter((i) => i < 2).slice(0, 1);
  } else if (q.type === 'truefalse') {
    q.options = q._stash || ['Verdadero', 'Falso', '', ''];
    delete q._stash;
  }
  if (type === 'poll') { q.correct = []; q.points = 0; }
  if (q.type === 'poll' && type !== 'poll') q.points = 1;
  q.type = type;
  padOptions(q);
  renderQuestion();
  touched();
}

function refreshMedia() {
  $('#media-box').innerHTML = mediaBoxHtml(current());
}

function addYoutube() {
  const url = $('#yt-url').value.trim();
  if (!youtubeId(url)) return toast('Ese enlace no parece de YouTube', true);
  current().media = { type: 'youtube', src: url };
  refreshMedia();
  touched();
}

async function uploadMedia(file) {
  if (!file) return;
  const isVideo = file.type.startsWith('video/');
  if (!isVideo && !file.type.startsWith('image/')) return toast('Sube una imagen o un vídeo MP4/WEBM', true);
  if (isVideo && file.size > 300e6) return toast('El vídeo supera 300 MB; recórtalo o usa YouTube', true);
  const q = current();
  $('#media-box').innerHTML = `<p class="hint">Subiendo ${isVideo ? 'vídeo' : 'imagen'}…</p>`;
  try {
    // Las imágenes muy grandes se reducen antes de subirlas.
    const blob = isVideo ? file : await (await fetch(await readImage(file))).blob();
    const { src } = await api('POST', `/api/quizzes/${encodeURIComponent(quiz.id)}/media`, blob, { 'Content-Type': blob.type });
    q.media = { type: isVideo ? 'video' : 'image', src };
    touched();
  } catch (err) {
    toast(err.message, true);
  }
  if (q === current()) refreshMedia();
}

$('#media-file').addEventListener('change', (e) => { uploadMedia(e.target.files[0]); e.target.value = ''; });
$('#qeditor').addEventListener('dragover', (e) => {
  const box = e.target.closest('#media-box');
  if (box) { e.preventDefault(); box.classList.add('over'); }
});
$('#qeditor').addEventListener('dragleave', (e) => e.target.closest('#media-box')?.classList.remove('over'));
$('#qeditor').addEventListener('drop', (e) => {
  const box = e.target.closest('#media-box');
  if (!box) return;
  e.preventDefault();
  box.classList.remove('over');
  uploadMedia(e.dataTransfer.files[0]);
});

// ---------- Importar desde Excel/Word ----------

let importTarget = 'new';

$('#import-new').onclick = () => { importTarget = 'new'; $('#import-file').click(); };
$('#import-into').onclick = () => { importTarget = 'current'; $('#import-file').click(); };

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const result = await api('POST', '/api/import', file, { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) });
    showImportDialog(file.name, result);
  } catch (err) {
    showImportDialog(file.name, { error: err.message });
  }
});

function showImportDialog(filename, { questions = [], warnings = [], error }) {
  const dlg = $('#import-dialog');
  const n = questions.length;
  $('#imp-title').textContent = error ? 'No se ha podido importar' : `${n} ${n === 1 ? 'pregunta encontrada' : 'preguntas encontradas'}`;
  $('#imp-summary').textContent = error || (n
    ? `En «${filename}». ${warnings.length ? 'Revisa los avisos: esas preguntas se importan pero quedarán marcadas para completarlas en el editor.' : 'Todo correcto.'}`
    : 'El archivo no contiene preguntas. Comprueba que usas la plantilla.');
  $('#imp-warnings').innerHTML = warnings.map((w) => `<div>⚠ ${escapeHtml(w)}</div>`).join('');
  $('#imp-warnings').classList.toggle('hidden', !warnings.length);

  const actions = [];
  if (n && importTarget === 'new') actions.push(['create', 'Crear cuestionario']);
  if (n && importTarget === 'current') actions.push(['append', `Añadir al final (${quiz.questions.length + n} en total)`], ['replace', 'Sustituir las actuales']);
  actions.push(['cancel', n ? 'Cancelar' : 'Cerrar']);
  $('#imp-actions').innerHTML = actions.map(([a, label]) =>
    `<button data-imp="${a}" class="${a === 'cancel' ? 'secondary' : a === 'replace' ? 'danger' : ''}">${label}</button>`).join('');

  $('#imp-actions').onclick = async (ev) => {
    const act = ev.target.dataset.imp;
    if (!act) return;
    dlg.close();
    const imported = questions.map(padOptions);
    if (act === 'create') {
      const title = filename.replace(/\.(xlsx|docx)$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || 'Cuestionario importado';
      const created = await api('POST', '/api/quizzes', { title, questions: imported });
      await openQuiz(created.id);
      toast('Cuestionario creado a partir del archivo');
    } else if (act === 'append' || act === 'replace') {
      if (act === 'replace' && !confirm('Se borrarán las preguntas actuales del cuestionario. ¿Continuar?')) return;
      const start = act === 'append' ? quiz.questions.length : 0;
      quiz.questions = act === 'append' ? [...quiz.questions, ...imported] : imported;
      selected = start;
      markDirty();
      renderQuestionList();
      renderQuestion();
      toast('Preguntas importadas. Recuerda guardar.');
    }
  };
  dlg.showModal();
}

// ---------- Inicio ----------

(async () => {
  projectList = await api('GET', '/api/projects').catch(() => []);
  const id = new URLSearchParams(location.search).get('id');
  if (id) await openQuiz(id).catch(showList);
  else await showList();
})();
