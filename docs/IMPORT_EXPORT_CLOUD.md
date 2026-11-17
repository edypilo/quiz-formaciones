# Importación y exportación Excel / Word (cloud)

Se reutiliza `import-export.js` de la edición local. La versión cloud añade rutas autenticadas, sin habilitar la aplicación multijugador.

## Funciones disponibles
- Descarga de plantillas `.xlsx` y `.docx`, protegida por sesión.
- Importación de documentos `.xlsx` y `.docx` (máximo 5 MB): análisis y avisos **sin escritura automática**.
- En el editor se puede añadir preguntas al final o sustituir todas (confirmación obligatoria); el cambio solo se hace persistente al pulsar **Guardar cuestionario**.
- Exportación de cuestionarios guardados a Excel y Word, desde registros propios protegidos por RLS; exporta la última versión guardada, no cambios en memoria pendientes.
- Se mantiene el máximo de 200 preguntas por cuestionario. Los tipos admitidos son quiz, verdadero/falso y encuesta.

## Seguridad
- Autenticación Supabase JWT, sin service role.
- Sin URL pública para descargar cuestionarios; solicitudes `fetch` con Bearer y descarga por `Blob`.
- Restricción de tamaño y extensión en importaciones; nombre de fichero no utilizado como ruta de disco.
- Las preguntas con contenido multimedia importado muestran un aviso y se incorporan sin multimedia **solo si el usuario confirma la operación**. Las subidas a Supabase Storage siguen pendientes.
- No se aceptan ficheros `.xls` ni `.doc`, ni se incorpora contenido sin que el usuario pulse Guardar.
- Los avisos de importación pueden incluir entradas incompletas. Los borradores son válidos; las partidas aún no están habilitadas.

## Validación
1. Desde `/cloud-admin`, descargar las plantillas Excel y Word y comprobar que Office las abre.
2. Importar una plantilla de ejemplo; verificar el número de preguntas y los avisos.
3. Probar **Añadir preguntas**, guardar y volver a abrir; después **Sustituir preguntas** con confirmación.
4. Exportar a Excel y Word y comprobar los documentos.
5. Verificar el cierre de sesión y la protección de descarga sin JWT.

No requiere nuevas variables en Vercel ni migraciones SQL. Se despliega como Preview en `feat/vercel-cloud`.
