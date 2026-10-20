// Dónde se guardan los datos del usuario (proyectos y cuestionarios): fuera de la carpeta
// del programa, para que actualizar la aplicación nunca los toque.
// Por defecto en Documentos/Quiz; se puede cambiar con la variable de entorno QUIZ_DATA_DIR.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function documentsDir() {
  // En Windows, «Documentos» puede estar redirigido (p. ej. a OneDrive): se pregunta al sistema.
  if (process.platform === 'win32') {
    try {
      const dir = execFileSync('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('MyDocuments')"],
        { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
      if (dir && fs.existsSync(dir)) return dir;
    } catch {}
  }
  return path.join(os.homedir(), 'Documents');
}

const DATA_DIR = process.env.QUIZ_DATA_DIR || path.join(documentsDir(), 'Quiz');
const PROJECTS_DIR = path.join(DATA_DIR, 'proyectos');
const QUIZZES_DIR = path.join(DATA_DIR, 'cuestionarios');
const EXAMPLES_DIR = path.join(__dirname, 'ejemplos');

// La primera vez se copian el proyecto y el cuestionario de ejemplo.
function ensureDataDirs() {
  for (const [dir, example] of [[PROJECTS_DIR, 'proyectos'], [QUIZZES_DIR, 'cuestionarios']]) {
    if (fs.existsSync(dir)) continue;
    fs.mkdirSync(dir, { recursive: true });
    const src = path.join(EXAMPLES_DIR, example);
    if (fs.existsSync(src)) fs.cpSync(src, dir, { recursive: true });
  }
}

module.exports = { DATA_DIR, PROJECTS_DIR, QUIZZES_DIR, ensureDataDirs };
