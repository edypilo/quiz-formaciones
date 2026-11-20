# Quizzz! · Participantes actualizados automáticamente (Preview)

## Qué cambia

- El panel del formador actualiza cada **3 segundos** los apodos de participantes de las salas habilitadas, sin necesidad de pulsar `Ver participantes`.
- La ventana proyectable `Mostrar QR` incorpora contador y lista de nombres. Las incorporaciones y salidas aparecen en la próxima actualización.
- Para evitar una solicitud por sala, el navegador consulta un único endpoint autenticado: `GET /api/cloud/rooms/players?ids=...`, con un máximo de seis salas por consulta.
- Cada solicitud se limita al `owner_id` del formador y solicita `id`, `room_id`, `nickname`, `joined_at`; nunca expone el token secreto del jugador.
- Las comprobaciones se suspenden si la pestaña está oculta y se detienen al cerrar sesión. Se puede seguir usando el botón `Ver participantes` para una consulta manual.
- El contador de la sala en el móvil también se consulta cada **3 segundos**.
- La entrada móvil y el QR siguen protegidos por Vercel Authentication durante Preview.

## Prueba práctica

1. Abrir el último Preview de `feat/vercel-cloud` e iniciar sesión en `/cloud-admin`.
2. Preparar o reutilizar una sala abierta a invitados y pulsar `Mostrar QR`.
3. Unirse y salir con dos móviles autorizados en el Preview.
4. Comprobar que los apodos y el contador en la proyección cambian automáticamente en un máximo aproximado de tres segundos (más latencia de red).
5. Cerrar y reabrir la ventana QR; la lista de la sala también debería seguir visible en el panel.

No requiere migración SQL ni variables adicionales. No es sincronización de juego en tiempo real: el motor de preguntas y puntuaciones queda pendiente.
