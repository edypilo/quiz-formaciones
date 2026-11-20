# Quizzz! · Clasificación y podio animados en Preview

## Reutilización de la versión local

Se han adaptado los efectos visuales originales de `public/host.js`, `public/styles.css` y `public/effects.js` al panel cloud:

- **Clasificación animada** tras revelar cada pregunta: puestos, flechas de subida/bajada, puntos ganados y contadores animados. Se muestran los ocho primeros y un aviso del resto.
- **Podio final** tras la última pregunta: presentación sucesiva del 3.º, 2.º y ganador (orden visual 2.º / 1.º / 3.º), medallas, avatares de animales, confeti y efectos de sonido.
- **Repetir animación**, **Cerrar** y **Siguiente pregunta / Ver podio** desde la pantalla proyectable.
- Respeto a `prefers-reduced-motion`: sin movimientos ni sonidos automáticos para usuarios que han solicitado reducir animaciones.
- Los nombres y emojis se obtienen de las mismas listas que usa la versión local.
- Toda la información de puntuación procede de la API autenticada del formador. No hay endpoint público nuevo.

## Recorrido de una sesión

1. Abrir el último Preview de `feat/vercel-cloud`, ir a `/cloud-admin` e iniciar sesión.
2. Preparar una sala, habilitar invitados y conectar dos o tres móviles con el QR.
3. Pulsar **Iniciar partida**. Cada jugador contesta a la primera pregunta.
4. Pulsar **Mostrar resultado**. Los móviles mantienen su feedback individual de acierto, error o ausencia.
5. En el panel del formador pulsar **Ver clasificación 🏆**: se abre una presentación amplia con cambios de puesto.
6. Desde esa presentación pulsar **Siguiente pregunta ▶**. Comprobar que la siguiente pregunta llega a los móviles.
7. Repetir para el resto de preguntas.
8. Tras la última clasificación, pulsar **Ver podio final 🏆**. Debe aparecer el 3.º, después el 2.º y finalmente el ganador, con confeti.
9. Cerrar el podio y pulsar **🏆 Ver podio final** para repetirlo, si se desea.

## Límites y observaciones

- **No hace falta ejecutar ninguna migración SQL** ni configurar nuevas variables en Vercel.
- El podio representa los datos de puntuación actualizados en Supabase.
- La animación de movimientos compara las puntuaciones al comenzar la pregunta con las del momento de revelar; si el navegador del formador se recarga a mitad de ronda, se reconstruye el ranking final, pero puede no reflejar el movimiento previo.
- El contador de puntuaciones se anima de forma local. La API y el almacenamiento de puntuaciones no se alteran.
- Las animaciones dependen del navegador y se deben validar visualmente con dos o tres jugadores, especialmente el confeti dentro del visor modal.
- Se mantiene la protección de Vercel Authentication. La rama `main` y la app local no se modifican.
- La identidad visual definitiva de Quizzz! se incorporará antes de la publicación en producción.
