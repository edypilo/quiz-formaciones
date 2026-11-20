# Quizzz! · Multimedia en partidas (Preview, fase 1)

## Implementación

- La pantalla del **presentador** recupera la referencia multimedia de la pregunta activa mediante `GET /api/cloud/rooms/:id/game`, que exige JWT del docente y filtra por su `owner_id`.
- Para imágenes (PNG, JPG, WEBP, GIF) y vídeos (MP4, WEBM), el navegador del docente descarga desde el bucket **privado** `quiz-media` con su propia sesión. Se crea una URL `blob:` local; al cambiar de pantalla se libera.
- Los enlaces de YouTube se validan y se reproducen en un iframe de `www.youtube-nocookie.com`; la CSP solo permite ese origen para frames.
- En los **móviles**, el enlace a YouTube puede abrirse en otra pestaña de forma opcional. Los archivos privados **no** se exponen a los participantes.
- Las preguntas que no tienen multimedia siguen funcionando sin cambios; los contadores, el feedback y Realtime se mantienen.

## Validación manual

1. En el último Preview de `feat/vercel-cloud`, crear un cuestionario con una pregunta con imagen pequeña, otra con MP4/WEBM pequeño y otra con un enlace válido a YouTube.
2. Guardar, preparar sala, abrir presentación/QR y conectar al menos un móvil autorizado.
3. Iniciar partida y comprobar que imagen y vídeo se ven **en la proyección**. En vídeo, el docente controla la reproducción.
4. Comprobar la pregunta de YouTube en el presentador y que el enlace correspondiente aparece en el móvil. El enlace abre otra pestaña y no cambia la respuesta enviada en Quizzz!.
5. Completar las preguntas, verificar clasificación y podio, y volver a comprobar que las imágenes del editor siguen siendo privadas.

## Límites deliberados

- **No requiere migración SQL.** Los recursos ya se almacenan en Supabase Storage privado.
- Los archivos locales NO se entregan aún a los móviles; antes hay que crear un mecanismo de enlace temporal ligado a un jugador válido y a la pregunta activa, con expiración.
- La reproducción de YouTube requiere conexión externa y puede estar restringida por políticas de red de centros educativos.
- El temporizador comienza al iniciar la pregunta, no al darle a reproducir el vídeo. Para probar vídeos, configura un plazo suficientemente amplio.
- No subir materiales con copyright sin los permisos necesarios.
- Las pruebas automáticas no sustituyen la validación visual en Vercel.
