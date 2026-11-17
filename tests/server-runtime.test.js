'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');

function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}
async function waitFor(url, child) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) throw new Error('Servidor terminado antes del health-check');
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('No responde el servidor de prueba');
}
async function withServer(cloud, callback) {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'quiz-vercel-test-'));
  const child = spawn(process.execPath, ['-e', cloud
    ? "const server = require('./server'); server.listen(Number(process.env.PORT), '127.0.0.1')"
    : "require('./server').startLocalServer()"
  ], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), QUIZ_DATA_DIR: dataDir, QUIZ_NO_BROWSER: '1',
      ...(cloud ? { QUIZ_RUNTIME: 'cloud' } : { QUIZ_RUNTIME: 'local', VERCEL: '' }) },
  });
  let errorLog = '';
  child.stderr.on('data', (chunk) => { errorLog += chunk.toString(); });
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/api/health`, child);
    await callback(base);
  } catch (error) {
    throw new Error(`${error.message}\n${errorLog}`);
  } finally {
    child.kill();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test('modo local: health y acceso al presentador por localhost', async () => {
  await withServer(false, async (base) => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, true);
    const host = await fetch(`${base}/host`);
    assert.equal(host.status, 200);
    assert.match(await host.text(), /<html/i);
  });
});

test('modo cloud: disponible el health-check pero bloqueadas las rutas privadas', async () => {
  await withServer(true, async (base) => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.deepEqual(health, { ok: true, runtime: 'cloud', ready: false });
    const landing = await fetch(`${base}/`);
    assert.equal(landing.status, 200);
    assert.match(await landing.text(), /Versión cloud en preparación/);
    assert.equal(landing.headers.get('x-robots-tag'), 'noindex, nofollow');
    for (const target of ['/host', '/editor', '/admin', '/api/quizzes', '/play', '/admin.html', '/editor.html']) {
      const response = await fetch(`${base}${target}`);
      assert.equal(response.status, 503, target);
      assert.equal((await response.json()).error, 'cloud_setup_required');
    }
  });
});
