// «Publicar en internet»: túnel temporal de Cloudflare (gratis, sin cuenta). Da una dirección
// https://xxxx.trycloudflare.com que llega a este ordenador desde cualquier red, mientras la
// aplicación esté abierta. Al cerrarla, la dirección desaparece.
const fs = require('fs');

let tunnel = null;
let url = null;
let pending = null;

async function waitUntilReachable(publicUrl, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const res = await fetch(`${publicUrl}/api/health`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('La dirección de internet no responde todavía. Inténtalo de nuevo en unos segundos.');
}

async function open(port) {
  let cf;
  try {
    cf = require('cloudflared');
  } catch {
    throw new Error('Falta el componente de Cloudflare. Cierra la aplicación y vuelve a abrirla con el lanzador para instalarlo.');
  }
  // Si la instalación no pudo descargar el programa de Cloudflare, se descarga ahora.
  if (!fs.existsSync(cf.bin)) await cf.install(cf.bin);

  const t = cf.Tunnel.quick(`http://localhost:${port}`);
  const publicUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Cloudflare no ha respondido. ¿Hay conexión a internet?')), 45000);
    t.once('url', (u) => { clearTimeout(timer); resolve(u); });
    t.once('error', (e) => { clearTimeout(timer); reject(e); });
    t.once('exit', (code) => { clearTimeout(timer); reject(new Error(`El túnel se ha cerrado (código ${code}).`)); });
  });
  t.on('exit', () => { if (tunnel === t) { tunnel = null; url = null; } });
  tunnel = t;
  await waitUntilReachable(publicUrl);
  url = publicUrl;
  return url;
}

// Devuelve la dirección pública, abriendo el túnel si hace falta (una sola vez aunque se pida a la vez).
function start(port) {
  if (url) return Promise.resolve(url);
  if (!pending) {
    pending = open(port).catch((e) => { stop(); throw e; }).finally(() => { pending = null; });
  }
  return pending;
}

function stop() {
  if (tunnel) { try { tunnel.stop(); } catch {} }
  tunnel = null;
  url = null;
}

// Al cerrar la aplicación se cierra también el túnel.
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stop(); process.exit(0); });

module.exports = { start, stop, current: () => url };
