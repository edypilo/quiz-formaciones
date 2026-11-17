# Fase 2 · Preparación de Supabase

Esta fase añade una base de datos con RLS, un bucket privado y **endpoints de lectura cloud**, sin activar todavía el editor web ni las partidas.

## Configuración manual (no compartir claves en chats ni GitHub)

1. Crear un proyecto dedicado en https://supabase.com/dashboard.
2. En **SQL Editor**, ejecutar `supabase/migrations/202611170001_quiz_cloud.sql`.
3. En **Authentication → Providers**, configurar el acceso por email. Para el MVP, desactivar el registro público si se quiere un único administrador; crear usuarios desde el panel de Supabase. Activar MFA cuando esté disponible.
4. Verificar las tres tablas `quiz_projects`, `quiz_quizzes` y `quiz_game_results`, con RLS activado.
5. Verificar bucket privado `quiz-media`. La subida, los enlaces firmados y la interfaz se implementarán en una fase posterior.
6. Configurar las variables en el entorno servidor de Vercel (no en código, ni en variables prefijadas `VITE_`/`NEXT_PUBLIC_`):
   - `SUPABASE_URL`: URL del proyecto, por ejemplo `https://xxx.supabase.co`.
   - `SUPABASE_PUBLISHABLE_KEY` (o `SUPABASE_ANON_KEY`): clave pública del proyecto. No usar `service_role` ni `secret` en estos endpoints.
   - `QUIZ_RUNTIME=cloud`: útil en desarrollo; en Vercel se detecta automáticamente con `VERCEL=1`.
7. **No desplegar como aplicación operativa todavía**: el panel y las salas siguen respondiendo 503 por diseño.

## Endpoints preparados

Todas las rutas comienzan con `/api/cloud` y requieren cabecera
`Authorization: Bearer <SUPABASE_ACCESS_TOKEN>`.

- `GET /api/cloud/me`: identidad validada a través de Supabase Auth.
- `GET /api/cloud/projects`: primeros 100 proyectos del usuario, ordenados por actualización.
- `GET /api/cloud/quizzes`: primeros 100 cuestionarios del usuario, ordenados por actualización.

La API pasa a PostgREST **el JWT del propio usuario** (no credenciales privilegiadas), de manera que PostgreSQL aplique RLS. Los códigos 401 indican ausencia o invalidez de JWT; 503, configuración de Supabase incompleta; 502, error de consulta/proveedor.

## Seguridad y tareas pendientes

- Las políticas de RLS restringen acceso por `owner_id = auth.uid()`.
- No hay permisos anónimos para las tablas ni para el bucket.
- El contenido de media es privado: los participantes necesitarán URL firmadas con alcance y caducidad adecuados una vez que exista el sistema de salas en Redis.
- Aún falta: CRUD completo con validación, autenticación de la interfaz de administración, Storage/uploads, migración de datos locales, rate limiting y partidas distribuidas.
- Verificar las políticas **en Supabase real** con dos usuarios distintos, además de pruebas unitarias con mocks. Los mocks no comprueban el comportamiento real de RLS.
- Ejecutar `node --test tests/*.test.js` tras `npm ci` (en PR se hace mediante GitHub Actions).
- Los cuestionarios actuales en `Documentos/Quiz` no se han importado ni modificado.

### Consideración sobre borrado

`ON DELETE SET NULL (project_id)` y `ON DELETE SET NULL (quiz_id)` permiten conservar cuestionarios/resultados cuando se elimina el proyecto/cuestionario vinculado, manteniendo `owner_id` intacto.

### Prevención de fugas

No guardar tokens de acceso en el repositorio. No desactivar RLS para hacer funcionar consultas. Nunca exponer `SUPABASE_SERVICE_ROLE_KEY` ni `sb_secret_` al cliente.
