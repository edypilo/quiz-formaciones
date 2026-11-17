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

function makeRouter(fetcher = fetch) {
  const router = express.Router();
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
