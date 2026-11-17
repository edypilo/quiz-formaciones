// Arranque para Windows, Mac y Linux: instala las dependencias si faltan (o si la versión ha
// cambiado tras una actualización), arranca el servidor y abre el navegador en el presentador.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  console.error(`\n  Esta aplicación necesita Node.js 20 o superior (tienes la ${process.versions.node}).`);
  console.error('  Descarga la versión LTS en https://nodejs.org e inténtalo de nuevo.\n');
  process.exit(1);
}

const root = __dirname;
const lock = path.join(root, 'package-lock.json');
const stamp = path.join(root, 'node_modules', '.quiz-instalado');
const hash = fs.existsSync(lock) ? crypto.createHash('sha1').update(fs.readFileSync(lock)).digest('hex') : 'sin-lock';

if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== hash) {
  console.log('\n  Preparando la aplicación (solo la primera vez o tras actualizar; puede tardar un minuto)…\n');
  // Orden completa en una sola cadena: en Windows npm es un .cmd y necesita la consola.
  const r = spawnSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', {
    cwd: root, stdio: 'inherit', shell: true,
  });
  if (r.status !== 0) {
    console.error('\n  No se han podido instalar los componentes. Comprueba la conexión a internet y vuelve a intentarlo.\n');
    process.exit(1);
  }
  fs.writeFileSync(stamp, hash);
}

function openBrowser(url) {
  if (process.env.QUIZ_NO_BROWSER) return;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch {}
}

process.once('quiz:ready', (port) => openBrowser(`http://localhost:${port}/host`));
require('./server').startLocalServer();
