# Quizzz! · Avisos Realtime privados para el presentador (Preview)

## Qué cambia

- El presentador usa un canal privado de **Supabase Realtime Broadcast**.
- Al entrar/salir jugadores, recibir una respuesta o cambiar de fase, PostgreSQL envía un aviso breve y el presentador actualiza el estado al momento.
- **No se transmite la selección del jugador ni la respuesta correcta:** cada aviso contiene solo el identificador de sala y el tipo general de cambio.
- El canal se autoriza mediante RLS sobre `realtime.messages` y el JWT del docente; ninguna persona invitada puede escuchar el canal privado de otra sala.
- La conexión utiliza WebSocket sobre HTTPS/WSS, sin incluir JWT en la URL. El JWT se actualiza desde la ventana del administrador mediante `postMessage` entre ventanas del mismo origen.
- El sistema mantiene respaldo: cada segundo si no se ha conectado Realtime y una comprobación de integridad cada cinco segundos si Realtime funciona.
- La ventana muestra **● En directo** cuando se ha unido al canal o **◌ Sincronización de respaldo** si la conexión falla.

## Ejecutar en Supabase SQL Editor

Copiar y ejecutar íntegramente:
`supabase/migrations/202611200005_quiz_realtime_host.sql`

Requiere que esté aplicada `202611200004_quiz_presenter.sql`. Crea una política RLS de lectura en `realtime.messages` y tres triggers sobre tablas existentes. No añade nuevas tablas, roles ni accesos directos a la tabla de respuestas.

**Importante:** no ejecutar el archivo si hay discrepancias con el esquema anterior. No desactivar RLS ni habilitar canales públicos como solución a un error. No configurar claves secretas.

## Prueba manual

1. Aplicar SQL y confirmar `Success. No rows returned`.
2. Abrir último Preview `feat/vercel-cloud` → `/cloud-admin`.
3. Crear sala, habilitar invitados y pulsar **Abrir presentación y QR**.
4. En la esquina superior del presentador, comprobar si aparece **● En directo**. Si aparece respaldo, la partida sigue funcionando, pero habría que revisar la conexión Realtime.
5. Unirse con dos móviles autorizados; la lista de invitados debería cambiar casi inmediatamente, sin esperar el ciclo de 3 segundos.
6. Iniciar una pregunta de 20–30 s, responder desde un móvil y comprobar si el contador incrementa rápidamente; repetir con otro.
7. Dejar agotar tiempo y comprobar que el resultado se revela automáticamente. Continuar hasta clasificación y podio.
8. Desconectar temporalmente la red del presentador, volver a conectarla y comprobar que el respaldo mantiene el funcionamiento y Realtime se reconecta.

## Limitaciones

- En esta fase, los avisos Realtime solo llegan al **presentador**. Los móviles siguen consultando su estado cada tres segundos.
- El contador no es un reloj de latencia garantizada: depende de red, base de datos, tiempo de publicación y navegador.
- Para validar decenas de jugadores y sesiones simultáneas habrá que realizar pruebas de carga y revisar los límites del plan de Supabase.
- La clave usada en el navegador es la **publishable**, no la service-role.
- Se mantiene Vercel Authentication para todos los despliegues Preview y la rama `main` no se ha modificado.
