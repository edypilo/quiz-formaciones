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
