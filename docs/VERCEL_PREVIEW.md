# Despliegue Preview seguro en Vercel (fase intermedia)

**Estado:** la app todavía no permite administrar cuestionarios ni jugar por internet. El despliegue solo verifica que Express inicia y que la autenticación de la API se mantiene protegida.

## Antes de desplegar

- La rama `main` mantiene la versión local. Los cambios web están en `feat/vercel-cloud`.
- En Vercel, preset **Express**, raíz `./`, Node 20 o superior.
- Variables de entorno: `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`; nunca usar o subir la clave secreta o `service_role`.
- No es necesario añadir `QUIZ_RUNTIME` en Vercel: la plataforma proporciona `VERCEL=1`.
- El proyecto de Vercel aún no se ha creado: importar `main` y desplegarla **no es seguro ni útil** para la migración. Primero seleccionar la rama cloud como origen del despliegue de prueba, o crear el proyecto y activar Preview desde la rama cloud sin exponer `main`. Verificar la pantalla y el Git ref antes de pulsar Deploy.
- La aplicación web completa todavía no está lista para producción. No cambiar la rama de producción a `feat/vercel-cloud` sin aceptar que solo aparecerá una landing temporal.

## Entrypoint

`app.js` exporta la app Express: `module.exports = require('./server').app`.
`server.js` exporta también el HTTP Server de Socket.IO (para el modo local), pero no ejecuta `listen()` durante una importación en Vercel.
No se ha añadido `vercel.json` con el antiguo sistema `builds`; usar detección nativa del preset Express.

## Verificación Preview

1. Abrir `/`: debe responder 200 con "Versión cloud en preparación".
2. Abrir `/api/health`: responde JSON `{ "ok": true, "runtime": "cloud", "ready": false }`. Este endpoint **no** implica que el servicio esté funcional.
3. Abrir `/host`, `/editor`, `/admin`, `/play`: deben responder 503.
4. Abrir `/admin.html` o `/editor.html`: deben responder 503 desde Express. Si Vercel sirve archivos estáticos directamente sin pasar por Express, revisar la configuración de rutas antes de publicar.
5. Abrir `/api/cloud/me` sin token: debe responder 401 (`authentication_required`), siempre que variables Supabase estén presentes.
6. La API no habilita CRUD ni sesiones; los datos solo se consultarán una vez que se conecte la interfaz autenticada.

## Riesgos y pasos siguientes

- Asegurar que Vercel sirve todas las rutas vía Express, no mediante copia pública del directorio `public/`.
- Probar específicamente los despliegues Preview (y no solo GitHub Actions).
- Implementar autenticación visual, operaciones de escritura validadas, Storage y migración de datos.
- Migrar las salas a Redis y validar los WebSockets en producción antes de habilitar la app.
- En Vercel, revisar cuota/plan si se utilizará con fines profesionales.
