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

test('cuestionario cloud: crea borrador con tipos compartidos y exige JWT', async () => {
  const previous = [process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, process.env.SUPABASE_ANON_KEY];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const calls = [];
  const fake = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
    if (options.method === 'POST') {
      const payload = JSON.parse(options.body);
      return mock([{ id: 'ac16f472-f345-469e-8f24-5d978073a79b', ...payload }], 201);
    }
    throw Error('Unexpected fetch');
  };
  try {
    await withApi(fake, {}, async (base) => {
      const endpoint = base + '/api/cloud/quizzes';
      const payload = {
        title: 'Quiz de IA', project_id: null, questions: [
          { type: 'quiz', text: '¿Qué es IA?', options: ['A', 'B', '', ''], correct: [0], time: 20, points: 1 },
          { type: 'truefalse', text: '', options: ['Verdadero', 'Falso'], correct: [], time: 10, points: 1 },
          { type: 'poll', text: 'Opinión', options: ['Sí', 'No'], correct: [0], time: 30, points: 1 },
        ],
      };
      const withoutAuth = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      assert.equal(withoutAuth.status, 401);
      const headers = { Authorization: 'Bearer test.jwt.signature', 'Content-Type': 'application/json' };
      const invalid = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ ...payload, questions: [{ type: 'script', text: 'X', options: [], correct: [] }] }) });
      assert.equal(invalid.status, 400);
      const noMedia = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ ...payload, questions: [{ type: 'quiz', text: 'X', options: ['A', 'B'], correct: [], media: { type: 'image', src: 'https://bad.site/x' } }] }) });
      assert.equal(noMedia.status, 400);
      assert.equal(calls.filter((c) => c.options.method === 'POST').length, 0);
      const created = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ ...payload, owner_id: 'someone-else' }) });
      assert.equal(created.status, 201);
      const body = await created.json();
      assert.equal(body.owner_id, USER);
      assert.equal(body.questions[2].points, 0);
      assert.deepEqual(body.questions[2].correct, []);
      assert.equal(body.questions[1].options.length, 2);
      assert.equal(body.questions[1].text, ''); // se permiten borradores
      const call = calls.find((c) => c.options.method === 'POST');
      assert.ok(call.url.includes('/rest/v1/quiz_quizzes?'));
      assert.equal(call.options.headers.Authorization, 'Bearer test.jwt.signature');
    });
  } finally {
    const keys = ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'];
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});

test('cuestionario cloud: edición exige propietario y devuelve 404 si no existe', async () => {
  const previous = [process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, process.env.SUPABASE_ANON_KEY];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const calls = [];
  const fake = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
    return mock([]);
  };
  try {
    await withApi(fake, {}, async (base) => {
      const id = 'ac16f472-f345-469e-8f24-5d978073a79b';
      const headers = { Authorization: 'Bearer test.jwt.signature', 'Content-Type': 'application/json' };
      const payload = { title: 'Actualizado', project_id: null, questions: [] };
      const bad = await fetch(base + '/api/cloud/quizzes/bad-id', { method: 'PATCH', headers, body: JSON.stringify(payload) });
      assert.equal(bad.status, 400);
      const updated = await fetch(base + '/api/cloud/quizzes/' + id, { method: 'PATCH', headers, body: JSON.stringify(payload) });
      assert.equal(updated.status, 404);
      const patch = calls.find((c) => c.options.method === 'PATCH');
      assert.ok(patch.url.includes('owner_id=eq.' + USER));
      assert.ok(patch.url.includes('id=eq.' + id));
      assert.equal(Object.hasOwn(JSON.parse(patch.options.body), 'owner_id'), false);
    });
  } finally {
    const keys = ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'];
    keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});

test('duplicar un cuestionario verifica la propiedad y crea una copia independiente', async () => {
  const previous = [process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, process.env.SUPABASE_ANON_KEY];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const id = 'ac16f472-f345-469e-8f24-5d978073a79b';
  const calls = [];
  const fake = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
    if (options.method === 'POST') {
      const data = JSON.parse(options.body);
      return mock([{ ...data, id: '6c31c119-76af-4ac5-8ea6-c42522034e03' }], 201);
    }
    return mock([{
      id, title: 'Curso de IA', description: '', project_id: null,
      settings: { defaultTime: 20, showTextOnDevice: false, allowLateJoin: true },
      questions: [{ type: 'quiz', text: 'Pregunta', options: ['Uno', 'Dos'], correct: [0], time: 20, points: 1, media: null }]
    }]);
  };
  try {
    await withApi(fake, {}, async (base) => {
      const endpoint = base + '/api/cloud/quizzes/' + id + '/duplicate';
      const unauth = await fetch(endpoint, { method: 'POST' });
      assert.equal(unauth.status, 401);
      const authorized = await fetch(endpoint, { method: 'POST', headers: { Authorization: 'Bearer test.jwt.signature' } });
      assert.equal(authorized.status, 201);
      const result = await authorized.json();
      assert.equal(result.title, 'Curso de IA (copia)');
      assert.equal(result.owner_id, USER);
      const read = calls.find(c => c.url.includes('id=eq.'));
      assert.ok(read.url.includes('owner_id=eq.' + USER));
      const write = calls.find(c => c.options.method === 'POST');
      assert.equal(write.options.headers.Authorization, 'Bearer test.jwt.signature');
      assert.notEqual(result.id, id);
    });
  } finally {
    ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'].forEach((k,i) => {
      if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i];
    });
  }
});

test('eliminar un cuestionario restringe el borrado por propietario y detecta inexistentes', async () => {
  const previous = [process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, process.env.SUPABASE_ANON_KEY];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const id = 'ac16f472-f345-469e-8f24-5d978073a79b';
  let exists = false;
  let deleteUrl = '';
  const fake = async (url, options) => {
    if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
    if (options.method === 'DELETE') {
      deleteUrl = String(url);
      return mock(exists ? [{ id }] : []);
    }
    throw Error('Unexpected fetch');
  };
  try {
    await withApi(fake, {}, async (base) => {
      const headers = { Authorization: 'Bearer test.jwt.signature' };
      const endpoint = base + '/api/cloud/quizzes/' + id;
      assert.equal((await fetch(endpoint, { method: 'DELETE' })).status, 401);
      assert.equal((await fetch(base + '/api/cloud/quizzes/bad-id', { method: 'DELETE', headers })).status, 400);
      assert.equal((await fetch(endpoint, { method: 'DELETE', headers })).status, 404);
      exists = true;
      const result = await fetch(endpoint, { method: 'DELETE', headers });
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { deleted: true, id });
      assert.ok(deleteUrl.includes('owner_id=eq.' + USER));
      assert.ok(deleteUrl.includes('id=eq.' + id));
    });
  } finally {
    ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'].forEach((k,i) => {
      if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i];
    });
  }
});

test('plantillas Word y Excel requieren autenticación y son archivos válidos', async () => {
  const previous = [process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, process.env.SUPABASE_ANON_KEY];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  try {
    await withApi(async (url) => {
      if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
      throw new Error('No debe consultar PostgREST');
    }, {}, async (base) => {
      for (const format of ['xlsx', 'docx']) {
        const url = base + '/api/cloud/templates/' + format;
        assert.equal((await fetch(url)).status, 401);
        const response = await fetch(url, { headers: { Authorization: 'Bearer test.jwt.signature' } });
        assert.equal(response.status, 200);
        const data = Buffer.from(await response.arrayBuffer());
        assert.ok(data.length > 500);
        assert.equal(data.subarray(0, 2).toString(), 'PK');
        assert.ok(response.headers.get('content-disposition').includes('plantilla-quizzz.' + format));
      }
    });
  } finally {
    ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'].forEach((k,i) => {
      if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i];
    });
  }
});

test('importación Excel detecta preguntas pero no modifica datos', async () => {
  const previous = [process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, process.env.SUPABASE_ANON_KEY];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const { buildExcel } = require('../import-export');
  const data = await buildExcel();
  let calls = 0;
  try {
    await withApi(async (url) => {
      if (String(url).endsWith('/auth/v1/user')) { calls++; return mock({ id: USER }); }
      throw new Error('Import no debe escribir en la BD');
    }, {}, async (base) => {
      const endpoint = base + '/api/cloud/import';
      const headers = { Authorization: 'Bearer test.jwt.signature', 'Content-Type': 'application/octet-stream' };
      assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, 'X-Filename': 'test.txt' }, body: data })).status, 400);
      const result = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'X-Filename': 'prueba.xlsx' }, body: data });
      assert.equal(result.status, 200);
      const parsed = await result.json();
      assert.equal(parsed.questions.length, 4);
      assert.ok(parsed.questions.some(q => q.type === 'poll'));
      assert.ok(parsed.questions.every(q => q.media === null));
      assert.ok(calls >= 2);
    });
  } finally {
    ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'].forEach((k,i) => {
      if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i];
    });
  }
});

test('exportación Word exige propietario del cuestionario', async () => {
  const previous = [process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, process.env.SUPABASE_ANON_KEY];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const id = 'ac16f472-f345-469e-8f24-5d978073a79b';
  let found = false;
  let readUrl = '';
  try {
    await withApi(async (url) => {
      if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
      readUrl = String(url);
      return mock(found ? [{
        id, title: 'Formación IA', description: '', project_id: null,
        settings: { defaultTime: 20 }, questions: [{
          type: 'quiz', text: 'Pregunta uno', options: ['A','B'], correct: [0], time: 20, points: 1, explanation: '', media: null,
        }],
      }] : []);
    }, {}, async (base) => {
      const url = base + '/api/cloud/quizzes/' + id + '/export.docx';
      assert.equal((await fetch(url)).status, 401);
      const headers = { Authorization: 'Bearer test.jwt.signature' };
      assert.equal((await fetch(url, { headers })).status, 404);
      found = true;
      const response = await fetch(url, { headers });
      assert.equal(response.status, 200);
      const docx = Buffer.from(await response.arrayBuffer());
      assert.equal(docx.subarray(0, 2).toString(), 'PK');
      assert.ok(readUrl.includes('owner_id=eq.' + USER));
    });
  } finally {
    ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'].forEach((k,i) => {
      if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i];
    });
  }
});

test('multimedia cloud: acepta rutas de usuario y YouTube; rechaza rutas ajenas y dominios falsos', async () => {
  const previous = [process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, process.env.SUPABASE_ANON_KEY];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const mediaPath = USER + '/assets/ac16f472-f345-469e-8f24-5d978073a79b.png';
  const quiz = {
    title: 'Multimedia',
    project_id: null,
    questions: [
      { type: 'quiz', text: 'Con imagen', options: ['Sí','No'], correct: [0], media: { type: 'image', src: mediaPath } },
      { type: 'poll', text: 'Con vídeo', options: ['Sí','No'], correct: [], media: { type: 'youtube', src: 'https://youtu.be/abcdefghijk' } },
    ],
  };
  let inserts = 0;
  const fake = async (url, options) => {
    if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
    if (options.method === 'POST') {
      inserts++;
      return mock([{ id: 'ac16f472-f345-469e-8f24-5d978073a79b', ...JSON.parse(options.body) }], 201);
    }
    throw Error('Unexpected call');
  };
  try {
    await withApi(fake, {}, async (base) => {
      const endpoint = base + '/api/cloud/quizzes';
      const headers = { Authorization: 'Bearer test.jwt.signature', 'Content-Type': 'application/json' };
      const post = (payload) => fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
      const r = await post(quiz);
      assert.equal(r.status, 201);
      const saved = await r.json();
      assert.deepEqual(saved.questions[0].media, { type: 'image', src: mediaPath });
      assert.deepEqual(saved.questions[1].media, { type: 'youtube', src: 'https://www.youtube.com/watch?v=abcdefghijk' });
      assert.equal((await post({ ...quiz, questions: [{
        ...quiz.questions[0], media: { type: 'image', src: '1570d6d0-6b12-48ca-a565-4a08a7dcb171/assets/ac16f472-f345-469e-8f24-5d978073a79b.png' },
      }] })).status, 400);
      assert.equal((await post({ ...quiz, questions: [{
        ...quiz.questions[0], media: { type: 'youtube', src: 'https://youtube.com.evil.example/watch?v=abcdefghijk' },
      }] })).status, 400);
      assert.equal((await post({ ...quiz, questions: [{
        ...quiz.questions[0], media: { type: 'image', src: 'https://external.example/test.png' },
      }] })).status, 400);
      assert.equal((await post({ ...quiz, questions: [{
        ...quiz.questions[0], media: { type: 'image', src: USER + '/assets/ac16f472-f345-469e-8f24-5d978073a79b.svg' },
      }] })).status, 400);
      assert.equal(inserts, 1);
    });
  } finally {
    ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'].forEach((k,i) => {
      if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i];
    });
  }
});

test('salas privadas: sin JWT no se pueden listar ni crear', async () => {
  const before = [process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, process.env.SUPABASE_ANON_KEY];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  try {
    await withApi(async () => { throw Error('No debe conectar sin JWT'); }, {}, async (base) => {
      assert.equal((await fetch(base + '/api/cloud/rooms')).status, 401);
      assert.equal((await fetch(base + '/api/cloud/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quiz_id: 'ac16f472-f345-469e-8f24-5d978073a79b' }),
      })).status, 401);
    });
  } finally {
    ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'].forEach((key,i) => {
      if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i];
    });
  }
});

test('anfitrión: crea sala con PIN 6 cifras y sólo para su cuestionario completo', async () => {
  const before = [process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, process.env.SUPABASE_ANON_KEY];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const quizId = 'ac16f472-f345-469e-8f24-5d978073a79b';
  const roomId = 'd5f47ca1-a416-43a3-8341-6dffca530f3f';
  const calls = [];
  const fake = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
    if (String(url).includes('/rest/v1/quiz_quizzes?')) return mock([{
      id: quizId, title: 'Curso',
      questions: [{ type: 'quiz', text: '¿Pregunta?', options: ['Sí','No'], correct: [0], time: 20, points: 1 }],
    }]);
    if (options.method === 'PATCH') return new Response(null, { status: 204 });
    if (options.method === 'POST') {
      const data = JSON.parse(options.body);
      return mock([{ ...data, id: roomId, expires_at: new Date(Date.now() + 3600000).toISOString() }], 201);
    }
    throw Error('Llamada inesperada');
  };
  try {
    await withApi(fake, {}, async (base) => {
      const headers = { Authorization: 'Bearer test.jwt.signature', 'Content-Type': 'application/json' };
      const bad = await fetch(base + '/api/cloud/rooms', {
        method: 'POST', headers, body: JSON.stringify({ quiz_id: 'no' }),
      });
      assert.equal(bad.status, 400);
      const response = await fetch(base + '/api/cloud/rooms', {
        method: 'POST', headers, body: JSON.stringify({ quiz_id: quizId, owner_id: 'other' }),
      });
      assert.equal(response.status, 201);
      const room = await response.json();
      assert.match(room.pin, /^[0-9]{6}$/);
      const check = calls.find(c => c.url.includes('/quiz_quizzes?'));
      assert.ok(check.url.includes('owner_id=eq.' + USER));
      const write = calls.find(c => c.options.method === 'POST');
      assert.equal(JSON.parse(write.options.body).owner_id, USER);
      assert.equal(JSON.parse(write.options.body).status, 'waiting');
      assert.equal(write.options.headers.Authorization, 'Bearer test.jwt.signature');
    });
  } finally {
    ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'].forEach((key,i) => {
      if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i];
    });
  }
});

test('cierre de salas filtra por propietario y no permite modificar otras columnas', async () => {
  const before = [process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, process.env.SUPABASE_ANON_KEY];
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const roomId = 'd5f47ca1-a416-43a3-8341-6dffca530f3f';
  let patchUrl = '';
  let data;
  const fake = async (url, options) => {
    if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
    if (options.method === 'PATCH') {
      patchUrl = String(url); data = JSON.parse(options.body);
      return mock([{ id: roomId, pin: '987654', status: 'closed' }]);
    }
    throw Error('Llamada inesperada');
  };
  try {
    await withApi(fake, {}, async (base) => {
      const headers = { Authorization: 'Bearer test.jwt.signature' };
      assert.equal((await fetch(base + '/api/cloud/rooms/not-valid/close', { method: 'POST', headers })).status, 400);
      const response = await fetch(base + '/api/cloud/rooms/' + roomId + '/close', { method: 'POST', headers });
      assert.equal(response.status, 200);
      assert.deepEqual(data, { status: 'closed' });
      assert.ok(patchUrl.includes('owner_id=eq.' + USER));
      assert.ok(patchUrl.includes('status=eq.waiting'));
    });
  } finally {
    ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'].forEach((key,i) => {
      if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i];
    });
  }
});

test('host puede abrir una sala propia por RPC y listar jugadores sin token secreto', async () => {
  const keys = ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'];
  const before = keys.map(key => process.env[key]);
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const roomId = 'd5f47ca1-a416-43a3-8341-6dffca530f3f';
  const calls = [];
  const fake = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
    if (String(url).includes('/rpc/quiz_host_open_room')) return mock(true);
    if (String(url).includes('/quiz_rooms?')) return mock([{
      id: roomId, quiz_id: 'ac16f472-f345-469e-8f24-5d978073a79b',
      pin: '643287', join_secret: '65e74e9e-c977-4a08-86fa-f3517cb997b0',
      is_joinable: false, status: 'waiting',
    }]);
    if (String(url).includes('/quiz_room_players?')) return mock([{ id: roomId, nickname: 'Laura' }]);
    throw Error('Unknown request');
  };
  try {
    await withApi(fake, {}, async (base) => {
      const headers = { Authorization: 'Bearer test.jwt.signature' };
      const endpoint = base + '/api/cloud/rooms/' + roomId + '/open';
      assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
      const result = await fetch(endpoint, { method: 'POST', headers });
      assert.equal(result.status, 200);
      const body = await result.json();
      assert.equal(body.is_joinable, true);
      assert.equal(body.join_secret, '65e74e9e-c977-4a08-86fa-f3517cb997b0');
      const rpc = calls.find(call => call.url.endsWith('/rpc/quiz_host_open_room'));
      assert.equal(JSON.parse(rpc.options.body).p_room_id, roomId);
      assert.equal(rpc.options.headers.Authorization, 'Bearer test.jwt.signature');
      const lookup = calls.find(call => call.url.includes('/quiz_rooms?'));
      assert.ok(lookup.url.includes('owner_id=eq.' + USER));
      const players = await fetch(base + '/api/cloud/rooms/' + roomId + '/players', { headers });
      assert.equal(players.status, 200);
      assert.deepEqual(await players.json(), [{ id: roomId, nickname: 'Laura' }]);
      const playerRead = calls.find(call => call.url.includes('/quiz_room_players?'));
      assert.ok(playerRead.url.includes('owner_id=eq.' + USER));
      assert.equal(playerRead.url.includes('token_digest'), false);
    });
  } finally {
    keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; });
  }
});

test('QR protegido requiere JWT y acepta solo URL de invitación de este host', async () => {
  const keys = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'];
  const old = keys.map(k => process.env[k]);
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const roomId = 'd5f47ca1-a416-43a3-8341-6dffca530f3f';
  const invite = '65e74e9e-c977-4a08-86fa-f3517cb997b0';
  let roomQuery = '';
  const fetcher = async (url, options) => {
    if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
    if (String(url).includes('/quiz_rooms?')) {
      roomQuery = String(url);
      return mock([{ id: roomId }]);
    }
    throw Error('Unexpected fetch');
  };
  try {
    await withApi(fetcher, {}, async (base) => {
      const host = new URL(base).host;
      const endpoint = base + '/api/cloud/rooms/' + roomId + '/qr';
      const url = 'https://' + host + '/join?pin=643287&invite=' + invite;
      const body = JSON.stringify({ url });
      const headers = { Authorization: 'Bearer test.jwt.signature', 'Content-Type': 'application/json' };
      assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
      assert.equal((await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ url: 'https://bad.example/join?pin=643287&invite=' + invite }) })).status, 400);
      assert.equal((await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ url: 'https://' + host + '/join?pin=643287&invite=' + invite + '&extra=1' }) })).status, 400);
      const result = await fetch(endpoint, { method: 'POST', headers, body });
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('content-type'), 'image/png');
      const bytes = Buffer.from(await result.arrayBuffer());
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert.ok(roomQuery.includes('owner_id=eq.' + USER));
      assert.ok(roomQuery.includes('pin=eq.643287'));
      assert.ok(roomQuery.includes('join_secret=eq.' + invite));
    });
  } finally {
    keys.forEach((key,i) => { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i]; });
  }
});

test('listado agrupado de participantes exige JWT, filtra propietario y limita salas', async () => {
  const keys = ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY'];
  const saved = keys.map(key => process.env[key]);
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  delete process.env.SUPABASE_ANON_KEY;
  const room1 = 'd5f47ca1-a416-43a3-8341-6dffca530f3f';
  const room2 = '65e74e9e-c977-4a08-86fa-f3517cb997b0';
  let readUrl = '';
  const fake = async (url) => {
    if (String(url).endsWith('/auth/v1/user')) return mock({ id: USER });
    readUrl = String(url);
    return mock([{ id: USER, room_id: room1, nickname: 'Koala Feliz', joined_at: '2026-11-20T10:00:00Z' }]);
  };
  try {
    await withApi(fake, {}, async (base) => {
      const route = base + '/api/cloud/rooms/players';
      assert.equal((await fetch(route + '?ids=' + room1)).status, 401);
      const headers = { Authorization: 'Bearer test.jwt.signature' };
      assert.equal((await fetch(route + '?ids=bad', { headers })).status, 400);
      assert.equal((await fetch(route + '?ids=' + Array(7).fill(room1).join(','), { headers })).status, 400);
      assert.equal((await fetch(route + '?ids=' + room1 + ',' + room1, { headers })).status, 400);
      const result = await fetch(route + '?ids=' + room1 + ',' + room2, { headers });
      assert.equal(result.status, 200);
      const players = await result.json();
      assert.equal(players.length, 1);
      assert.equal(players[0].nickname, 'Koala Feliz');
      assert.ok(readUrl.includes('/quiz_room_players?'));
      assert.ok(readUrl.includes('owner_id=eq.' + USER));
      assert.ok(readUrl.includes('room_id=in.'));
      assert.equal(readUrl.includes('token_digest'), false);
      assert.ok(readUrl.includes('limit=360'));
    });
  } finally {
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
    });
  }
});

test('invitado multimedia: firma temporal solo tras validar token, ruta y fase por RPC', async () => {
  const envKeys=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];
  const old=envKeys.map(k=>process.env[k]);
  const token='5c2a2c33-d1ba-442c-a28d-72f92e05a5df';
  const path=USER+'/assets/ac16f472-f345-469e-8f24-5d978073a79b.png';
  process.env.SUPABASE_URL='https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
  process.env.SUPABASE_SERVICE_ROLE_KEY='service_secret_test';
  delete process.env.SUPABASE_ANON_KEY;
  const calls=[];
  const signedUrl='/object/sign/quiz-media/'+path+'?token=short-lived-token';
  let result={ok:true,owner_id:USER,type:'image',path,index:0};
  const fake=async(url,opts)=>{
    calls.push({url:String(url),options:opts});
    if(String(url).endsWith('/rpc/quiz_guest_active_media'))return mock(result);
    if(String(url).includes('/storage/v1/object/sign/'))return mock({signedURL:signedUrl});
    throw Error('Unexpected URL');
  };
  try {
    await withApi(fake,{},async(base)=>{
      const endpoint=base+'/api/cloud/guest/media';
      const post=(payload)=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)});
      assert.equal((await post({token:'invalid'})).status,400);
      assert.equal(calls.length,0);
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      assert.equal((await post({token})).status,503);
      process.env.SUPABASE_SERVICE_ROLE_KEY='service_secret_test';
      assert.equal(calls.length,0);
      const ok=await post({token});
      assert.equal(ok.status,200);
      const body=await ok.json();
      assert.equal(body.ok,true);
      assert.equal(body.index,0);
      assert.equal(body.expiresIn,30);
      assert.equal(body.url,'https://example.supabase.co/storage/v1'+signedUrl);
      assert.equal(calls.length,2);
      assert.equal(calls[0].options.headers.apikey,'sb_publishable_test');
      assert.equal(calls[0].options.headers.Authorization,undefined);
      assert.equal(calls[1].options.headers.apikey,'service_secret_test');
      assert.equal(calls[1].options.headers.Authorization,'Bearer service_secret_test');
      assert.equal(JSON.parse(calls[1].options.body).expiresIn,30);
      result={ok:false,error:'question_not_active'};
      assert.equal((await post({token})).status,403);
      assert.equal(calls.length,3);
      result={ok:true,owner_id:USER,type:'image',path:'different-owner/assets/ac16f472-f345-469e-8f24-5d978073a79b.png',index:0};
      assert.equal((await post({token})).status,403);
      assert.equal(calls.length,4);
      assert.equal((await post({token,src:path})).status,400);
      assert.equal(calls.length,4);
    });
  } finally {
    envKeys.forEach((key,i)=>{if(old[i]===undefined)delete process.env[key];else process.env[key]=old[i];});
  }
});
