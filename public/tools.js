// Utilidades de las páginas de gestión (proyectos y editor).
const MAX_SIDE = 2400; // las imágenes más grandes se reducen para que carguen rápido en el proyector

function toast(msg, error = false) {
  const t = document.createElement('div');
  t.className = `toast ${error ? 'error' : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

const readAsDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

// Lee una imagen y, si es muy grande, la reduce manteniendo PNG (transparencias) o JPG.
async function readImage(file) {
  if (!file.type.startsWith('image/')) throw new Error(`«${file.name}» no es una imagen`);
  const dataUrl = await readAsDataURL(file);
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return dataUrl;
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error(`No se pudo leer «${file.name}»`));
    i.src = dataUrl;
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 3e6) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return file.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9);
}
