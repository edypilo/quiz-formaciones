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
    const cloudAdmin = await fetch(`${base}/cloud-admin`);
    assert.equal(cloudAdmin.status, 200);
    assert.match(await cloudAdmin.text(), /Gestiona tus cuestionarios/);
    const csp = cloudAdmin.headers.get('content-security-policy');
    assert.match(csp, /img-src 'self' blob:/);
    assert.match(csp, /media-src 'self' blob:/);
    assert.match(csp, /wss:\/\/\*\.supabase\.co/);
    assert.doesNotMatch(csp, /img-src[^;]*https:\/\//);
    assert.doesNotMatch(csp, /media-src[^;]*https:\/\//);
    const presenterPage = await fetch(`${base}/presenter?room=d5f47ca1-a416-43a3-8341-6dffca530f3f`);
    assert.equal(presenterPage.status, 200);
    const presenterHtml = await presenterPage.text();
    assert.match(presenterHtml, /Escanea y participa/);
    assert.match(presenterHtml, /id="responses"/);
    assert.match(presenterHtml, /id="podium-screen"/);
    const realtimeJs = await fetch(`${base}/cloud-realtime-host.js`);
    assert.equal(realtimeJs.status, 200);
    assert.match(await realtimeJs.text(), /realtime\/v1\/websocket/);
    const presenterJs = await fetch(`${base}/presenter.js`);
    assert.equal(presenterJs.status, 200);
    assert.match(await presenterJs.text(), /quizzz:presenter-auth-request/);
    const guestPage = await fetch(`${base}/join`);
    assert.equal(guestPage.status, 200);
    assert.match(await guestPage.text(), /Entra a jugar/);
    const nameScript = await fetch(`${base}/cloud-names.js`);
    assert.equal(nameScript.status, 200);
    assert.match(await nameScript.text(), /window\.QuizzzNames/);
    const guestScript = await fetch(`${base}/join.js`);
    assert.equal(guestScript.status, 200);
    assert.match(await guestScript.text(), /quiz_guest_join/);
    const effectsScript = await fetch(`${base}/cloud-effects.js`);
    assert.equal(effectsScript.status, 200);
    assert.match(await effectsScript.text(), /function confetti/);
    const presentationScript = await fetch(`${base}/cloud-presentation.js`);
    assert.equal(presentationScript.status, 200);
    assert.match(await presentationScript.text(), /openPodium/);
    const adminMarkup = await fetch(`${base}/cloud-admin`);
    const adminHtml = await adminMarkup.text();
    assert.match(adminHtml, /id="game-presentation-dialog"/);
    assert.match(adminHtml, /id="game-host-ranking"/);
    assert.match(adminHtml, /id="game-host-podium"/);
    const adminScript = await fetch(`${base}/cloud-admin.js`);
    assert.equal(adminScript.status, 200);
    assert.ok((await adminScript.text()).includes('grant_type=password'));
    for (const target of ['/host', '/editor', '/admin', '/api/quizzes', '/play', '/admin.html', '/editor.html']) {
      const response = await fetch(`${base}${target}`);
      assert.equal(response.status, 503, target);
      assert.equal((await response.json()).error, 'cloud_setup_required');
    }
  });
});
