# Vista de administración cloud · fase de solo lectura

## Alcance

- Ruta: `/cloud-admin` (exclusiva del modo cloud).
- Login con email y contraseña del usuario creado manualmente en **Supabase Authentication → Users**.
- Tras autenticar, consulta `/api/cloud/me`, `/api/cloud/projects` y `/api/cloud/quizzes`.
- No ofrece registro de usuarios, escritura de datos, subida de imágenes ni partidas. Las rutas originales `/host`, `/admin`, `/editor` y `/play` continúan deshabilitadas en la nube.
- La sesión se guarda **solo en memoria**, por tanto hay que entrar de nuevo al recargar la pestaña. El token se refresca mientras esté abierta la página cuando se consulta información.
- Cierre de sesión local inmediato e intento de revocación del acceso en Supabase.

## Requisitos

1. Supabase SQL y RLS creados.
2. Usuario administrador existente y confirmado. Registro público desactivado.
3. Variables `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en el entorno de despliegue que realmente se vaya a usar. Se exponen **solo estos dos valores públicos** a la página; nunca una clave secreta.
4. Vercel Authentication habilitada en **All Deployments**, hasta completar la migración. No quitar esta protección para compartir una sesión.
5. Para pruebas remotas usar **Preview** en la rama `feat/vercel-cloud`. La URL de Production actualmente puede tener la landing anterior y no debe usarse como demostración del editor.

## Verificación

- `/cloud-admin` debe mostrar el login.
- Credenciales incorrectas: error sin revelar detalles.
- Credenciales válidas: listas de proyectos y cuestionarios del usuario (pueden estar vacías: todavía no se ha hecho migración desde `Documentos/Quiz`).
- `/api/cloud/me` sin Bearer: 401.
- `/host`, `/editor`, `/admin`, `/play`: 503.
- `/api/cloud/config` solo muestra URL del proyecto y publishable key.
- Confirmar que se trata de la **última versión desplegada** y del entorno correcto. Si un deploy hook se ejecuta en Production, no confundir con un despliegue Preview.
- Testear políticas RLS con cuentas distintas antes de añadir escrituras.

## Próxima fase

CRUD con validación, gestión de Storage, migración de proyectos desde archivos locales y estado distribuido de salas (Redis). El diseño del panel se refinará una vez validado el flujo de autenticación y lectura.
