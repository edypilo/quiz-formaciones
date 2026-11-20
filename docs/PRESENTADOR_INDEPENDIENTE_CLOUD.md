# Presentador independiente de Quizzz! (Preview)

## Objetivo y recorrido

El panel cloud sigue gestionando proyectos y cuestionarios; la sesión en directo se proyecta en una **ventana independiente**.

1. Desde `/cloud-admin`, preparar sala y pulsar **Habilitar invitados**.
2. Pulsar **Abrir presentación y QR**: se abre `/presenter?room=<uuid>` en otra ventana (el navegador puede pedir permiso para ventanas emergentes).
3. La nueva ventana pide una credencial al panel del formador usando `postMessage` restringido por origen y ventana, no mediante URL ni almacenamiento persistente. **Mantener abierto el panel de administración durante la sesión.**
4. Aparecen QR, PIN, lista de jugadores y botón **Iniciar partida**. El docente puede poner esa ventana a pantalla completa con el botón o la tecla `F`.
5. Comienza la partida: pregunta grande y botones con cuatro colores/formas, temporizador con hora del servidor y contador de respuestas recibidas.
6. El contador de respuestas consulta la base de datos aproximadamente **cada segundo**. Al terminar el tiempo, el presentador solicita a PostgreSQL una transición idempotente a `reveal`; la base de datos verifica el plazo.
7. Se muestran respuestas correctas, distribución de votos y explicación, si existe. El docente pulsa **Ver clasificación**; aparecen los movimientos y puntos.
8. Pulsar **Siguiente pregunta**. Tras la última clasificación, se abre el podio con medallas, redoble y confeti.
9. Los móviles mantienen su feedback personal y reciben opciones con los mismos colores y formas. En la revelación pueden consultar su puesto; al terminar reciben su puesto, medalla y puntuación.

## Migración SQL (manual)

Ejecutar en Supabase SQL Editor, **después** de las migraciones previas:
`supabase/migrations/202611200004_quiz_presenter.sql`

El script añade las funciones:
- `quiz_host_presenter_state`: estado agregado autorizado para el formador, incluyendo contador, distribución y puntuaciones.
- `quiz_host_reveal_due`: revela una pregunta cuando caduca el plazo, con bloqueo de fila para evitar cambios simultáneos.
- `quiz_guest_standing`: devuelve exclusivamente la puntuación y posición del jugador con token válido, y solo en revelación o al finalizar.

No añade tablas, ni entrega claves o respuestas correctas antes de la fase de revelación. Usa funciones `SECURITY DEFINER` con `search_path` vacío, permisos explícitos y datos limitados por propietario/token.

## Prueba recomendada

1. Abrir el último Preview de `feat/vercel-cloud`; tras confirmar `Success` de la migración, crear nueva sala y abrir el presentador.
2. Comprobar que abre **otra ventana** con el QR y que los nombres aparecen al entrar tres móviles.
3. Iniciar partida desde la ventana de presentación y comprobar que hay cuatro colores y formas.
4. Con una pregunta de 15–20 segundos, hacer que dos personas respondan y una no. Comprobar contador 0/3 → 1/3 → 2/3.
5. Dejar que el tiempo llegue a 0: debe mostrarse **automáticamente** la respuesta correcta. La clasificación queda bajo control del formador.
6. Pasar a clasificación y luego a la siguiente pregunta. Al terminar comprobar podio y mensajes finales individuales.

## Límites del prototipo

- La sincronización es mediante *polling* cada segundo desde la ventana del presentador; **no es un canal Realtime**. Para grandes grupos y uso público, habrá que incorporar eventos de Supabase Realtime y ensayar carga.
- El cambio automático a resultado requiere mantener abierta la ventana del presentador. La autoridad temporal y la validación están en PostgreSQL.
- El motor actual solo permite preguntas de una única respuesta. Imágenes privadas y vídeos requieren distribución con enlaces firmados en una fase posterior.
- El presentador requiere que el panel autenticado siga abierto para renovar credenciales; cerrar el panel impide la autenticación de la ventana tras caducar su token.
- Vercel Authentication sigue habilitado para todos los despliegues de prueba.
- La rama `main` no se ha modificado.
