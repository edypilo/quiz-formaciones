// Utilidades compartidas entre presentador, jugadores y gestión de proyectos.
const SHAPES = ['▲', '◆', '●', '■'];

function $(sel) { return document.querySelector(sel); }

function show(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== id));
  document.body.dataset.view = id;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Imagen, vídeo o YouTube de una pregunta (requiere question-types.js para YouTube).
function mediaHtml(media, { autoplay = false } = {}) {
  if (!media || !media.src) return '';
  const src = escapeHtml(media.src);
  if (media.type === 'image') return `<img src="${src}" alt="">`;
  if (media.type === 'video') return `<video src="${src}" controls playsinline ${autoplay ? 'autoplay' : ''}></video>`;
  if (media.type === 'youtube') {
    const id = window.QuestionTypes?.youtubeId(media.src);
    if (!id) return '';
    return `<iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0${autoplay ? '&autoplay=1' : ''}"
      title="Vídeo de YouTube" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  }
  return '';
}

// ---------- Colores ----------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Texto blanco o casi negro, el que mejor se lea sobre ese color.
function readableOn(hex) {
  return luminance(hex) > 0.179 ? '#1A1A1A' : '#FFFFFF';
}

function darken(hex, amount) {
  return rgbToHex(hexToRgb(hex).map((v) => v * (1 - amount)));
}

// Traduce la paleta corporativa + roles a los colores concretos de la interfaz.
function resolveColors(b) {
  const palette = b.colors?.length ? b.colors : ['#1F3A93', '#00A8A8'];
  const pick = (i, def) => palette[Number.isInteger(i) && palette[i] ? i : def];
  const primary = pick(b.roles?.primary, 0);
  const accent = pick(b.roles?.accent, Math.min(1, palette.length - 1));
  const background = b.roles?.background === 'auto' || b.roles?.background == null
    ? darken(primary, 0.6) : pick(b.roles.background, 0);
  return {
    primary, accent, background, text: readableOn(background), onAccent: readableOn(accent), onPrimary: readableOn(primary),
    primaryOnWhite: luminance(primary) > 0.4 ? '#1A1A1A' : primary,
  };
}

// ---------- Marca ----------

function applyBranding(b, root = document.documentElement) {
  const c = resolveColors(b);
  root.style.setProperty('--primary', c.primary);
  root.style.setProperty('--secondary', c.accent);
  root.style.setProperty('--on-secondary', c.onAccent);
  root.style.setProperty('--on-primary', c.onPrimary);
  root.style.setProperty('--primary-on-white', c.primaryOnWhite);
  root.style.setProperty('--bg', c.background);
  root.style.setProperty('--text', c.text);
  root.classList.toggle('light-bg', c.text !== '#FFFFFF');

  root.querySelectorAll('[data-logo]').forEach((img) => {
    img.classList.toggle('hidden', !b.logo);
    if (b.logo) { img.src = b.logo; img.alt = b.organization || b.title || ''; }
  });
  root.querySelectorAll('[data-appname]').forEach((el) => { el.textContent = b.title || ''; });
  root.querySelectorAll('[data-funders]').forEach((el) => {
    el.innerHTML = (b.funders || []).map((src) => `<img src="${escapeHtml(src)}" alt="Entidad financiadora">`).join('');
    el.classList.toggle('hidden', !b.funders?.length);
    el.dataset.placement = b.fundersPlacement || 'lobby';
  });
  if (root === document.documentElement && b.title) document.title = b.title;
  return c;
}

async function loadBranding(pin) {
  const res = await fetch(`/api/branding${pin ? `?pin=${encodeURIComponent(pin)}` : ''}`);
  const b = await res.json();
  applyBranding(b);
  return b;
}
