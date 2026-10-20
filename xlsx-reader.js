// Lector mínimo de .xlsx tolerante: admite etiquetas con prefijo de espacio de nombres
// (<x:sheet>, como guardan Excel Online y otras herramientas), rutas absolutas y BOM.
// Devuelve las hojas como matrices de texto: [{ name, rows: [[celda, ...], ...] }].
const JSZip = require('jszip');
const path = require('path').posix;

const tag = (name) => `(?:[\\w.-]+:)?${name}`;

function decode(s) {
  return String(s)
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function attr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}="([^"]*)"`).exec(attrs);
  return m ? decode(m[1]) : null;
}

// Concatena todos los <t> de un fragmento (texto enriquecido incluido), salvo la fonética <rPh>.
function textOf(xml) {
  const clean = xml.replace(new RegExp(`<${tag('rPh')}\\b[\\s\\S]*?</${tag('rPh')}>`, 'g'), '');
  let out = '';
  const re = new RegExp(`<${tag('t')}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag('t')}>`, 'g');
  for (let m; (m = re.exec(clean));) out += decode(m[1]);
  return out;
}

function colIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref || '')?.[0].toUpperCase() || 'A';
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

async function readText(zip, name) {
  const file = zip.file(name) || zip.file(Object.keys(zip.files).find((f) => f.toLowerCase() === name.toLowerCase()) || '');
  return file ? (await file.async('string')).replace(/^﻿/, '') : null;
}

// Resuelve el destino de una relación respecto a la carpeta de la parte que la declara.
const resolveTarget = (base, target) => (target.startsWith('/') ? target.slice(1) : path.normalize(path.join(path.dirname(base), target)));

async function readRels(zip, part) {
  const relsName = path.join(path.dirname(part), '_rels', `${path.basename(part)}.rels`);
  const xml = (await readText(zip, relsName)) || '';
  const rels = {};
  for (const m of xml.matchAll(new RegExp(`<${tag('Relationship')}\\b([^>]*)/?>`, 'g'))) {
    rels[attr(m[1], 'Id')] = { type: attr(m[1], 'Type') || '', target: resolveTarget(part, attr(m[1], 'Target') || '') };
  }
  return rels;
}

async function readXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const rootRels = await readRels(zip, '');
  const workbookPart = Object.values(rootRels).find((r) => /officeDocument$/.test(r.type))?.target || 'xl/workbook.xml';
  const workbook = await readText(zip, workbookPart);
  if (!workbook) throw new Error('El archivo no parece un Excel (.xlsx) válido.');
  const rels = await readRels(zip, workbookPart);

  const sharedPart = Object.values(rels).find((r) => /sharedStrings$/.test(r.type))?.target;
  const sharedXml = sharedPart ? (await readText(zip, sharedPart)) || '' : '';
  const shared = [...sharedXml.matchAll(new RegExp(`<${tag('si')}\\b[^>]*>([\\s\\S]*?)</${tag('si')}>`, 'g'))].map((m) => textOf(m[1]));

  const sheets = [];
  for (const m of workbook.matchAll(new RegExp(`<${tag('sheet')}\\b([^>]*)/?>`, 'g'))) {
    const rel = rels[attr(m[1], 'id')];
    const xml = rel && (await readText(zip, rel.target));
    if (!xml) continue;
    const rows = [];
    let rowNum = 0;
    for (const r of xml.matchAll(new RegExp(`<${tag('row')}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag('row')}>)`, 'g'))) {
      rowNum = Number(attr(r[1], 'r')) || rowNum + 1;
      const cells = [];
      let col = -1;
      for (const c of (r[2] || '').matchAll(new RegExp(`<${tag('c')}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag('c')}>)`, 'g'))) {
        const ref = attr(c[1], 'r');
        col = ref ? colIndex(ref) : col + 1;
        const type = attr(c[1], 't');
        const body = c[2] || '';
        const v = new RegExp(`<${tag('v')}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag('v')}>`).exec(body)?.[1];
        let value = '';
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = textOf(body);
        else if (type === 'b') value = v === '1' ? 'VERDADERO' : 'FALSO';
        else if (v !== undefined) value = decode(v);
        cells[col] = value.trim();
      }
      rows[rowNum - 1] = Array.from(cells, (x) => x ?? '');
    }
    sheets.push({ name: attr(m[1], 'name') || `Hoja ${sheets.length + 1}`, rows: Array.from(rows, (x) => x ?? []) });
  }
  if (!sheets.length) throw new Error('El Excel no tiene hojas legibles.');
  return sheets;
}

module.exports = { readXlsx };
