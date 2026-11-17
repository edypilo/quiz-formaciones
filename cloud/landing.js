'use strict';

// Página de diagnóstico del despliegue: no da acceso a las funciones privadas.
// Se sirve desde Express (no desde public/) para que el CDN de Vercel no la adelante.
const HTML = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Quiz Formaciones · Preparación de la nube</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #f6f8fe; color: #12213c; padding: 24px; }
    main { width: min(100%, 610px); border-radius: 22px; border: 1px solid #dce3f0; padding: clamp(24px, 5vw, 48px); background: #fff; box-shadow: 0 18px 55px #1b2e5912; }
    .brand { font-weight: 800; color: #244cba; letter-spacing: .03em; }
    .stage { display: inline-block; color: #785000; background: #fff1bc; border-radius: 100px; font-size: .83rem; font-weight: 700; padding: 7px 13px; margin: 22px 0 8px; }
    h1 { margin: 12px 0; line-height: 1.18; font-size: clamp(1.65rem, 4vw, 2.5rem); }
    p { font-size: 1.04rem; line-height: 1.6; color: #43506a; }
    .detail { border-top: 1px solid #e6ebf3; padding-top: 20px; margin-top: 26px; font-size: .94rem; }
    code { background: #edf2fa; border-radius: 5px; padding: 2px 5px; }
    a { color: #244cba; }
  </style>
</head>
<body><main>
  <div class="brand">QUIZ FORMACIONES</div>
  <div class="stage">Versión cloud en preparación</div>
  <h1>El servidor responde. La aplicación aún no está publicada.</h1>
  <p>Esta dirección sirve para verificar el despliegue de prueba en Vercel. Los cuestionarios, el editor y las partidas están deshabilitados mientras completamos la migración y la seguridad.</p>
  <div class="detail">
    <p>Comprobación técnica: <a href="/api/health"><code>/api/health</code></a></p>
    <p>La versión de escritorio continúa disponible por separado.</p>
  </div>
</main></body>
</html>`;

function cloudLanding(_req, res) {
  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  res.status(200).type('html').send(HTML);
}

module.exports = { cloudLanding };
