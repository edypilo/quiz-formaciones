# Quizzz! · Multimedia privada temporal para jugadores (Preview)

## Resultado de esta fase

Las imágenes y vídeos subidos al bucket privado `quiz-media` pueden mostrarse también en el dispositivo del jugador, **solo para la pregunta activa**.

El cliente **no** recibe la ruta interna del fichero ni una clave de servicio. Envía su token de participante al servidor propio de Quizzz!, que comprueba el token en PostgreSQL y firma el archivo autorizado mediante Supabase Storage. El enlace firmado caduca a los **300 segundos (5 minutos)**; permite preguntas de hasta 240 s y vídeo con margen.

Los enlaces firmados son credenciales temporales por posesión: cualquier persona que copie uno podrá consultar ese archivo hasta que caduque. No compartirlos. No hay revocación instantánea de una URL ya expedida. El navegador elimina el elemento multimedia cuando cambia de fase o termina la sesión.

## Requisitos de configuración (dos pasos, ambos obligatorios)

**1. Supabase SQL Editor**: ejecutar la migración nueva
`supabase/migrations/202611200007_quiz_guest_media.sql`

La RPC `quiz_guest_active_media(p_token uuid)` valida:
- token privado del participante (digest SHA-256);
- sala abierta, habilitada y sin caducar;
- fase `question` y tiempo aún disponible;
- referencia de imagen o vídeo cuya ruta pertenece al propietario de la sala.

La función NO genera enlaces y no concede SELECT en `storage.objects` al invitado.

**2. Vercel → Project Settings → Environment Variables**:
- Añadir `SUPABASE_SERVICE_ROLE_KEY`.
- Valor: clave **service_role** de **ese mismo proyecto** Supabase, obtenida en la configuración de claves API del proyecto.
- Marcar únicamente el entorno **Preview** para esta prueba (y restringir a la rama si está disponible).
- No publicar en el repositorio, en una URL, en el chat ni en el JavaScript del navegador.
- Redeploy del Preview para aplicar el nuevo entorno.

La clave privada permanece **solo en el servidor Vercel**. No se añade a `/api/cloud/config`. Usar una credencial únicamente para el entorno de pruebas y rotarla si se sospecha una exposición.

**IMPORTANTE:** si la variable no está disponible, el servidor devuelve `503 guest_media_not_configured`; la partida sigue funcionando, pero los archivos privados no aparecerán en móviles. No se debe cambiar el bucket a público para resolverlo.

## Prueba

1. Aplicar la migración SQL; confirmar `Success`.
2. Configurar la variable `SUPABASE_SERVICE_ROLE_KEY` exclusivamente en Preview y redesplegar.
3. Preparar un quiz con una imagen, un vídeo MP4/WEBM pequeño y una pregunta sin multimedia.
4. Crear nueva sala y abrir presentación/QR con 2–3 móviles.
5. Verificar que la imagen y el vídeo se muestran en el móvil durante su pregunta, y que desaparecen al revelarse la respuesta.
6. Verificar que una pregunta sin multimedia no da error visible.
7. Verificar que YouTube continúa funcionando mediante enlace y que el podio y Realtime siguen intactos.
8. Si falla, comprobar estado del último Preview y los logs de la petición `POST /api/cloud/guest/media`, sin pegar tokens o claves en un chat.

## Limitaciones y seguridad

- Este mecanismo permite acceder al contenido con una URL temporal, sin pasar datos grandes por Vercel. No garantiza que el archivo deje de ser accesible al concluir la pregunta; la firma sigue vigente hasta caducar.
- El endpoint requiere token de jugador válido y consulta la RPC protegida; no firma rutas que el usuario envíe en la petición.
- Vercel Authentication sigue protegiendo las pruebas: los invitados aún necesitan el acceso autorizado al Preview.
- El código está aislado en `feat/vercel-cloud`, sin modificar `main`.
- Antes de hacer pública la app, revisar límites de peticiones, expiración, auditoría, abuso, caché, rotación de claves y el funcionamiento con carga real.
