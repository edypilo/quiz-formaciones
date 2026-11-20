# Quizzz! · Feedback personalizado en el móvil (Preview)

## Experiencia de jugador

Después de que el formador pulse **Mostrar resultado**, cada participante recibe exclusivamente su resultado para esa pregunta:

- **Acierto:** 🎉 «¡Has acertado!», frase positiva aleatoria y los puntos reales sumados.
- **Error:** 💪 «¡Buen intento!», frase de ánimo aleatoria y 0 puntos.
- **Sin respuesta:** 👀 «¿Sigues ahí?», mensaje divertido aleatorio, 0 puntos y botón «¡Aquí sigo! 🙌» para responder localmente. Este botón NO concede puntos ni envía una respuesta fuera de plazo.
- **Encuesta:** 🙌 agradecimiento y recordatorio de que no tiene puntuación.

La pantalla cambia una vez por pregunta y mantiene el mismo mensaje mientras se consulta el servidor. La interfaz no muestra datos de otros jugadores, ni permite conocer el propio acierto antes de la fase de revelación.

## Datos privados

Aplicar **una sola vez** en Supabase SQL Editor:
`supabase/migrations/202611200003_quiz_guest_feedback.sql`

Esta migración agrega únicamente la función SECURITY DEFINER `public.quiz_guest_feedback(p_token uuid)`. No altera tablas ni las puntuaciones existentes.

La función:
- Valida el token de jugador por SHA-256 almacenado.
- Solo devuelve respuestas cuando `game_phase = 'reveal'`.
- Busca la respuesta guardada del jugador y del índice de pregunta exacto.
- Distingue `correct`, `incorrect`, `unanswered` y `participated`.
- Devuelve los puntos ya calculados en base de datos. No acepta puntos desde el cliente.
- No concede SELECT ni acceso público a las tablas privadas.

## Prueba manual

1. Aplicar la migración SQL nueva y comprobar `Success. No rows returned`.
2. En Vercel abrir el último Preview de `feat/vercel-cloud` y entrar a `/cloud-admin`.
3. Preparar un cuestionario de opción única con puntos estándar y crear una sala.
4. Conectar 3 jugadores: uno debe responder correctamente, otro de forma incorrecta y otro debe dejar pasar el tiempo.
5. Antes de la revelación, los móviles no deben conocer el resultado.
6. Pulsar **Mostrar resultado** en el panel del formador. Comprobar pantallas distintas y puntuaciones +1.000 / 0 / 0.
7. En el móvil sin respuesta, pulsar «¡Aquí sigo!»: cambia el mensaje pero no suma puntos.
8. Pasar a la pregunta siguiente y comprobar que los mensajes se reinician.
9. Probar una encuesta (feedback «¡Gracias por participar!»).

## Limitaciones

- Requiere una migración SQL nueva; publicar solo cambios de JavaScript no basta.
- La sala todavía usa consultas periódicas, no Supabase Realtime.
- El botón «¡Aquí sigo!» solo confirma visualmente la presencia; no guarda un evento en la base de datos.
- Los mensajes se seleccionan de una lista fija y pueden variar en una nueva partida; no se envían a otros clientes.
- Continúa activa Vercel Authentication para pruebas.
