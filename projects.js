// Proyectos = identidades visuales (logo, colores, portada, financiadores).
// Cada proyecto vive en projects/<id>/project.json y sus imágenes en projects/<id>/assets/.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { PROJECTS_DIR } = require('./paths');
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const HEX = /^#[0-9a-f]{6}$/i;

const FALLBACK = {
  id: null, name: 'Sin proyecto', title: 'Quiz', organization: '',
  logo: null, cover: null, funders: [], fundersPlacement: 'lobby',
  colors: ['#1F3A93', '#00A8A8'], roles: { primary: 0, accent: 1, background: 'auto' },
};

const projectDir = (id) => path.join(PROJECTS_DIR, path.basename(String(id)));
const assetsDir = (id) => path.join(projectDir(id), 'assets');

function slugify(text) {
  const base = String(text || 'proyecto').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'proyecto';
  return `${base}-${crypto.randomBytes(2).toString('hex')}`;
}

function readProject(id) {
  const file = path.join(projectDir(id), 'project.json');
  if (!fs.existsSync(file)) return null;
  return { ...FALLBACK, ...JSON.parse(fs.readFileSync(file, 'utf8')), id: path.basename(String(id)) };
}

function listProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readProject(d.name))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

// Convierte las rutas de archivo internas en URLs que el navegador puede cargar.
function toPublic(p) {
  if (!p) return { ...FALLBACK };
  const url = (f) => (f ? `/media/${p.id}/${encodeURIComponent(f)}` : null);
  return { ...p, logo: url(p.logo), cover: url(p.cover), funders: p.funders.map(url) };
}

// Guarda una imagen recibida como data URL y devuelve el nombre de archivo.
function storeImage(id, value, prefix) {
  if (!value) return null;
  if (!String(value).startsWith('data:')) {
    const existing = path.basename(decodeURIComponent(String(value).split('/').pop()));
    return fs.existsSync(path.join(assetsDir(id), existing)) ? existing : null;
  }
  const m = /^data:([^;]+);base64,(.+)$/.exec(value);
  if (!m || !IMAGE_TYPES[m[1]]) throw new Error('Formato de imagen no admitido (usa PNG, JPG, WEBP, GIF o SVG)');
  const name = `${prefix}-${crypto.randomBytes(4).toString('hex')}.${IMAGE_TYPES[m[1]]}`;
  fs.mkdirSync(assetsDir(id), { recursive: true });
  fs.writeFileSync(path.join(assetsDir(id), name), Buffer.from(m[2], 'base64'));
  return name;
}

function saveProject(id, data) {
  const isNew = !id;
  id = isNew ? slugify(data.name) : path.basename(String(id));
  if (!isNew && !readProject(id)) throw new Error('El proyecto no existe');

  const colors = (Array.isArray(data.colors) ? data.colors : []).filter((c) => HEX.test(c)).slice(0, 12);
  if (!colors.length) throw new Error('Indica al menos un color corporativo');
  const idx = (v, def) => (Number.isInteger(v) && v >= 0 && v < colors.length ? v : def);

  fs.mkdirSync(projectDir(id), { recursive: true });
  const project = {
    name: String(data.name || 'Proyecto sin nombre').slice(0, 80),
    title: String(data.title || data.name || 'Quiz').slice(0, 80),
    organization: String(data.organization || '').slice(0, 80),
    logo: storeImage(id, data.logo, 'logo'),
    cover: storeImage(id, data.cover, 'portada'),
    funders: (Array.isArray(data.funders) ? data.funders : []).slice(0, 10).map((f) => storeImage(id, f, 'financiador')),
    fundersPlacement: data.fundersPlacement === 'always' ? 'always' : 'lobby',
    colors,
    roles: {
      primary: idx(data.roles?.primary, 0),
      accent: idx(data.roles?.accent, Math.min(1, colors.length - 1)),
      background: data.roles?.background === 'auto' ? 'auto' : idx(data.roles?.background, 'auto'),
    },
  };
  fs.writeFileSync(path.join(projectDir(id), 'project.json'), JSON.stringify(project, null, 2));

  // Borra las imágenes que ya no usa el proyecto (p. ej. un logo sustituido).
  const used = new Set([project.logo, project.cover, ...project.funders].filter(Boolean));
  if (fs.existsSync(assetsDir(id))) {
    for (const f of fs.readdirSync(assetsDir(id))) if (!used.has(f)) fs.unlinkSync(path.join(assetsDir(id), f));
  }
  return readProject(id);
}

function deleteProject(id) {
  const dir = projectDir(id);
  if (fs.existsSync(path.join(dir, 'project.json'))) fs.rmSync(dir, { recursive: true, force: true });
}

function mediaPath(id, file) {
  const p = path.join(assetsDir(id), path.basename(String(file)));
  return fs.existsSync(p) ? p : null;
}

module.exports = { listProjects, readProject, toPublic, saveProject, deleteProject, mediaPath };
