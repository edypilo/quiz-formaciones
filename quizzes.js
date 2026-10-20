// Cuestionarios: cada uno vive en quizzes/<id>/quiz.json y sus imágenes/vídeos en quizzes/<id>/media/.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeQuestion } = require('./public/question-types');

const { QUIZZES_DIR: QUIZ_DIR } = require('./paths');
const MEDIA_TYPES = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm',
};

const quizDir = (id) => path.join(QUIZ_DIR, path.basename(String(id)));
const mediaDir = (id) => path.join(quizDir(id), 'media');
const quizFile = (id) => path.join(quizDir(id), 'quiz.json');

function newId(title) {
  const base = String(title || 'cuestionario').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cuestionario';
  return `${base}-${crypto.randomBytes(2).toString('hex')}`;
}

function normalizeSettings(s = {}) {
  return {
    defaultTime: Math.max(5, Math.min(240, Number(s.defaultTime) || 20)),
    showTextOnDevice: !!s.showTextOnDevice,
    allowLateJoin: s.allowLateJoin !== false,
  };
}

// Valida todas las preguntas; los borradores se guardan aunque tengan errores.
function validate(quiz) {
  const settings = normalizeSettings(quiz.settings);
  const issues = [];
  const questions = (quiz.questions || []).map((q, i) => {
    const r = normalizeQuestion(q, settings.defaultTime);
    if (r.errors.length) issues.push({ index: i, errors: r.errors });
    return r.question;
  });
  if (!questions.length) issues.push({ index: -1, errors: ['El cuestionario no tiene preguntas'] });
  return { settings, questions, issues };
}

function readQuiz(id) {
  if (!fs.existsSync(quizFile(id))) return null;
  const raw = JSON.parse(fs.readFileSync(quizFile(id), 'utf8'));
  const { settings, questions, issues } = validate(raw);
  return {
    id: path.basename(String(id)), title: raw.title || 'Sin título', description: raw.description || '',
    project: raw.project || null, settings, questions, issues, updatedAt: raw.updatedAt || null,
  };
}

function listQuizzes() {
  if (!fs.existsSync(QUIZ_DIR)) return [];
  return fs.readdirSync(QUIZ_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readQuiz(d.name))
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title, 'es'));
}

// Las rutas internas de los archivos subidos se convierten en URLs para el navegador.
function toPublic(quiz) {
  if (!quiz) return null;
  const questions = quiz.questions.map((q) => {
    if (!q.media || q.media.type === 'youtube' || /^https?:\/\//i.test(q.media.src)) return q;
    return { ...q, media: { ...q.media, src: `/quiz-media/${quiz.id}/${encodeURIComponent(q.media.src)}` } };
  });
  return { ...quiz, questions };
}

// URL pública -> nombre de archivo propio (solo si existe en la carpeta de este cuestionario).
function toStoredMedia(id, media) {
  if (!media || media.type === 'youtube' || /^https?:\/\//i.test(media.src)) return media;
  const file = path.basename(decodeURIComponent(String(media.src).split('/').pop()));
  return fs.existsSync(path.join(mediaDir(id), file)) ? { ...media, src: file } : null;
}

function saveQuiz(id, data) {
  const isNew = !id;
  id = isNew ? newId(data.title) : path.basename(String(id));
  if (!isNew && !fs.existsSync(quizFile(id))) throw new Error('El cuestionario no existe');
  fs.mkdirSync(quizDir(id), { recursive: true });

  const questions = (Array.isArray(data.questions) ? data.questions : []).slice(0, 200)
    .map((q) => ({ ...q, media: toStoredMedia(id, q.media) }));
  const { settings, questions: clean } = validate({ settings: data.settings, questions });
  const quiz = {
    title: String(data.title || 'Cuestionario sin título').trim().slice(0, 120),
    description: String(data.description || '').trim().slice(0, 300),
    project: data.project || null,
    settings,
    questions: clean,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(quizFile(id), JSON.stringify(quiz, null, 2));

  // Borra archivos multimedia que ya no usa ninguna pregunta.
  const used = new Set(clean.map((q) => q.media?.src).filter(Boolean));
  if (fs.existsSync(mediaDir(id))) {
    for (const f of fs.readdirSync(mediaDir(id))) if (!used.has(f)) fs.unlinkSync(path.join(mediaDir(id), f));
  }
  return readQuiz(id);
}

function saveMedia(id, mime, buffer) {
  if (!fs.existsSync(quizFile(id))) throw new Error('El cuestionario no existe');
  const ext = MEDIA_TYPES[mime];
  if (!ext) throw new Error('Formato no admitido. Usa imágenes (PNG, JPG, WEBP, GIF, SVG) o vídeo MP4/WEBM');
  const name = `${mime.startsWith('video') ? 'video' : 'imagen'}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.mkdirSync(mediaDir(id), { recursive: true });
  fs.writeFileSync(path.join(mediaDir(id), name), buffer);
  return `/quiz-media/${path.basename(String(id))}/${name}`;
}

function duplicateQuiz(id) {
  const quiz = readQuiz(id);
  if (!quiz) throw new Error('El cuestionario no existe');
  const copyId = newId(quiz.title);
  fs.cpSync(quizDir(id), quizDir(copyId), { recursive: true });
  const raw = JSON.parse(fs.readFileSync(quizFile(copyId), 'utf8'));
  raw.title = `${quiz.title} (copia)`;
  fs.writeFileSync(quizFile(copyId), JSON.stringify(raw, null, 2));
  return readQuiz(copyId);
}

function deleteQuiz(id) {
  if (fs.existsSync(quizFile(id))) fs.rmSync(quizDir(id), { recursive: true, force: true });
}

function mediaPath(id, file) {
  const p = path.join(mediaDir(id), path.basename(String(file)));
  return fs.existsSync(p) ? p : null;
}

module.exports = { listQuizzes, readQuiz, toPublic, saveQuiz, saveMedia, duplicateQuiz, deleteQuiz, mediaPath, validate };
