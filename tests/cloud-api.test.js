'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { makeRouter } = require('../cloud/api');

const USER = '1570d6d0-6b12-48ca-a565-4a08a7dcb170';
async function withApi(fetcher, headers, fn) {
  const app = express();
  app.use('/api/cloud', makeRouter(fetcher));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await fn(origin, headers); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
function mock(response, status = 200) {
  return new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } });
}

test('sin configuración responde 503 y no consulta proveedores externos', async () => {
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY;
  try {
    await withApi(() => { throw Error('No debe conectar'); }, {}, async (base) => {
      const response = await fetch(base + '/api/cloud/me');
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, 'supabase_not_configured');
    });
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldKey;
  }
});

test('requiere token válido, consulta RLS con JWT del usuario y no expone credenciales', async () => {
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co/';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';
  const calls = [];
  const fake = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
    if (String(url).includes('/rest/v1/quiz_projects?')) return mock([{ id: USER, name: 'Test' }]);
    throw Error('Ruta inesperada');
  };
  try {
    await withApi(fake, {}, async (base) => {
      assert.equal((await fetch(base + '/api/cloud/me')).status, 401);
      const headers = { Authorization: 'Bearer test.jwt.signature' };
      const me = await fetch(base + '/api/cloud/me', { headers });
      assert.equal(me.status, 200);
      assert.deepEqual(await me.json(), { id: USER });
      const projects = await fetch(base + '/api/cloud/projects', { headers });
      assert.equal(projects.status, 200);
      assert.deepEqual(await projects.json(), [{ id: USER, name: 'Test' }]);
      assert.equal(calls.length, 3);
      assert.ok(calls.every((c) => c.headers.Authorization === 'Bearer test.jwt.signature'));
      assert.ok(calls.every((c) => c.headers.apikey === 'public-test-key'));
      assert.ok(calls[2].url.includes('quiz_projects'));
      assert.equal((await fetch(base + '/api/cloud/unknown', { headers })).status, 404);
    });
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldKey;
  }
});

test('Supabase rechaza JWT: no se realizan consultas a tablas', async () => {
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co/';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';
  let count = 0;
  try {
    await withApi(async () => { count++; return mock({ message: 'Invalid JWT' }, 401); }, {}, async (base) => {
      const response = await fetch(base + '/api/cloud/quizzes', { headers: { Authorization: 'Bearer invalid' } });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, 'invalid_token');
      assert.equal(count, 1);
    });
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldKey;
  }
});

test('config publica entrega solo URL y publishable key', async () => {
  const beforeUrl = process.env.SUPABASE_URL;
  const beforePublish = process.env.SUPABASE_PUBLISHABLE_KEY;
  const beforeAnon = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  try {
    await withApi(() => { throw new Error('No debe llamar a Supabase'); }, {}, async (base) => {
      const response = await fetch(base + '/api/cloud/config');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {
        supabaseUrl: 'https://example.supabase.co',
        publishableKey: 'sb_publishable_test',
      });
    });
  } finally {
    if (beforeUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = beforeUrl;
    if (beforePublish === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = beforePublish;
    if (beforeAnon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = beforeAnon;
  }
});
