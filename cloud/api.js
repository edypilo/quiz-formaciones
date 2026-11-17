'use strict';

// Fase 2: API de lectura cloud aislada. La app de escritorio no usa este módulo.
// No se utiliza SERVICE_ROLE_KEY: PostgreSQL aplica RLS con el JWT real del usuario.
const express = require('express');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tables = Object.freeze({
  projects: { table: 'quiz_projects', columns: 'id,name,title,organization,branding,created_at,updated_at' },
  quizzes: { table: 'quiz_quizzes', columns: 'id,project_id,title,description,settings,questions,created_at,updated_at' },
});

function configuration() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  let origin;
  try {
    origin = new URL(url);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' ||
      origin.search || origin.hash) return null;
  } catch { return null; }
  return { url: origin.origin, key };
}

function bearer(value) {
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(String(value || ''));
  return match ? match[1] : null;
}

async function readJson(response) {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function normalizeProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) return null;
  const name = input.name.trim();
  const title = input.title === undefined || input.title === '' ? name : input.title;
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 80) return null;
  const organization = input.organization === undefined ? '' : input.organization;
  if (typeof organization !== 'string' || organization.trim().length > 80) return null;

  // Se admiten colores y roles pero no HTML, imágenes ni URLs arbitrarias.
  const branding = input.branding === undefined ? {} : input.branding;
  if (!branding || typeof branding !== 'object' || Array.isArray(branding)) return null;
  const colors = branding.colors === undefined ? ['#6989E6', '#EFA6A4'] : branding.colors;
  if (!Array.isArray(colors) || colors.length < 1 || colors.length > 12 ||
      !colors.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) return null;
  const roles = branding.roles === undefined ? {} : branding.roles;
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) return null;
  const primary = roles.primary === undefined ? 0 : roles.primary;
  const accent = roles.accent === undefined ? Math.min(1, colors.length - 1) : roles.accent;
  const background = roles.background === undefined ? 'auto' : roles.background;
  const validIndex = (index) => Number.isInteger(index) && index >= 0 && index < colors.length;
  if (!validIndex(primary) || !validIndex(accent) ||
      !(background === 'auto' || validIndex(background))) return null;
  return {
    name, title: title.trim(), organization: organization.trim(),
    branding: {
      colors,
      roles: { primary, accent, background },
      fundersPlacement: branding.fundersPlacement === 'always' ? 'always' : 'lobby',
    },
  };
}


// Comparte la validación de tipos con el editor local. Se admiten borradores
// incompletos, pero nunca formatos desconocidos ni multimedia sin migrar.
const { getType, normalizeQuestion } = require('../public/question-types');
function normalizeQuiz(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (typeof input.title !== 'string' || input.title.trim().length < 1 || input.title.trim().length > 120) return null;
  const description = input.description === undefined ? '' : input.description;
  if (typeof description !== 'string' || description.length > 300) return null;
  const projectId = input.project_id === undefined || input.project_id === '' ? null : input.project_id;
  if (projectId !== null && (typeof projectId !== 'string' || !uuid.test(projectId))) return null;
  const rawSettings = input.settings === undefined ? {} : input.settings;
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) return null;
  const defaultTime = rawSettings.defaultTime === undefined ? 20 : Number(rawSettings.defaultTime);
  if (!Number.isInteger(defaultTime) || defaultTime < 5 || defaultTime > 240) return null;
  if (rawSettings.showTextOnDevice !== undefined && typeof rawSettings.showTextOnDevice !== 'boolean') return null;
  if (rawSettings.allowLateJoin !== undefined && typeof rawSettings.allowLateJoin !== 'boolean') return null;
  const settings = {
    defaultTime,
    showTextOnDevice: rawSettings.showTextOnDevice === true,
    allowLateJoin: rawSettings.allowLateJoin !== false,
  };
  if (!Array.isArray(input.questions) || input.questions.length > 200) return null;
  const questions = [];
  for (const original of input.questions) {
    if (!original || typeof original !== 'object' || Array.isArray(original)) return null;
    const type = getType(original.type);
    if (!type || !type.available) return null;
    if (original.media !== undefined && original.media !== null) return null;
    if (typeof original.text !== 'string' || original.text.length > 250) return null;
    if (!Array.isArray(original.options) || original.options.length > 4 ||
      !original.options.every((option) => typeof option === 'string' && option.length <= 120)) return null;
    if (!Array.isArray(original.correct) || original.correct.length > 4 ||
      !original.correct.every((index) => Number.isInteger(index) && index >= 0 && index <= 3)) return null;
    if (original.explanation !== undefined &&
      (typeof original.explanation !== 'string' || original.explanation.length > 400)) return null;
    if (original.time !== undefined &&
      (!Number.isInteger(Number(original.time)) || Number(original.time) < 5 || Number(original.time) > 240)) return null;
    if (original.points !== undefined && ![0, 1, 2].includes(Number(original.points))) return null;
    questions.push(normalizeQuestion(original, settings.defaultTime).question);
  }
  return { title: input.title.trim(), description: description.trim(), project_id: projectId, settings, questions };
}
function makeRouter(fetcher = fetch) {
  const router = express.Router();
  // Únicamente datos públicos del proyecto: nunca devolver claves de servicio.
  router.get('/config', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const config = configuration();
    if (!config) return res.status(503).json({ error: 'supabase_not_configured' });
    return res.json({ supabaseUrl: config.url, publishableKey: config.key });
  });

  router.use(async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const config = configuration();
    if (!config) return res.status(503).json({ error: 'supabase_not_configured' });
    const jwt = bearer(req.headers.authorization);
    if (!jwt) return res.status(401).json({ error: 'authentication_required' });

    try {
      const response = await fetcher(`${config.url}/auth/v1/user`, {
        headers: { apikey: config.key, Authorization: `Bearer ${jwt}` },
        signal: AbortSignal.timeout(8000),
      });
      const identity = await readJson(response);
      if (!response.ok || !identity || !uuid.test(identity.id || ''))
        return res.status(401).json({ error: 'invalid_token' });
      req.cloud = { ...config, jwt, userId: identity.id };
      next();
    } catch {
      return res.status(502).json({ error: 'authentication_provider_unavailable' });
    }
  });

  router.get('/me', (req, res) => res.json({ id: req.cloud.userId }));

  const jsonProject = express.json({ limit: '16kb' });
  function requestHeaders(cloud) {
    return {
      apikey: cloud.key,
      Authorization: 'Bearer ' + cloud.jwt,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
  }

  router.post('/projects', jsonProject, async (req, res) => {
    const data = normalizeProject(req.body);
    if (!data) return res.status(400).json({ error: 'invalid_project' });
    const { url, userId } = req.cloud;
    try {
      const response = await fetcher(url + '/rest/v1/quiz_projects?select=' +
        encodeURIComponent(tables.projects.columns), {
        method: 'POST',
        headers: requestHeaders(req.cloud),
        body: JSON.stringify({ ...data, owner_id: userId }),
        signal: AbortSignal.timeout(8000),
      });
      const body = await readJson(response);
      if (!response.ok || !Array.isArray(body) || !body[0])
        return res.status(502).json({ error: 'database_write_failed' });
      return res.status(201).json(body[0]);
    } catch {
      return res.status(502).json({ error: 'database_unavailable' });
    }
  });

  router.patch('/projects/:id', jsonProject, async (req, res) => {
    if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'invalid_project_id' });
    const data = normalizeProject(req.body);
    if (!data) return res.status(400).json({ error: 'invalid_project' });
    const { url, userId } = req.cloud;
    const params = new URLSearchParams({
      id: 'eq.' + req.params.id,
      owner_id: 'eq.' + userId,
      select: tables.projects.columns,
    });
    try {
      const response = await fetcher(url + '/rest/v1/quiz_projects?' + params, {
        method: 'PATCH',
        headers: requestHeaders(req.cloud),
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(8000),
      });
      const body = await readJson(response);
      if (!response.ok || !Array.isArray(body))
        return res.status(502).json({ error: 'database_write_failed' });
      if (body.length === 0) return res.status(404).json({ error: 'project_not_found' });
      return res.json(body[0]);
    } catch {
      return res.status(502).json({ error: 'database_unavailable' });
    }
  });


  const jsonQuiz = express.json({ limit: '512kb' });
  router.post('/quizzes', jsonQuiz, async (req, res) => {
    const data = normalizeQuiz(req.body);
    if (!data) return res.status(400).json({ error: 'invalid_quiz' });
    const { url, userId } = req.cloud;
    try {
      const response = await fetcher(url + '/rest/v1/quiz_quizzes?select=' +
        encodeURIComponent(tables.quizzes.columns), {
        method: 'POST',
        headers: requestHeaders(req.cloud),
        body: JSON.stringify({ ...data, owner_id: userId }),
        signal: AbortSignal.timeout(8000),
      });
      const result = await readJson(response);
      if (!response.ok || !Array.isArray(result) || !result[0])
        return res.status(502).json({ error: 'database_write_failed' });
      return res.status(201).json(result[0]);
    } catch {
      return res.status(502).json({ error: 'database_unavailable' });
    }
  });

  router.get('/quizzes/:id', async (req, res) => {
    if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'invalid_quiz_id' });
    const { url, userId } = req.cloud;
    const params = new URLSearchParams({
      id: 'eq.' + req.params.id,
      owner_id: 'eq.' + userId,
      select: tables.quizzes.columns,
      limit: '1',
    });
    try {
      const response = await fetcher(url + '/rest/v1/quiz_quizzes?' + params, {
        headers: { apikey: req.cloud.key, Authorization: 'Bearer ' + req.cloud.jwt },
        signal: AbortSignal.timeout(8000),
      });
      const records = await readJson(response);
      if (!response.ok || !Array.isArray(records)) return res.status(502).json({ error: 'database_query_failed' });
      if (!records.length) return res.status(404).json({ error: 'quiz_not_found' });
      return res.json(records[0]);
    } catch {
      return res.status(502).json({ error: 'database_unavailable' });
    }
  });

  router.patch('/quizzes/:id', jsonQuiz, async (req, res) => {
    if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'invalid_quiz_id' });
    const data = normalizeQuiz(req.body);
    if (!data) return res.status(400).json({ error: 'invalid_quiz' });
    const { url, userId } = req.cloud;
    const params = new URLSearchParams({
      id: 'eq.' + req.params.id,
      owner_id: 'eq.' + userId,
      select: tables.quizzes.columns,
    });
    try {
      const response = await fetcher(url + '/rest/v1/quiz_quizzes?' + params, {
        method: 'PATCH',
        headers: requestHeaders(req.cloud),
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(8000),
      });
      const records = await readJson(response);
      if (!response.ok || !Array.isArray(records)) return res.status(502).json({ error: 'database_write_failed' });
      if (!records.length) return res.status(404).json({ error: 'quiz_not_found' });
      return res.json(records[0]);
    } catch {
      return res.status(502).json({ error: 'database_unavailable' });
    }
  });


  // Operaciones avanzadas con comprobación de propietario en cada consulta.
  router.post('/quizzes/:id/duplicate', async (req, res) => {
    if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'invalid_quiz_id' });
    const { url, userId } = req.cloud;
    const params = new URLSearchParams({
      id: 'eq.' + req.params.id,
      owner_id: 'eq.' + userId,
      select: tables.quizzes.columns,
      limit: '1',
    });
    try {
      const read = await fetcher(url + '/rest/v1/quiz_quizzes?' + params, {
        headers: { apikey: req.cloud.key, Authorization: 'Bearer ' + req.cloud.jwt },
        signal: AbortSignal.timeout(8000),
      });
      const rows = await readJson(read);
      if (!read.ok || !Array.isArray(rows)) return res.status(502).json({ error: 'database_query_failed' });
      if (rows.length === 0) return res.status(404).json({ error: 'quiz_not_found' });
      const original = rows[0];
      const suffix = ' (copia)';
      const data = normalizeQuiz({
        title: String(original.title || '').slice(0, 120 - suffix.length) + suffix,
        description: original.description,
        project_id: original.project_id,
        settings: original.settings,
        questions: original.questions,
      });
      if (!data) return res.status(422).json({ error: 'invalid_quiz_source' });
      const response = await fetcher(url + '/rest/v1/quiz_quizzes?select=' +
        encodeURIComponent(tables.quizzes.columns), {
        method: 'POST',
        headers: requestHeaders(req.cloud),
        body: JSON.stringify({ ...data, owner_id: userId }),
        signal: AbortSignal.timeout(8000),
      });
      const result = await readJson(response);
      if (!response.ok || !Array.isArray(result) || !result[0])
        return res.status(502).json({ error: 'database_write_failed' });
      return res.status(201).json(result[0]);
    } catch {
      return res.status(502).json({ error: 'database_unavailable' });
    }
  });

  router.delete('/quizzes/:id', async (req, res) => {
    if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'invalid_quiz_id' });
    const { url, userId } = req.cloud;
    const params = new URLSearchParams({
      id: 'eq.' + req.params.id,
      owner_id: 'eq.' + userId,
      select: 'id',
    });
    try {
      const response = await fetcher(url + '/rest/v1/quiz_quizzes?' + params, {
        method: 'DELETE',
        headers: requestHeaders(req.cloud),
        signal: AbortSignal.timeout(8000),
      });
      const rows = await readJson(response);
      if (!response.ok || !Array.isArray(rows)) return res.status(502).json({ error: 'database_delete_failed' });
      if (rows.length === 0) return res.status(404).json({ error: 'quiz_not_found' });
      return res.json({ deleted: true, id: rows[0].id });
    } catch {
      return res.status(502).json({ error: 'database_unavailable' });
    }
  });

  router.get('/:resource', async (req, res) => {
    const resource = tables[req.params.resource];
    if (!resource) return res.status(404).json({ error: 'not_found' });
    const { url, key, jwt } = req.cloud;
    const params = new URLSearchParams({
      select: resource.columns,
      order: 'updated_at.desc',
      limit: '100',
    });
    try {
      const response = await fetcher(`${url}/rest/v1/${resource.table}?${params}`, {
        headers: { apikey: key, Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const body = await readJson(response);
      if (!response.ok) return res.status(502).json({ error: 'database_query_failed' });
      if (!Array.isArray(body)) return res.status(502).json({ error: 'invalid_database_response' });
      return res.json(body);
    } catch {
      return res.status(502).json({ error: 'database_unavailable' });
    }
  });
  return router;
}
module.exports = { makeRouter };
