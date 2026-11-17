# Migración de Quiz Formaciones a Vercel

> Documento de arquitectura, fase 1. La aplicación de escritorio se conserva en `main`. No desplegar este proyecto como aplicación pública antes de implementar autenticación, persistencia y sincronización.

## Objetivo

Aplicación web siempre accesible desde Vercel, con:
- panel privado de presentador, editor y proyectos;
- creación de salas y acceso de jugadores por PIN/QR, sin registro;
- preguntas, rankings, encuestas y resultados en tiempo real;
- cuestionarios, imágenes y vídeos persistentes;
- posibilidad de seguir ejecutando la versión local actual mientras se desarrolla la edición cloud.

## Estado actual del repositorio

- Node.js >=20, Express, Socket.IO, frontend HTML/CSS/JS (sin compilación).
- `iniciar.js` instala dependencias y abre el navegador. `server.js` ejecuta `server.listen`.
- `paths.js`, `projects.js` y `quizzes.js` escriben datos en archivos del equipo (`Documentos/Quiz`).
- `server.js` almacena salas en `const rooms = new Map()` y usa temporizadores `setTimeout`.
- Las rutas `/host`, `/admin`, `/editor` y sus API se protegen con `localOnly`; una publicación remota las bloquearía.
- `tunnel.js` y los lanzadores .bat/.command son exclusivos del modo local.

## Arquitectura seleccionada para el MVP cloud

| Componente | Servicio | Función |
|---|---|---|
| Web y API | Vercel Functions, Node.js y Fluid Compute | Servir Express, websockets y estáticos |
| Datos persistentes | Supabase PostgreSQL | Proyectos, cuestionarios, configuración, resúmenes |
| Autenticación | Supabase Auth | Acceso autorizado de presentador/administración |
| Multimedia | Supabase Storage | Logos, portadas, imágenes y vídeo; subida directa para archivos grandes |
| Salas de partida | Redis gestionado, por ejemplo Upstash | Estado compartido, respuestas, marcador, caducidad, operaciones atómicas |
| Emisiones Socket.IO | Adaptador de Redis para Socket.IO | Distribución de eventos entre instancias de Vercel |

Vercel admite WebSockets en Functions desde 2026, incluso con Socket.IO, pero cada conexión está fijada a una instancia durante su vida. Las instancias no comparten memoria y los WebSockets pueden desconectarse por límites de duración. Redis deberá contener el estado de juego, no solo transportar eventos. Los clientes deben reconectarse y restaurar su participación.

## Modelo de datos propuesto

**PostgreSQL:**
- `projects`: id, owner_id, nombre, datos_de_marca JSONB, fechas.
- `quizzes`: id, owner_id, project_id, título, descripción, settings JSONB, questions JSONB, fechas.
- `game_results` (opcional en MVP): id, quiz_id, sesión, resultados agregados, fecha, caducidad.
- RLS: el propietario controla sus proyectos y cuestionarios. No permitir creación de usuarios administradores por defecto.

**Storage:**
- `branding/{owner_id}/{project_id}/...`
- `questions/{owner_id}/{quiz_id}/...`
- URLs públicas solo para contenidos que deban ver los jugadores; las operaciones de escritura requieren autorización.

**Redis por sesión (`room:{pin}`):**
- estado, quiz inmutable/snapshot, índice actual, marca temporal de inicio y deadline;
- identificador del presentador / control de sala;
- participantes con IDs anónimos, respuestas únicas por pregunta, puntuaciones e historial;
- TTL para limpiar sesiones abandonadas;
- operaciones atómicas para PIN, respuestas, transición de estado y fin de pregunta.

## Reglas técnicas importantes

1. Evitar crear el `http.Server` y llamar a `listen()` al importar en una Function. Exponer el servidor para Vercel y ejecutar `listen` solo en modo local.
2. Sustituir `localOnly` en el modo cloud por autenticación de presentador (HTTP y eventos Socket.IO); las páginas `/play` y los eventos de jugador siguen siendo públicos con controles de sala.
3. No confiar en `new Map()` ni en `setTimeout()` como fuente única de verdad. Al recibir acciones, validar las horas de cierre desde el servidor y actualizar Redis de manera atómica.
4. Usar reconexión automática y ventana de gracia para el presentador. No cerrar la sala inmediatamente si su socket se desconecta; la Function puede finalizar por límite de duración.
5. Forzar `websocket` donde convenga para evitar depender de afinidad entre instancias con long polling. Verificar compatibilidad con navegadores/móviles de los asistentes.
6. Cambiar rutas de subida de archivos grandes: las Functions tienen un límite de tamaño de cuerpo de petición. Usar subida directa a Storage y procesado controlado cuando corresponda.
7. Mantener el arranque de escritorio y el túnel existentes hasta completar la migración; nunca volcar claves de servicio en frontend ni GitHub.
8. Aplicar rate limiting a PIN/QR, eventos, uploads y login. Revisar CORS, sesiones seguras, políticas RLS, reintentos, idempotencia y caducidad de datos.
9. Si la app se usa profesionalmente/comercialmente, comprobar el plan Vercel Pro; Hobby se limita a proyectos personales no comerciales.

## Fases de implementación y aceptación

### Fase 1 — Preparar código sin romper local
- [ ] Separar configuración `local` / `cloud`.
- [ ] Extraer construcción de Express/Socket.IO del arranque local.
- [ ] Añadir scripts de prueba y pruebas de salud.
- [ ] Mantener el uso por `Iniciar Quiz.bat` y `Iniciar Quiz.command`.

### Fase 2 — Persistencia y autenticación
- [ ] Crear proyecto Supabase y variables de entorno para entornos de desarrollo y producción.
- [ ] Crear esquema y políticas RLS; adaptar repositorios de proyectos/cuestionarios.
- [ ] Integrar Storage; migración opcional de `Documentos/Quiz`.
- [ ] Autenticar las rutas administrativas y host en nube.

### Fase 3 — Motor multijugador distribuido
- [ ] Crear Redis y adaptador Socket.IO.
- [ ] Migrar `rooms` a Redis con operaciones atómicas y TTL.
- [ ] Gestionar vencimiento de preguntas, reintentos, reconexión y pérdida temporal del presentador.
- [ ] Probar host y varios móviles, incluyendo conexiones a distintas instancias.

### Fase 4 — Despliegue en Vercel
- [ ] Añadir entrypoint para Functions, configuración Vercel y modo web.
- [ ] Configurar variables de entorno en Vercel.
- [ ] Probar despliegue Preview y URL `*.vercel.app`.
- [ ] Probar partidas reales y comprobar costes/límites.

### Fase 5 — Seguridad y producción
- [ ] Revisar autorización, límites de subida, privacidad, RLS y registro de errores.
- [ ] Probar exportación Excel/Word y multimedia.
- [ ] Configurar dominio y monitorización.
- [ ] Decidir mantenimiento del modo local.

## Fuentes de la plataforma

- https://vercel.com/changelog/websocket-support-is-now-generally-available
- https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections
- https://vercel.com/kb/guide/real-time-chat-websockets
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/plans/hobby
