# Quizzz! · Entrada con QR y nombres divertidos (Preview)

## Experiencia de usuario

1. El formador inicia sesión en `/cloud-admin`, prepara una sala y pulsa **Habilitar invitados**.
2. En la sala aparece **Mostrar QR**. El formador abre un visor grande con el QR y el PIN para proyectarlo.
3. El participante escanea el QR y accede a `/join?pin=...&invite=...`. El PIN se rellena automáticamente.
4. Se le asigna un nombre de animal + adjetivo (y emoji) mediante las mismas listas que usa la versión local de Quizzz!; puede pulsar **Otro nombre** antes de entrar.
5. Al entrar, la función `quiz_guest_join` comprueba nombre único para la sala. Si está ocupado, el cliente genera uno nuevo y permite reintentar.
6. El anfitrión consulta participantes con **Ver participantes**. El resto del lobby y la salida siguen como en el hito anterior.

## Seguridad

- El QR se genera en el backend con la biblioteca `qrcode` que ya utiliza la versión local.
- El endpoint `POST /api/cloud/rooms/:id/qr` exige JWT del anfitrión, valida que la sala le pertenece y sigue activa, y solo admite enlaces HTTPS de su propio host, ruta `/join`, PIN de seis cifras e identificador de invitación.
- No se añaden permisos SQL ni variables nuevas.
- El PIN no autoriza por sí solo: el enlace contiene también `invite`, un UUID aleatorio generado para la sala.
- La pantalla móvil no necesita una cuenta de Supabase; Vercel Authentication continúa activa en **All Deployments** durante las pruebas.
- **IMPORTANTE:** el enlace de invitación es sensible. No subir capturas del QR de salas activas a redes sociales.

## Prueba manual

1. Abrir el último despliegue Preview de `feat/vercel-cloud` y entrar al panel.
2. Preparar o reutilizar una sala activa, pulsar **Habilitar invitados** si hace falta y abrir **Mostrar QR**.
3. Escanear el QR con la cámara de un móvil ya autorizado en Vercel Preview.
4. Confirmar que el PIN está relleno y que aparece un nombre aleatorio, como «Koala Veloz».
5. Pulsar **Otro nombre** y verificar que cambia.
6. Entrar en la sala y comprobar con **Ver participantes** que el nombre figura en el listado.
7. Probar con otro dispositivo autorizado. Confirmar que los nombres no se duplican dentro de una misma sala.
8. Comprobar que el visor QR se cierra y que **Copiar invitación** sigue funcionando.

## Pendiente antes de producción

- Permitir acceso público a invitados sin exponer el panel del anfitrión; el diseño de seguridad de despliegue debe cambiar antes de utilizar QR en grupos.
- Mejorar actualización automática de participantes (ahora es consulta manual).
- Juego en directo, envío de preguntas, cronómetro, respuesta y puntuaciones.
- Aplicar identidad visual definitiva de Quizzz! a todas las pantallas.
