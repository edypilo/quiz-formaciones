# Multimedia privada en Quizzz! cloud (fase Preview)

## Implementado
- El editor de preguntas permite subir PNG, JPG/JPEG, WEBP, GIF, MP4 o WEBM (límite inicial **6 MB por archivo**). Se excluye SVG por seguridad.
- Los objetos se suben **directamente desde el navegador a Supabase Storage**, al bucket privado `quiz-media`, en `<owner-uuid>/assets/<uuid>.<ext>` con el JWT del usuario. No pasan por Vercel.
- La base de datos guarda una referencia de ruta propia y el tipo (`image`, `video`), no una URL pública ni un token.
- El editor recupera las imágenes/vídeos con `/storage/v1/object/authenticated/quiz-media/... ` autenticado y crea una URL de objeto temporal solo en el navegador.
- Para YouTube se acepta un enlace HTTPS con identificación estricta de host y ID válido; no se permite ningún otro destino externo.
- La API impide guardar medios fuera de la ruta propia, enlaces falsos a YouTube y SVG. Las políticas RLS existentes son la barrera en Supabase.
- La importación Excel/Word conserva enlaces de YouTube válidos. Las imágenes externas se omiten, con aviso de subirlas manualmente.
- Las preguntas con medios se pueden guardar, editar y duplicar usando las rutas del propietario.

## Límites pendientes
- **No se han habilitado partidas en vivo** ni distribución de medios a participantes. Las referencias del bucket privado no pueden compartirse directamente. El motor de juego futuro necesitará URLs firmadas de corta duración.
- Vídeos mayores de 6 MB requerirán carga reanudable (TUS); el bucket puede tener un límite mayor, pero el formulario se mantiene intencionadamente conservador.
- El sistema todavía no elimina objetos huérfanos en Storage al quitar multimedia, borrar preguntas o eliminar cuestionarios. Es necesario un proceso de recogida de basura seguro para no borrar medios utilizados en copias.
- Los archivos existentes del sistema local siguen sin migrar automáticamente.
- No se ha añadido aún identidad visual definitiva de Quizzz!.

## Validación manual en Preview
1. Abrir el último despliegue Preview de `feat/vercel-cloud`, navegar a `/cloud-admin` e iniciar sesión.
2. Editar un cuestionario → pregunta → `Subir imagen o vídeo`. Usar PNG/JPG pequeño. Esperar la previsualización.
3. Guardar el cuestionario. Cerrar sesión y volver a entrar; confirmar que el archivo se ve.
4. Añadir un enlace `https://www.youtube.com/watch?v=abcdefghijk` de ejemplo (el ID debe existir para verlo en YouTube); guardarlo y comprobar que se conserva.
5. Probar un MP4/WebM inferior a 6 MB.
6. Comprobar que el bucket sigue marcado **Private** y que no se ha compartido ningún enlace directo.
7. En Supabase Storage verificar que existe la ruta `<user_uuid>/assets/...`. No cambiar RLS.

## Seguridad de producción pendiente
- TUS reanudable, validación de contenido real y limpieza segura de huérfanos.
- URLs firmadas limitadas para participantes y pruebas multicliente de aislamiento.
- Revisar CSP y políticas de Vercel antes de publicar.
