# Quizzz! · Realtime para móviles sin cuenta Supabase (Preview)

## Qué cambia

- Tras entrar con QR y nombre aleatorio, cada móvil obtiene de una RPC autorizada con su token un tema de avisos derivado por SHA-256 del secreto aleatorio de la sala.
- Supabase Realtime Broadcast notifica **cambios de fase** (pregunta, resultado, fin) y **entradas/salidas**. El móvil vuelve a consultar `quiz_guest_status` con su token; no se envían respuestas correctas, puntuaciones ni apodos en los avisos.
- La interfaz móvil indica **● En directo** cuando recibe avisos; si la conexión se corta, indica **◌ Sincronización de respaldo**.
- Con canal activo hay una comprobación de integridad cada 15 segundos; si Realtime falla, se mantiene el refresco de **3 segundos**. Al volver al primer plano se consulta el estado.
- Las conexiones se cierran al salir de la sala. No se almacena el token en la dirección del WebSocket.

## Migración SQL obligatoria

Aplicar desde **Supabase → SQL Editor** el archivo completo:
`supabase/migrations/202611200006_quiz_realtime_guests.sql`

Requiere la migración de Realtime del presentador `202611200005_quiz_realtime_host.sql`.
El script crea una RPC de acceso con token y triggers que emiten **exclusivamente avisos sin información personal**. No crea tablas ni añade permisos públicos sobre `quiz_rooms`, `quiz_quizzes` ni `quiz_room_answers`.

**Límite de seguridad:** la sala utiliza un canal público, pero con un identificador no enumerable. Cualquier persona que conozca el enlace de invitación podría derivar el canal y escuchar los avisos de cambio de fase/participantes. Esto no revela las preguntas ni los puntos. Antes de producción habrá que revisar los controles frente a abuso, las cuotas, la rotación de secretos y la autorización en canales.

## Prueba práctica

1. Ejecutar la migración SQL. Esperar `Success. No rows returned`.
2. Abrir último Preview de `feat/vercel-cloud`, preparar una sala y proyectar el QR.
3. Entrar desde dos o tres móviles autorizados en Vercel Preview. Comprobar **● En directo**.
4. Iniciar una pregunta en el presentador: debería aparecer en los móviles casi inmediatamente.
5. Al terminar el tiempo, comprobar que cada uno recibe su feedback personalizado rápidamente.
6. Pasar a otra pregunta y terminar la partida. El podio final debe conservarse.
7. Desconectar y reconectar temporalmente la red de un móvil. Debe pasar a modo respaldo y recuperar los cambios.
8. Si aparece siempre respaldo, comprobar la conexión WebSocket y la configuración Realtime del proyecto. **No abrir permisos de tablas ni desactivar RLS para forzar la conexión.**

## Pendiente

- Pruebas con grupos grandes y publicación sin Vercel Authentication para invitados.
- Revisión exhaustiva de seguridad y carga del canal público.
- Multimedia privada visible en jugadores y preguntas de selección múltiple.
- Identidad visual definitiva antes de producción.
