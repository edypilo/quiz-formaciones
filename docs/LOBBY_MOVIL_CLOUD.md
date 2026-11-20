# Quizzz! · Lobby móvil protegido (fase Preview)

## Qué se incorpora
- Un formador autenticado crea una sala, pulsa **Habilitar invitados**, copia una invitación y consulta la lista de participantes.
- El invitado entra desde `/join?pin=<PIN>&invite=<secreto-UUID>`, elige un nombre y recibe una sesión temporal para consultar el estado de la sala o salir.
- La cuenta de formador sigue siendo la única autorizada a consultar los cuestionarios, administrar salas y leer la lista completa.
- No hay preguntas, puntuación ni conexión en tiempo real: la sala de espera consulta su estado cada cinco segundos.
- La sala y los invitados se guardan en Supabase. El invitado puede recargar la pestaña sin perder su sesión (sessionStorage).

## Migración manual obligatoria
**No se ejecuta automáticamente al hacer push a GitHub.**
En Supabase → SQL Editor, copiar y ejecutar íntegramente
`supabase/migrations/202611200001_quiz_guest_lobby.sql`
desde la rama `feat/vercel-cloud`, después de la migración de salas ya aplicada.
No copiar scripts parciales ni cambiar las políticas existentes.

La migración añade:
1. `is_joinable` por defecto en falso y `join_secret` UUID aleatorio en `quiz_rooms`.
2. `quiz_room_players` con RLS y permiso de lectura solo para el propietario, nunca para anon.
3. Funciones RPC de Supabase: `quiz_host_open_room`, `quiz_guest_join`, `quiz_guest_status`, `quiz_guest_leave`, con permisos explícitos.
4. Una cuota global de solicitudes de unión como protección básica. Es provisional y NO reemplaza controles por IP en producción.

## Prueba de extremo a extremo
1. Abrir el último **Preview** de `feat/vercel-cloud`, acceder a `/cloud-admin` e iniciar sesión.
2. Crear una sala nueva para un cuestionario completo. Si una sala ya existe, puede utilizarse después de aplicar la migración.
3. Pulsar **Habilitar invitados** y después **Copiar invitación**.
4. Abrir el enlace de invitación en un móvil o segunda pestaña autorizada a acceder a ese mismo Preview de Vercel. Introducir PIN y nombre.
5. En el ordenador del formador, pulsar **Ver participantes**; debería aparecer el nuevo apodo.
6. Salir desde el móvil y comprobar que deja de aparecer.
7. Volver a entrar con otro nombre; cerrar la sala desde el ordenador y comprobar que el invitado recibe el estado de cierre.

## Limitación de acceso en Vercel
**Vercel Authentication continúa activado en All Deployments.**
Los móviles ajenos a la cuenta o equipo de Vercel pueden recibir una pantalla de autenticación ANTES de ver `/join`.
Eso es correcto: no se debe desactivar la protección para realizar pruebas públicas.
Se requiere preparar una estrategia específica de acceso público al jugador antes de usar el producto con alumnos; por ejemplo un entorno con protección de administrador a nivel de aplicación y limitación de peticiones en el borde.

## Seguridad y siguientes pasos
- El PIN de seis cifras **no es suficiente**; también se exige un secreto de invitación aleatorio.
- El secreto se distribuye solo mediante el enlace generado por el formador.
- El invitado obtiene un token aleatorio; en Supabase se guarda únicamente su SHA-256.
- Las funciones públicas de invitados no devuelven preguntas, identificador del propietario, credenciales ni datos de otros jugadores.
- La cuota global es básica y puede agotar el acceso de otros grupos: antes de producción se requiere protección por IP, por sala y pruebas de carga.
- No hay sincronización de preguntas en tiempo real ni QR todavía.
- La política de registro público de usuarios de Supabase sigue desactivada.
- La identidad visual global definitiva sigue reservada para antes de producción.
