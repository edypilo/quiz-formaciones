# Quizzz! · Preguntas Quiz con varias respuestas correctas (Preview)

## Qué cambia

La versión original ya admite marcar varias correctas en el editor de preguntas tipo **Quiz**. El motor cloud solo aceptaba una selección. Ahora:

- **Quiz** con una opción correcta: el móvil conserva su respuesta de un toque.
- **Quiz** con dos, tres o cuatro opciones correctas: aparece el aviso «Selecciona todas las respuestas correctas» y un botón de **Enviar respuestas**. Los jugadores pueden seleccionar y deseleccionar botones; se manda un único conjunto al confirmar.
- **Verdadero/falso**: sigue admitiendo una opción.
- **Encuesta**: continúa sin puntuación.
- Al revelar, la presentación colorea todas las opciones correctas, y el jugador recibe su resultado personalizado.
- Puntuación **todo o nada**: si el conjunto enviado coincide exactamente con el correcto, se otorgan los puntos habituales (1.000 o 2.000, salvo preguntas sin puntos); cualquier selección incompleta o con una opción incorrecta recibe 0.
- La base de datos rechaza índices repetidos, fuera del rango, opciones vacías y envíos adicionales. Ordena los índices antes de comparar, por lo que el orden de pulsación no importa.
- La RPC de estado solo expone el indicador booleano `multiple`, nunca los índices correctos antes de revelar.

## Migración obligatoria (solo una)

Abrir en GitHub y ejecutar íntegramente en **Supabase → SQL Editor**:
`supabase/migrations/202611200008_quiz_multi_answer.sql`

Requiere que ya estén aplicadas las migraciones anteriores (hasta `202611200007`). El script redefine cuatro funciones y mantiene sus permisos:
`quiz_host_start_game`, `quiz_guest_answer`, `quiz_guest_status` y `quiz_host_presenter_state`.

No requiere cambiar variables de entorno ni actualizar Storage.

## Prueba recomendada

1. En el último Preview de `feat/vercel-cloud`, crear un cuestionario con cuatro preguntas:
   - Quiz: respuestas A y C correctas.
   - Quiz: solo B correcta.
   - Verdadero/Falso.
   - Encuesta.
2. Preparar sala, abrir presentador y conectar tres móviles.
3. En la primera, enviar desde los móviles tres selecciones diferentes: **A+C**, **A**, **A+C+D**.
4. Comprobar que únicamente **A+C** obtiene 1.000 puntos; los demás 0. Debe ser igual seleccionar primero C y después A.
5. En la segunda, comprobar que seleccionar **B** envía directamente (sin botón adicional).
6. Confirmar que la clasificación, el podio y los mensajes individuales funcionan correctamente.
7. Comprobar que la puntuación y las correctas solo aparecen al revelar la pregunta.

## Notas

- No se suman puntos parciales. El sistema mantiene puntuación exacta, igual que la mecánica actual.
- El tiempo empieza al mostrar la pregunta; conviene usar 30–45 s para preguntas de varias respuestas.
- Las preguntas de respuesta escrita, ordenar, escala y nube de palabras siguen fuera del alcance del motor actual y se abordarán individualmente.
- La rama `main` y la app local permanecen intactas; esta fase necesita validación manual en Preview.
