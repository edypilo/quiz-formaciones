# Guía de uso

1. [Instalación](#1-instalación)
2. [Dar una sesión](#2-dar-una-sesión)
3. [Proyectos: tu imagen](#3-proyectos-tu-imagen)
4. [Cuestionarios](#4-cuestionarios)
5. [Cómo se conectan los móviles](#5-cómo-se-conectan-los-móviles)
6. [Actualizar a una versión nueva](#6-actualizar-a-una-versión-nueva)
7. [Copias de seguridad y cambio de ordenador](#7-copias-de-seguridad-y-cambio-de-ordenador)
8. [Problemas frecuentes](#8-problemas-frecuentes)
9. [Opciones avanzadas](#9-opciones-avanzadas)

---

## 1. Instalación

### Requisito: Node.js

La aplicación necesita **Node.js** (gratuito). Descarga la versión **LTS** desde
[nodejs.org](https://nodejs.org/es/download) e instálala con las opciones por defecto. Solo hay que hacerlo una vez.

### Descargar la aplicación

1. Entra en la [última versión](https://github.com/edypilo/quiz-formaciones/releases/latest).
2. En **Assets**, pulsa **Source code (zip)**.
3. Descomprime el archivo donde quieras, por ejemplo en `Documentos`. Obtendrás una carpeta
   `quiz-formaciones-X.Y.Z`; puedes renombrarla a `Quiz` si lo prefieres.

### Abrirla

**Windows:** doble clic en **`Iniciar Quiz.bat`**.

- Si Windows muestra «Windows protegió su PC», pulsa **Más información → Ejecutar de todas formas**.
- La primera vez, el **Firewall** preguntará si permite a Node.js usar la red: marca **Redes privadas** y pulsa
  **Permitir**. Sin esto, los móviles no podrán conectarse por Wi-Fi.

**Mac:** la primera vez, **clic derecho** sobre **`Iniciar Quiz.command`** → **Abrir** → **Abrir**
(macOS bloquea el doble clic en archivos descargados de internet). A partir de entonces basta con doble clic.

- Si aun así no se abre: abre **Terminal**, escribe `cd ` (con espacio), arrastra la carpeta de la aplicación
  a la ventana, pulsa Enter y escribe `npm start`.

Se abrirá una ventana negra (es el servidor: **no la cierres mientras uses la aplicación**) y, en unos segundos,
el navegador con la pantalla del presentador. La primera vez tarda algo más porque descarga los componentes
necesarios (requiere internet).

Para **cerrar** la aplicación, cierra la ventana negra.

---

## 2. Dar una sesión

1. En la pantalla **Nueva sesión** elige:
   - el **cuestionario**,
   - el **proyecto** (logo, colores, portada y financiadores),
   - **cómo se conectarán los móviles** (ver [apartado 5](#5-cómo-se-conectan-los-móviles)).
2. Pulsa **Crear sala**. Si el proyecto tiene portada, se proyecta a pantalla completa: haz clic o pulsa
   Enter para pasar al QR.
3. Los asistentes escanean el **QR** (o entran en la dirección y escriben el **PIN**). Cada uno recibe un
   **nombre anónimo** (puede cambiarlo antes de empezar). Haz clic en un nombre para expulsarlo.
4. Pulsa **Empezar**. En cada pregunta:
   - la pantalla muestra la pregunta y el tiempo; los móviles, los botones de colores;
   - al acabar el tiempo (o con **Saltar**) se revela la respuesta y la explicación;
   - **Clasificación** muestra el top 5 animado.
5. Al final aparece el **podio**. Con **Ver diagnóstico** verás el % de acierto de cada pregunta y podrás
   **descargar los resultados (CSV)** para abrirlos en Excel.

**Atajos durante la proyección:** **F** pantalla completa · **M** activar/silenciar el sonido.

> ⚠️ No recargues la pantalla del presentador durante una partida: se cerraría la sala.

---

## 3. Proyectos: tu imagen

Desde **⚙ Gestionar proyectos** (enlace en la pantalla de nueva sesión). Cada proyecto tiene:

- **Logo**: se muestra en una cabecera blanca. Mejor PNG con fondo transparente o SVG.
- **Colores corporativos**: indica cuántos y su código, y elige cuál es el **principal**, el de **acento**
  (botones) y el de **fondo**. El color del texto se ajusta solo para que se lea bien.
- **Portada**: imagen 16:9 (ideal 1920×1080) que se proyecta al abrir la sala. Si la tienes en PowerPoint o
  PDF, expórtala como PNG o JPG.
- **Entidades financiadoras**: uno o varios logos o banners, en una franja blanca inferior. Puedes mostrarlos
  solo en la sala de espera y los resultados, o siempre.

La vista previa muestra el resultado en directo. **Duplicar** sirve para crear variantes rápidamente.

---

## 4. Cuestionarios

Desde **✏️ Editor de cuestionarios**.

- **Tipos de pregunta**: **Quiz** (2 a 4 respuestas, una o varias correctas), **Verdadero o falso** y
  **Encuesta** (sin respuesta correcta ni puntos; ideal para conocer al grupo).
- En cada pregunta: **tiempo límite**, **puntos** (estándar, doble o sin puntos), **explicación** opcional
  (se muestra en grande al revelar la respuesta) y **multimedia**: imagen, vídeo MP4 o enlace de YouTube.
- Las preguntas incompletas se marcan con ⚠ y el cuestionario no se puede jugar hasta corregirlas.
- **Ctrl + S** guarda.

### Importar desde Excel o Word

1. Descarga la **plantilla** (botones **⬇ Excel** y **⬇ Word** en la lista de cuestionarios).
2. Rellénala: en Excel, **cada fila es una pregunta**; en Word, **cada tabla es una pregunta**.
   Las instrucciones están en la propia plantilla.
3. Pulsa **⬆ Importar desde Excel o Word**. Verás un resumen con los avisos fila a fila.

Dentro de un cuestionario, **⬆ Importar preguntas** permite añadirlas al final o sustituir las actuales, y
**⬇ Exportar a Excel** descarga el cuestionario para revisarlo o compartirlo.

---

## 5. Cómo se conectan los móviles

### Opción A — Misma Wi-Fi (por defecto)

El ordenador y los móviles deben estar en la **misma red Wi-Fi**. No necesita internet.

Puede **no funcionar** en Wi-Fi de invitados, de hoteles o corporativas, porque suelen impedir que los
dispositivos se vean entre sí. En ese caso usa la opción B.

### Opción B — Internet, desde cualquier red (un clic) ⭐

En **¿Cómo se conectarán los móviles?** elige **🌐 Internet** y crea la sala. En unos segundos el QR apuntará a
una dirección pública del tipo `https://palabras-al-azar.trycloudflare.com`, y los asistentes podrán entrar
**con datos móviles o con cualquier Wi-Fi**.

- Usa un túnel gratuito de **Cloudflare**: no necesitas cuenta ni configurar nada. El componente se descarga
  automáticamente con la aplicación.
- La dirección es **temporal**: cambia cada vez que abres la aplicación y desaparece al cerrarla.
- Requiere que **tu ordenador tenga internet** durante la sesión.
- **Seguridad**: por internet solo se puede **jugar**. El editor, los proyectos y la pantalla del presentador
  solo funcionan desde tu propio ordenador.
- Los vídeos subidos se envían desde tu conexión; si es lenta, mejor usa enlaces de **YouTube**.

### Opción C — Dirección fija y permanente (avanzado)

Si quieres una dirección siempre igual (por ejemplo `https://quiz.tu-dominio.com`) o tener la aplicación en un
ordenador siempre encendido (un mini PC, un servidor), consulta las [opciones avanzadas](#9-opciones-avanzadas).

---

## 6. Actualizar a una versión nueva

Cuando haya una versión nueva, la pantalla **Nueva sesión** mostrará un aviso amarillo **«Hay una versión
nueva»**. Para actualizar:

1. Cierra la aplicación (ventana negra).
2. Descarga el **Source code (zip)** de la [última versión](https://github.com/edypilo/quiz-formaciones/releases/latest).
3. Descomprímelo y **sustituye la carpeta antigua** por la nueva (o borra la antigua).
4. Ábrela como siempre. La primera vez tardará un poco en preparar los componentes.

**Tus datos no se tocan**: viven en `Documentos/Quiz`, fuera de la carpeta del programa.

*(Si la instalaste con `git clone`, basta con `git pull` en la carpeta.)*

---

## 7. Copias de seguridad y cambio de ordenador

Todos tus proyectos, cuestionarios, logos, imágenes y vídeos están en **`Documentos/Quiz`**
(la ruta exacta aparece al pie de la pantalla **Nueva sesión**).

- **Copia de seguridad**: copia esa carpeta (a un USB, OneDrive, Google Drive…).
- **Otro ordenador**: instala la aplicación y copia la carpeta `Quiz` dentro de `Documentos`.
- **Compartir un proyecto o un cuestionario** con un compañero: pásale su carpeta (dentro de `proyectos` o
  `cuestionarios`) y que la copie en el mismo sitio de su `Documentos/Quiz`. También puedes exportar un
  cuestionario a Excel y que él lo importe.

---

## 8. Problemas frecuentes

**Los móviles no cargan la página (opción Wi-Fi)**
- Comprueba que el móvil está en la **misma Wi-Fi** (no en datos móviles).
- En Windows, permite Node.js en el Firewall: *Panel de control → Firewall de Windows Defender → Permitir una
  aplicación* → marca **Node.js** en **Privada**.
- Si la red es de invitados o corporativa, usa la opción **🌐 Internet**.
- En el selector de red aparecen varias direcciones: elige la de tu **Wi-Fi**.

**«El puerto 3000 ya está en uso»**
La aplicación ya está abierta en otra ventana. Ciérrala o abre `http://localhost:3000/host`.

**«No se ha podido publicar en internet»**
- Comprueba que el ordenador tiene internet.
- Algunas redes corporativas o antivirus bloquean el componente `cloudflared`: prueba con otra red (por ejemplo
  compartiendo datos desde tu móvil al portátil).

**Windows dice que no encuentra Node.js aunque lo instalé**
Reinicia el ordenador después de instalar Node.js.

**Mac: «no se puede abrir porque es de un desarrollador no identificado»**
Clic derecho sobre el archivo → **Abrir** → **Abrir**.

**Al importar un Excel aparecen avisos**
Revisa las filas indicadas: suele faltar la respuesta correcta o haber un tipo de pregunta mal escrito. Las
preguntas se importan igualmente y quedan marcadas con ⚠ para completarlas en el editor.

---

## 9. Opciones avanzadas

Se configuran con variables de entorno antes de arrancar (`npm start`):

| Variable | Para qué sirve | Ejemplo |
|---|---|---|
| `PORT` | Cambiar el puerto (por defecto 3000) | `PORT=8080` |
| `QUIZ_DATA_DIR` | Guardar los datos en otra carpeta | `QUIZ_DATA_DIR=D:\Quiz` |
| `PUBLIC_URL` | Dirección pública fija que se pondrá en el QR | `PUBLIC_URL=https://quiz.tu-dominio.com` |
| `QUIZ_NO_BROWSER` | No abrir el navegador al arrancar (servidores) | `QUIZ_NO_BROWSER=1` |

En Windows (PowerShell): `$env:PUBLIC_URL="https://quiz.tu-dominio.com"; npm start`
En Mac/Linux: `PUBLIC_URL=https://quiz.tu-dominio.com npm start`

### Dirección permanente con Cloudflare y tu dominio

Si tienes un dominio gestionado en Cloudflare, crea un **Cloudflare Tunnel** con nombre (gratuito) desde
*Zero Trust → Networks → Tunnels*, apúntalo a `http://localhost:3000` y arranca la aplicación con
`PUBLIC_URL=https://quiz.tu-dominio.com`. Los móviles entrarán siempre por esa dirección.

### Dirección permanente con Tailscale Funnel

Si usas [Tailscale](https://tailscale.com), en el ordenador que sirve la aplicación ejecuta
`tailscale funnel 3000` y arranca la aplicación con `PUBLIC_URL` igual a la dirección `https://….ts.net` que te indique.

### En un ordenador siempre encendido (mini PC, servidor)

Instala Node.js y la aplicación, arráncala con `QUIZ_NO_BROWSER=1` y publícala con una de las dos opciones
anteriores. Por seguridad, el editor, los proyectos y la pantalla del presentador **solo funcionan desde ese
mismo ordenador**: para gestionarlo en remoto, conéctate a él (escritorio remoto, o un túnel SSH a su puerto 3000).

> No publiques la aplicación abriendo puertos en el router: usa siempre un túnel (Cloudflare o Tailscale).
