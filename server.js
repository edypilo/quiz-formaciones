// Servidor del quiz: sirve la pantalla del presentador (/host) y la de los jugadores (/play)
// y sincroniza la partida en tiempo real con Socket.IO.
const express = require('express');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { generateName } = require('./names');
const projects = require('./projects');
const quizzes = require('./quizzes');
const importExport = require('./import-export');
const { getType, toPlayable } = require('./public/question-types');
const tunnel = require('./tunnel');
const { DATA_DIR, ensureDataDirs } = require('./paths');
const { version: VERSION, repository } = require('./package.json');

// En la nube, durante la migración, arrancamos sin tocar el sistema de archivos local.
const IS_CLOUD = process.env.VERCEL === '1' || process.env.QUIZ_RUNTIME === 'cloud';
const PORT = Number(process.env.PORT) || 3000;
if (!IS_CLOUD) ensureDataDirs();

// ---------- Aviso de versión nueva (consulta GitHub al arrancar; sin internet, se ignora) ----------

let latestRelease = null;
const REPO = String(repository?.url || '').match(/github\.com\/([^/]+\/[^/.]+)/)?.[1];
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => String(v).replace(/^v/, '').split('.').map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
if (REPO && !IS_CLOUD) {
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((r) => { if (r?.tag_name && newer(r.tag_name, VERSION)) latestRelease = { version: r.tag_name.replace(/^v/, ''), url: r.html_url }; })
    .catch(() => {});
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Despliegue seguro por defecto: hasta tener autenticación, BD y Redis,
// el modo nube solo responde a health-check. La versión local no cambia.
if (IS_CLOUD) {
  // Comprobación de despliegue sin exponer la aplicación mientras se migra.
  app.get('/', require('./cloud/landing').cloudLanding);
  const sendCloudFile = (name, type) => (_req, res) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': type === 'html'
        ? "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' https://*.supabase.co; img-src 'self' blob:; media-src 'self' blob:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'"
        : "default-src 'none'",
    });
    return res.type(type).sendFile(path.join(__dirname, 'cloud', name));
  };
  app.get('/cloud-admin', sendCloudFile('admin.html', 'html'));
  app.get('/cloud-admin.js', sendCloudFile('admin.js', 'js'));
  app.get('/join', sendCloudFile('join.html', 'html'));
  app.get('/join.js', sendCloudFile('join.js', 'js'));
  app.get('/cloud-names.js', sendCloudFile('names.js', 'js'));
  app.get('/cloud-effects.js', sendCloudFile('effects.js', 'js'));
  app.get('/cloud-presentation.js', sendCloudFile('presentation.js', 'js'));
  app.get('/presenter', sendCloudFile('presenter.html', 'html'));
  app.get('/presenter.js', sendCloudFile('presenter.js', 'js'));
  app.get('/cloud-realtime-host.js', sendCloudFile('realtime-host.js', 'js'));
  // API cloud protegida. El resto de la app permanece deshabilitada hasta migrar salas y editor.
  app.use('/api/cloud', require('./cloud/api').makeRouter());
  io.use((_socket, next) => next(new Error('cloud_setup_required')));
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    return res.status(503).json({
      error: 'cloud_setup_required',
      message: 'La versión en la nube aún no está habilitada.',
    });
  });
}

// ---------- Utilidades ----------

// «Este ordenador» = conexión desde la propia máquina, dirigida a localhost y sin pasar por un
// túnel o proxy. Los túneles (Cloudflare, Tailscale Funnel…) también conectan desde la propia
// máquina, pero añaden estas cabeceras y usan otro nombre de host: así no se cuelan como locales.
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'cf-ray', 'tailscale-funnel-request'];
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function isLocalRequest(address = '', headers = {}) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return false;
  if (PROXY_HEADERS.some((h) => h in headers)) return false;
  return LOCAL_HOSTS.test(headers.host || '');
}

// Identidad visual de un proyecto; si no existe, la del primero disponible.
function branding(projectId) {
  return projects.toPublic((projectId && projects.readProject(projectId)) || projects.listProjects()[0]);
}

// IPs de la red local, ordenadas para que la Wi-Fi salga primero.
function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push({ name, address: a.address });
    }
  }
  const score = (n) => (/wi-?fi|wlan|inal/i.test(n) ? 0 : /virtual|vmware|vethernet|tailscale|docker|wsl/i.test(n) ? 2 : 1);
  return out.sort((a, b) => score(a.name) - score(b.name));
}

const isScored = (q) => !!getType(q.type)?.scored;

// ---------- Estado de las salas ----------

const rooms = new Map(); // pin -> room

function newPin() {
  let pin;
  do pin = String(Math.floor(100000 + Math.random() * 900000)); while (rooms.has(pin));
  return pin;
}

function playerList(room) {
  return [...room.players.values()].map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, connected: !!p.socketId }));
}

// Orden por puntos; en caso de empate, gana quien haya acertado más rápido en total.
function ranking(room) {
  return [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, score: p.score, fastMs: p.fastMs }))
    .sort((a, b) => b.score - a.score || a.fastMs - b.fastMs)
    .map(({ fastMs, ...r }, i) => ({ ...r, position: i + 1 }));
}

// Fotografía de la clasificación antes de cada pregunta, para animar los cambios de puesto.
// Mientras nadie tiene puntos (inicio o tras encuestas) no hay puesto anterior real que comparar.
function snapshot(room) {
  const rank = ranking(room);
  if (rank.every((r) => r.score === 0)) return new Map();
  return new Map(rank.map((r) => [r.id, { position: r.position, score: r.score }]));
}

const TOP = 5;
const PODIUM_MS = 9500; // duración de la secuencia del podio; los móviles esperan para no destriparla

function leaderboard(room) {
  const before = room.prevRanking || new Map();
  const after = ranking(room);
  const entry = (r) => ({ ...r, prevPosition: before.get(r.id)?.position || null, prevScore: before.get(r.id)?.score || 0 });
  const top = after.slice(0, TOP).map(entry);
  // Los que estaban en el top y han salido, para animar su salida.
  const leaving = after.filter((r) => r.position > TOP && (before.get(r.id)?.position || 99) <= TOP).map(entry);
  return { top, leaving, last: room.qIndex >= room.quiz.questions.length - 1 };
}

function emitPlayers(room) {
  io.to(room.hostSocketId).emit('room:players', playerList(room));
}

function startQuestion(room) {
  const q = room.quiz.questions[room.qIndex];
  const time = q.time || room.quiz.settings?.defaultTime || 20;
  room.state = 'question';
  room.prevRanking = snapshot(room);
  room.answers = new Map();
  room.questionStart = Date.now();
  room.questionTime = time;

  io.to(room.hostSocketId).emit('question:show', {
    index: room.qIndex, total: room.quiz.questions.length, type: q.type, points: q.points,
    text: q.text, media: q.media, options: q.options, time,
  });
  io.to(`players:${room.pin}`).emit('question:show', {
    index: room.qIndex, total: room.quiz.questions.length, time, type: q.type,
    options: room.quiz.settings?.showTextOnDevice ? q.options : q.options.map(() => ''),
    text: room.quiz.settings?.showTextOnDevice ? q.text : null,
  });

  clearTimeout(room.timer);
  room.timer = setTimeout(() => revealQuestion(room), time * 1000 + 300);
}

function revealQuestion(room) {
  if (room.state !== 'question') return;
  clearTimeout(room.timer);
  room.state = 'reveal';
  const q = room.quiz.questions[room.qIndex];
  const scored = isScored(q);
  const distribution = q.options.map(() => 0);
  for (const a of room.answers.values()) distribution[a.choice]++;

  const rank = ranking(room);
  for (const p of room.players.values()) {
    const a = room.answers.get(p.id);
    p.history[room.qIndex] = a ? { choice: a.choice, correct: a.correct, points: a.points, ms: a.ms } : null;
    if (p.socketId) {
      io.to(p.socketId).emit('question:result', {
        answered: !!a, scored, correct: a?.correct || false, points: a?.points || 0,
        score: p.score, position: rank.findIndex((r) => r.id === p.id) + 1,
        prevPosition: room.prevRanking?.get(p.id)?.position || null,
        correctOptions: q.correct.map((i) => q.options[i]), explanation: q.explanation || '',
      });
    }
  }
  io.to(room.hostSocketId).emit('question:reveal', {
    type: q.type, scored, correct: q.correct, explanation: q.explanation || '', distribution, answered: room.answers.size, players: room.players.size,
  });
}

function questionStats(room) {
  return room.quiz.questions.slice(0, room.qIndex + 1).map((q, i) => {
    const hist = [...room.players.values()].map((p) => p.history[i]).filter((h) => h !== undefined);
    const base = { index: i, text: q.text, type: q.type, players: hist.length };
    if (!isScored(q)) {
      // Encuestas: reparto de votos en lugar de % de acierto.
      const votes = q.options.map((o) => ({ option: o, count: 0 }));
      hist.forEach((h) => { if (h) votes[h.choice].count++; });
      return { ...base, poll: true, votes };
    }
    const right = hist.filter((h) => h && h.correct).length;
    return { ...base, correct: right, pct: hist.length ? Math.round((right / hist.length) * 100) : 0 };
  });
}

function endGame(room) {
  room.state = 'end';
  const rank = ranking(room);
  io.to(room.hostSocketId).emit('game:end', { ranking: rank, stats: questionStats(room), podiumMs: PODIUM_MS });
  for (const p of room.players.values()) {
    if (p.socketId) {
      io.to(p.socketId).emit('game:end', {
        score: p.score, position: rank.findIndex((r) => r.id === p.id) + 1, total: rank.length, revealIn: PODIUM_MS,
      });
    }
  }
}

// ---------- HTTP ----------

const localOnly = (req, res, next) => (isLocalRequest(req.socket.remoteAddress, req.headers)
  ? next() : res.status(403).send('Esta sección solo se abre desde el propio ordenador.'));

// no-cache: el navegador revalida siempre, así tras actualizar la aplicación nunca usa archivos antiguos.
app.use(express.static(path.join(__dirname, 'public'), {
  index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

app.get('/', (req, res) => res.redirect(isLocalRequest(req.socket.remoteAddress, req.headers) ? '/host' : '/play'));
// Las páginas llevan un número de versión en sus scripts y estilos que cambia en cada arranque,
// para que ningún navegador (ni los móviles) use archivos antiguos tras una actualización.
const BOOT = Date.now().toString(36);
function sendPage(name) {
  return (req, res) => {
    const html = fs.readFileSync(path.join(__dirname, 'public', name), 'utf8')
      .replace(/((?:src|href)="\/[\w./-]+\.(?:js|css))"/g, `$1?v=${BOOT}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(html);
  };
}

app.get('/host', localOnly, sendPage('host.html'));
app.get('/admin', localOnly, sendPage('admin.html'));
app.get('/editor', localOnly, sendPage('editor.html'));
app.get('/play', sendPage('play.html'));

// Comprobación de que el servidor responde (la usa el túnel antes de dar la dirección).
app.get('/api/health', (req, res) => res.json(
  IS_CLOUD ? { ok: true, runtime: 'cloud', ready: false } : { ok: true },
));

app.get('/api/branding', (req, res) => {
  const room = rooms.get(String(req.query.pin || ''));
  res.json(branding(room ? room.projectId : req.query.project));
});

// Imágenes de los proyectos. El CSP impide que un SVG ejecute código si se abre directamente.
app.get('/media/:id/:file', (req, res) => {
  const file = projects.mediaPath(req.params.id, req.params.file);
  if (!file) return res.sendStatus(404);
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.sendFile(file);
});

// Imágenes y vídeos de las preguntas (sendFile admite peticiones parciales para el vídeo).
app.get('/quiz-media/:id/:file', (req, res) => {
  const file = quizzes.mediaPath(req.params.id, req.params.file);
  if (!file) return res.sendStatus(404);
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.sendFile(file);
});

// ---------- Gestión de proyectos (solo desde el propio ordenador) ----------

const api = express.Router();
api.use(localOnly, express.json({ limit: '40mb' }));
api.get('/', (req, res) => res.json(projects.listProjects().map(projects.toPublic)));
api.post('/', (req, res) => {
  try { res.json(projects.toPublic(projects.saveProject(null, req.body))); } catch (e) { res.status(400).json({ error: e.message }); }
});
api.put('/:id', (req, res) => {
  try { res.json(projects.toPublic(projects.saveProject(req.params.id, req.body))); } catch (e) { res.status(400).json({ error: e.message }); }
});
api.delete('/:id', (req, res) => { projects.deleteProject(req.params.id); res.json({ ok: true }); });
app.use('/api/projects', api);

// ---------- Editor de cuestionarios (solo desde el propio ordenador) ----------

const fail = (res, e) => res.status(400).json({ error: e.message });
const quizApi = express.Router();
quizApi.use(localOnly);
const json = express.json({ limit: '5mb' });
const raw = express.raw({ type: () => true, limit: '300mb' });

quizApi.get('/', (req, res) => res.json(quizzes.listQuizzes().map((q) => ({
  id: q.id, title: q.title, description: q.description, project: q.project,
  count: q.questions.length, issues: q.issues.length, updatedAt: q.updatedAt,
}))));
quizApi.get('/:id', (req, res) => {
  const q = quizzes.toPublic(quizzes.readQuiz(req.params.id));
  return q ? res.json(q) : res.sendStatus(404);
});
quizApi.post('/', json, (req, res) => {
  try { res.json(quizzes.toPublic(quizzes.saveQuiz(null, req.body))); } catch (e) { fail(res, e); }
});
quizApi.put('/:id', json, (req, res) => {
  try { res.json(quizzes.toPublic(quizzes.saveQuiz(req.params.id, req.body))); } catch (e) { fail(res, e); }
});
quizApi.post('/:id/duplicate', (req, res) => {
  try { res.json(quizzes.duplicateQuiz(req.params.id)); } catch (e) { fail(res, e); }
});
quizApi.delete('/:id', (req, res) => { quizzes.deleteQuiz(req.params.id); res.json({ ok: true }); });
quizApi.post('/:id/media', raw, (req, res) => {
  try { res.json({ src: quizzes.saveMedia(req.params.id, req.headers['content-type'], req.body) }); } catch (e) { fail(res, e); }
});
quizApi.get('/:id/export.xlsx', async (req, res) => {
  const quiz = quizzes.readQuiz(req.params.id);
  if (!quiz) return res.sendStatus(404);
  const name = quiz.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'cuestionario';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}.xlsx`);
  res.send(await importExport.buildExcel(quiz));
});
app.use('/api/quizzes', quizApi);

// Plantillas e importación desde Excel/Word.
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
app.get('/api/templates/plantilla-preguntas.xlsx', localOnly, async (req, res) => {
  res.setHeader('Content-Type', XLSX);
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-preguntas.xlsx"');
  res.send(await importExport.buildExcel());
});
app.get('/api/templates/plantilla-preguntas.docx', localOnly, async (req, res) => {
  res.setHeader('Content-Type', DOCX);
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-preguntas.docx"');
  res.send(await importExport.buildWord());
});
app.post('/api/import', localOnly, express.raw({ type: () => true, limit: '50mb' }), async (req, res) => {
  try {
    res.json(await importExport.parseFile(decodeURIComponent(req.headers['x-filename'] || ''), req.body));
  } catch (e) {
    const damaged = /zip|end of data|central directory/i.test(e.message);
    res.status(400).json({ error: damaged ? 'El archivo está dañado o no es un Excel/Word válido.' : e.message });
  }
});

app.get('/api/results/:pin.csv', (req, res) => {
  const room = rooms.get(req.params.pin);
  if (!room || req.query.key !== room.hostKey) return res.status(404).send('No encontrado');
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const qs = room.quiz.questions;
  const rows = [['Jugador', 'Puntos', 'Aciertos', ...qs.map((_, i) => `P${i + 1}`)]];
  for (const p of ranking(room)) {
    const pl = room.players.get(p.id);
    const hits = pl.history.filter((h, i) => h && h.correct && isScored(qs[i])).length;
    rows.push([p.name, p.score, hits, ...qs.map((q, i) => {
      const h = pl.history[i];
      if (h === undefined) return '';
      if (h === null) return 'sin respuesta';
      return isScored(q) ? `${h.correct ? 'OK' : 'KO'} (${q.options[h.choice]})` : q.options[h.choice];
    })]);
  }
  rows.push([]);
  rows.push(['Pregunta', 'Resultado']);
  for (const s of questionStats(room)) {
    rows.push([`P${s.index + 1}: ${s.text}`, s.poll
      ? `Encuesta: ${s.votes.map((v) => `${v.option} (${v.count})`).join(' · ')}`
      : `${s.pct}% de acierto`]);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="resultados-${room.pin}.csv"`);
  res.send('﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n'));
});

// ---------- Socket.IO ----------

io.on('connection', (socket) => {
  const fromLocal = isLocalRequest(socket.handshake.address, socket.handshake.headers);

  // --- Presentador (solo desde el propio ordenador) ---
  socket.on('host:init', (_, ack) => {
    if (!fromLocal) return ack?.({ error: 'forbidden' });
    const list = projects.listProjects().map((p) => ({ id: p.id, name: p.name }));
    const qs = quizzes.listQuizzes().map((q) => ({
      id: q.id, title: q.title, count: q.questions.length, project: q.project, ready: !q.issues.length,
    }));
    ack?.({
      quizzes: qs, projects: list, addresses: lanAddresses(), port: PORT,
      internet: tunnel.current(), update: latestRelease, version: VERSION, dataDir: DATA_DIR,
    });
  });

  socket.on('host:create', async ({ quizId, projectId, address }, ack) => {
    if (!fromLocal) return ack?.({ error: 'forbidden' });
    const stored = quizzes.toPublic(quizzes.readQuiz(quizId));
    if (!stored) return ack?.({ error: 'No se pudo leer el cuestionario' });
    if (stored.issues.length) return ack?.({ error: 'El cuestionario tiene preguntas incompletas. Revísalo en el editor.' });
    // «Internet»: el QR apunta a la dirección pública del túnel de Cloudflare.
    let publicUrl = process.env.PUBLIC_URL || null;
    if (address === 'internet') {
      try { publicUrl = await tunnel.start(PORT); } catch (e) { return ack?.({ error: `No se ha podido publicar en internet: ${e.message}` }); }
    }
    // Copia para jugar: los cambios en el editor no afectan a una partida en marcha.
    const quiz = { ...stored, questions: stored.questions.map(toPlayable) };
    const pin = newPin();
    const room = {
      pin, quiz, projectId: projectId || quiz.project || null, hostSocketId: socket.id, hostKey: crypto.randomBytes(8).toString('hex'),
      players: new Map(), state: 'lobby', qIndex: -1, answers: new Map(), timer: null,
    };
    rooms.set(pin, room);
    socket.data.hostPin = pin;
    const host = publicUrl || `http://${address || lanAddresses()[0]?.address || 'localhost'}:${PORT}`;
    const joinUrl = `${host.replace(/\/$/, '')}/play?pin=${pin}`;
    const qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 600 });
    ack?.({ pin, joinUrl, qr, hostKey: room.hostKey, title: quiz.title, branding: branding(room.projectId) });
  });

  const hostRoom = () => {
    const room = rooms.get(socket.data.hostPin);
    return room && room.hostSocketId === socket.id ? room : null;
  };

  // "from" indica en qué pantalla estaba el presentador: evita que un doble clic salte pasos.
  socket.on('host:next', ({ from } = {}) => {
    const room = hostRoom();
    if (!room || (from && from !== room.state)) return;
    if (room.state === 'question') return revealQuestion(room);
    if (room.state === 'reveal') {
      room.state = 'leaderboard';
      io.to(room.hostSocketId).emit('leaderboard', leaderboard(room));
      return;
    }
    if (room.state === 'lobby' || room.state === 'leaderboard') {
      if (room.qIndex >= room.quiz.questions.length - 1) return endGame(room);
      room.qIndex++;
      startQuestion(room);
    }
  });

  socket.on('host:kick', (playerId) => {
    const room = hostRoom();
    const p = room?.players.get(playerId);
    if (!p) return;
    if (p.socketId) io.to(p.socketId).emit('kicked');
    room.players.delete(playerId);
    emitPlayers(room);
  });

  // --- Jugadores ---
  socket.on('player:join', ({ pin, playerId }, ack) => {
    const room = rooms.get(String(pin || '').trim());
    if (!room) return ack?.({ error: 'No existe ninguna sala con ese PIN' });

    let p = playerId && room.players.get(playerId);
    if (!p) {
      if (room.state !== 'lobby' && !room.quiz.settings?.allowLateJoin) return ack?.({ error: 'La partida ya ha empezado' });
      const used = new Set([...room.players.values()].map((x) => x.name));
      const { name, emoji } = generateName(used);
      p = { id: crypto.randomUUID(), name, emoji, score: 0, fastMs: 0, history: [], socketId: null };
      room.players.set(p.id, p);
    }
    p.socketId = socket.id;
    socket.data.pin = room.pin;
    socket.data.playerId = p.id;
    socket.join(`players:${room.pin}`);
    emitPlayers(room);
    ack?.({ playerId: p.id, name: p.name, emoji: p.emoji, score: p.score, state: room.state, title: room.quiz.title });
  });

  socket.on('player:rename', (_, ack) => {
    const room = rooms.get(socket.data.pin);
    const p = room?.players.get(socket.data.playerId);
    if (!p || room.state !== 'lobby') return ack?.({ error: 'Solo se puede cambiar antes de empezar' });
    const used = new Set([...room.players.values()].map((x) => x.name));
    Object.assign(p, generateName(used));
    emitPlayers(room);
    ack?.({ name: p.name, emoji: p.emoji });
  });

  socket.on('player:answer', ({ choice }, ack) => {
    const room = rooms.get(socket.data.pin);
    const p = room?.players.get(socket.data.playerId);
    if (!p || room.state !== 'question' || room.answers.has(p.id)) return ack?.({ error: 'late' });
    const q = room.quiz.questions[room.qIndex];
    choice = Number(choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return ack?.({ error: 'invalid' });

    const ms = Date.now() - room.questionStart;
    const correct = isScored(q) && q.correct.includes(choice);
    // Como en Kahoot: hasta 1000 puntos (x2 si es doble), la mitad depende de la rapidez.
    const points = correct ? Math.round(1000 * q.points * (1 - Math.min(ms / (room.questionTime * 1000), 1) / 2)) : 0;
    p.score += points;
    if (correct) p.fastMs += ms;
    room.answers.set(p.id, { choice, correct, points, ms });
    ack?.({ ok: true });

    io.to(room.hostSocketId).emit('question:answerCount', { answered: room.answers.size, players: room.players.size });
    if (room.answers.size >= [...room.players.values()].filter((x) => x.socketId).length) revealQuestion(room);
  });

  socket.on('disconnect', () => {
    if (socket.data.hostPin) {
      const room = rooms.get(socket.data.hostPin);
      if (room && room.hostSocketId === socket.id) {
        clearTimeout(room.timer);
        io.to(`players:${room.pin}`).emit('room:closed');
        rooms.delete(room.pin);
      }
    }
    const room = rooms.get(socket.data.pin);
    const p = room?.players.get(socket.data.playerId);
    if (p && p.socketId === socket.id) {
      p.socketId = null;
      emitPlayers(room);
    }
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  El puerto ${PORT} ya está en uso: probablemente la aplicación ya está abierta.`);
    console.error(`  Abre http://localhost:${PORT}/host en el navegador o cierra la otra ventana.\n`);
    process.exit(1);
  }
  throw e;
});

// Arranque exclusivo del modo escritorio; Vercel recibe el servidor exportado.
function startLocalServer() {
  if (IS_CLOUD) throw new Error('El modo cloud no puede iniciarse como servidor local.');
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Quiz en marcha (versión ${VERSION})`);
    console.log(`  Presentador: http://localhost:${PORT}/host`);
    for (const a of lanAddresses()) console.log(`  Jugadores (${a.name}): http://${a.address}:${PORT}/play`);
    console.log(`  Tus datos se guardan en: ${DATA_DIR}`);
    console.log('  Para cerrar la aplicación, cierra esta ventana.\n');
    process.emit('quiz:ready', PORT);
  });
  return server;
}

if (require.main === module && !IS_CLOUD) startLocalServer();

// Export HTTP.Server para que Vercel pueda usar Express y los upgrades WebSocket.
module.exports = server;
module.exports.app = app;
module.exports.startLocalServer = startLocalServer;
