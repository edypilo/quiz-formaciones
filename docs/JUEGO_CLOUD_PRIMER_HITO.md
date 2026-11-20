# Quizzz! · Primera partida cloud (Preview)

## Alcance de la fase

Esta fase incorpora un motor de preguntas alojado en Postgres: la partida permanece persistida aunque Vercel reinicie una función.

- El formador abre una sala con invitados y al menos un participante, pulsa **Iniciar partida**, controla **Mostrar resultado** y **Siguiente pregunta**, y consulta una clasificación de puntuaciones.
- El participante conectado recibe en su móvil el texto y opciones, responde una vez y ve los resultados cuando el formador los revela.
- El servidor valida el plazo de cada pregunta y evita puntuaciones duplicadas mediante un índice único.
- Mientras se responde no se envían los índices de respuestas correctas. Se publican solo en la fase de revelación.
- Cada respuesta correcta suma 1.000 puntos estándar o 2.000 puntos dobles; las encuestas y preguntas sin puntos suman cero.
- El estado del jugador se consulta cada 3 segundos, y el panel del formador cada 2 segundos. El tiempo restante se representa localmente cada medio segundo.

## Migración SQL necesaria

**No está aplicada automáticamente.**

En Supabase → SQL Editor, ejecutar íntegramente:
`supabase/migrations/202611200002_quiz_game_engine.sql`

El script está envuelto en `BEGIN`/`COMMIT`, por lo que cualquier error SQL revierte sus cambios. No se cambian claves, buckets ni las tablas de proyectos.

La migración añade columnas `game_*` a `quiz_rooms`, crea `quiz_room_answers` con RLS y funciones RPC para empezar, avanzar, recibir respuestas y obtener puntuaciones. No se otorga acceso directo a esa tabla a los invitados.

## Prueba inicial

1. En Supabase aplicar la migración. El resultado esperado es `Success. No rows returned`; ante errores, **no** reintentar parcialmente ni cambiar permisos, sino revisar el mensaje.
2. En el último Preview Vercel abrir `/cloud-admin`, crear una sala para un cuestionario completo y **Habilitar invitados**.
3. Entrar al menos desde un móvil mediante QR y nombre aleatorio.
4. En el formador, pulsar **Iniciar partida**. El panel **Partida en curso** debería mostrar la primera pregunta.
5. Comprobar que la pregunta aparece en el móvil en pocos segundos, con cuenta atrás y botones para responder.
6. Responder una vez. Verificar que no se acepta una segunda respuesta.
7. Pulsar **Mostrar resultado** y comprobar que en el móvil se resalta la respuesta correcta.
8. Pulsar **Siguiente pregunta / Finalizar**, repetir y comprobar el cierre y clasificación.

## Límites y seguridad

- Solo admite preguntas **con una única respuesta correcta** en esta fase. Las encuestas siguen sin puntuación. Los cuestionarios con varias respuestas correctas no pueden comenzar hasta implementar selección múltiple.
- La puntuación es fija, sin bonificación por rapidez en esta versión.
- Imágenes y vídeos privados todavía no se entregan a jugadores. El formador debe usar preguntas de texto para la prueba de extremo a extremo.
- **No es todavía Realtime:** los clientes consultan el estado periódicamente. La fase siguiente será incorporar Supabase Realtime Broadcast con autorización específica.
- Vercel Authentication sigue protegida en All Deployments; los dispositivos de prueba necesitan sesión autorizada.
- No publicar ni compartir QR con grupos externos hasta completar controles de protección y pruebas multicliente.
- No aplicar la identidad visual final hasta completar la funcionalidad.
