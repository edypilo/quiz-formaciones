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

test('crear proyecto exige token, valida datos e inserta para el usuario autenticado', async () => {
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const oldAnon = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
    if (options.method === 'POST') return mock([{ id: 'ac16f472-f345-469e-8f24-5d978073a79b', name: 'Clase de IA' }], 201);
    throw Error('Unexpected request');
  };
  try {
    await withApi(mockFetch, {}, async (base) => {
      const payload = { name: 'Clase de IA', title: 'Formación IA', branding: { colors: ['#6989e6', '#efa6a4'] } };
      const noAuth = await fetch(base + '/api/cloud/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      assert.equal(noAuth.status, 401);
      const headers = { Authorization: 'Bearer test.jwt.signature', 'Content-Type': 'application/json' };
      const invalid = await fetch(base + '/api/cloud/projects', {
        method: 'POST', headers, body: JSON.stringify({ name: '', owner_id: 'anyone' }),
      });
      assert.equal(invalid.status, 400);
      assert.equal(calls.length, 1); // solo auth, ninguna escritura
      const result = await fetch(base + '/api/cloud/projects', {
        method: 'POST', headers, body: JSON.stringify({ ...payload, owner_id: 'someone-else' })
      });
      assert.equal(result.status, 201);
      const insertion = calls.find((c) => c.options.method === 'POST');
      assert.ok(insertion);
      const body = JSON.parse(insertion.options.body);
      assert.equal(body.owner_id, USER);
      assert.equal(body.name, 'Clase de IA');
      assert.equal(body.branding.roles.primary, 0);
      assert.equal(insertion.options.headers.Authorization, 'Bearer test.jwt.signature');
    });
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
    if (oldAnon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldAnon;
  }
});

test('actualización restringe proyecto por ID y propietario', async () => {
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const oldAnon = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
    if (options.method === 'PATCH') return mock([]);
    throw Error('Unexpected request');
  };
  const projectId = 'ac16f472-f345-469e-8f24-5d978073a79b';
  try {
    await withApi(mockFetch, {}, async (base) => {
      const headers = { Authorization: 'Bearer test.jwt.signature', 'Content-Type': 'application/json' };
      const invalid = await fetch(base + '/api/cloud/projects/bad-id', {
        method: 'PATCH', headers, body: JSON.stringify({ name: 'Valido' }),
      });
      assert.equal(invalid.status, 400);
      const response = await fetch(base + '/api/cloud/projects/' + projectId, {
        method: 'PATCH', headers, body: JSON.stringify({ name: 'Actualizado', title: 'Actualizado', organization: '' }),
      });
      assert.equal(response.status, 404);
      const patch = calls.find((c) => c.options.method === 'PATCH');
      assert.ok(patch.url.includes('owner_id=eq.' + USER));
      assert.ok(patch.url.includes('id=eq.' + projectId));
      assert.equal('owner_id' in JSON.parse(patch.options.body), false);
    });
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
    if (oldAnon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldAnon;
  }
});
