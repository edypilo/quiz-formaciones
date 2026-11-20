# Fase de salas privadas (anfitrión) · Quizzz!

Este hito permite preparar una sala para un cuestionario completo, consultar su PIN y cerrarla. **No permite unir jugadores ni jugar.**

## Requisito manual de Supabase

El archivo `supabase/migrations/202611170002_quiz_rooms.sql` **no se aplica solo por estar en GitHub**.

1. Abrir el proyecto existente de Supabase → **SQL Editor**.
2. Copiar íntegramente el contenido de `supabase/migrations/202611170002_quiz_rooms.sql` desde la rama `feat/vercel-cloud`.
3. Ejecutarlo una vez. Debe crearse `public.quiz_rooms` con RLS activado.
4. No configurar claves nuevas, no cambiar el bucket ni activar acceso anónimo.

## Verificación en Preview

1. Abrir último despliegue Preview de `feat/vercel-cloud` → `/cloud-admin`.
2. Iniciar sesión con la misma cuenta Supabase.
3. En un cuestionario con todas las preguntas completas, pulsar **Preparar sala**.
4. Debe aparecer un PIN de **6 cifras** en **Salas preparadas**.
5. Cerrar sesión, iniciar de nuevo y comprobar que la sala continúa visible hasta que caduque (4 horas como máximo).
6. Pulsar **Cerrar sala**; debe desaparecer del listado.
7. No comunicar el PIN a participantes: todavía no hay pantalla pública de entrada.

## Seguridad y limitaciones

- Las salas se guardan en Supabase, no en memoria de Vercel.
- La cuenta autenticada sólo puede crear salas para cuestionarios propios y completos.
- Se impide tener dos salas de espera simultáneas para el mismo cuestionario.
- El PIN se genera aleatoriamente, con índice único para evitar colisiones entre salas en espera.
- La tabla no concede acceso a `anon`. Con RLS y permisos por columna, el usuario sólo puede cambiar el estado a `closed`.
- La protección general de Vercel sigue habilitada en todos los despliegues.
- No hay QR de jugadores, entrada pública, apodos, preguntas sincronizadas ni puntuaciones. Antes de añadirlos hará falta una arquitectura de participantes con límites frente a abuso y autorización separada de los JWT de formador.
