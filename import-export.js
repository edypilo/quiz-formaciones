// Plantillas Excel/Word, importación de preguntas desde ellas y exportación a Excel.
const ExcelJS = require('exceljs');
const mammoth = require('mammoth');
const { readXlsx } = require('./xlsx-reader');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, ShadingType,
} = require('docx');
const { getType, normalizeQuestion, youtubeId, POINTS } = require('./public/question-types');

const TYPE_LABELS = { quiz: 'Quiz', truefalse: 'Verdadero o falso', poll: 'Encuesta' };
const POINT_LABELS = Object.fromEntries(POINTS.map((p) => [p.value, p.label]));
const ANSWER_COLORS = ['E21B3C', '1368CE', 'D89E00', '26890C'];

// Columnas / filas de las plantillas (mismo orden en Excel y Word).
const FIELDS = [
  { key: 'type', label: 'Tipo', width: 18, help: 'Quiz, Verdadero o falso o Encuesta' },
  { key: 'text', label: 'Pregunta', width: 50, help: 'Máximo 250 caracteres' },
  { key: 'o1', label: 'Respuesta 1', width: 22 },
  { key: 'o2', label: 'Respuesta 2', width: 22 },
  { key: 'o3', label: 'Respuesta 3', width: 22, help: 'Opcional' },
  { key: 'o4', label: 'Respuesta 4', width: 22, help: 'Opcional' },
  { key: 'correct', label: 'Correcta(s)', width: 14, help: 'Número de la respuesta (1-4). Varias: 1,3. En V/F: Verdadero o Falso' },
  { key: 'time', label: 'Tiempo (s)', width: 11, help: '5 a 240 segundos' },
  { key: 'points', label: 'Puntos', width: 12, help: 'Estándar, Doble o Sin puntos' },
  { key: 'explanation', label: 'Explicación (opcional)', width: 45, help: 'Se muestra al revelar la respuesta' },
  { key: 'media', label: 'Multimedia: URL de imagen o YouTube (opcional)', width: 34, help: 'Las imágenes y vídeos de tu ordenador se añaden después en el editor' },
];

const EXAMPLES = [
  {
    type: 'Quiz', text: '¿Qué función de Excel suma solo las celdas que cumplen una condición?',
    o1: 'SUMA', o2: 'SUMAR.SI', o3: 'CONTAR', o4: 'PROMEDIO', correct: '2', time: 20, points: 'Estándar',
    explanation: 'SUMAR.SI suma los valores que cumplen un criterio, por ejemplo =SUMAR.SI(A:A;">100").',
  },
  {
    type: 'Verdadero o falso', text: 'Un archivo compartido con «cualquiera con el enlace» solo lo pueden abrir mis compañeros.',
    o1: 'Verdadero', o2: 'Falso', correct: 'Falso', time: 10, points: 'Estándar',
    explanation: 'Cualquier persona que tenga el enlace puede abrirlo, aunque no sea de tu organización.',
  },
  {
    type: 'Encuesta', text: '¿Con qué frecuencia usas hojas de cálculo en tu trabajo?',
    o1: 'Nunca', o2: 'Alguna vez al mes', o3: 'Varias veces por semana', o4: 'A diario', time: 20,
  },
  {
    type: 'Quiz', text: '¿Cuáles de estas son buenas prácticas de seguridad?',
    o1: 'Activar la verificación en dos pasos', o2: 'Usar la misma contraseña en todo', o3: 'Bloquear el equipo al levantarte',
    o4: 'Compartir la contraseña por correo', correct: '1,3', time: 30, points: 'Doble',
    explanation: 'Hay dos respuestas correctas: la verificación en dos pasos y bloquear el equipo.',
  },
];

const INSTRUCTIONS = [
  'Cada fila (en Excel) o cada tabla (en Word) es una pregunta.',
  'Tipo: Quiz (2 a 4 respuestas, una o varias correctas), Verdadero o falso, o Encuesta (sin respuesta correcta ni puntos).',
  'Correcta(s): el número de la respuesta correcta (1, 2, 3 o 4). Si hay varias, sepáralas con comas: 1,3. En Verdadero o falso escribe Verdadero o Falso.',
  'Tiempo: segundos para responder (de 5 a 240). Si lo dejas vacío se usan 20.',
  'Puntos: Estándar (hasta 1000), Doble (hasta 2000) o Sin puntos. Vacío = Estándar.',
  'Explicación (opcional): un texto breve que se muestra en pantalla y en los móviles al revelar la respuesta.',
  'Multimedia (opcional): un enlace de YouTube o de una imagen en internet. Las imágenes o vídeos de tu ordenador se añaden después desde el editor.',
  'Las filas de ejemplo se pueden borrar o sobrescribir.',
];

// ---------- Lectura ----------

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function fieldForLabel(label) {
  const n = norm(label);
  if (!n) return null;
  const m = /^(?:respuesta|opcion)\s*([1-4a-d])/.exec(n);
  if (m) return `o${'abcd'.includes(m[1]) ? 'abcd'.indexOf(m[1]) + 1 : m[1]}`;
  if (n.startsWith('tipo')) return 'type';
  if (n.startsWith('pregunta') || n.startsWith('enunciado')) return 'text';
  if (n.startsWith('correcta')) return 'correct';
  if (n.startsWith('tiempo')) return 'time';
  if (n.startsWith('punto')) return 'points';
  if (n.startsWith('explicacion')) return 'explanation';
  if (n.startsWith('multimedia') || n.startsWith('imagen') || n.startsWith('video') || n.startsWith('url')) return 'media';
  return null;
}

function parseType(value, options) {
  const n = norm(value);
  if (!n) return options.map(norm).join('|') === 'verdadero|falso' ? 'truefalse' : 'quiz';
  if (n.includes('verdadero') || n === 'v/f' || n === 'vf') return 'truefalse';
  if (n.includes('encuesta')) return 'poll';
  if (n.includes('quiz') || n.includes('test') || n.includes('opcion')) return 'quiz';
  return null;
}

function parseCorrect(value, type, options) {
  const n = norm(value);
  if (!n) return [];
  if (type === 'truefalse') {
    if (/^(v|verdadero|true|si|1)$/.test(n)) return [0];
    if (/^(f|falso|false|no|2)$/.test(n)) return [1];
    return [];
  }
  const byText = options.findIndex((o) => o && norm(o) === n);
  if (byText >= 0) return [byText];
  return n.split(/[\s,;/]+|\by\b/).filter(Boolean).map((t) => {
    if (/^[1-4]$/.test(t)) return Number(t) - 1;
    if (/^[a-d]$/.test(t)) return 'abcd'.indexOf(t);
    return options.findIndex((o) => o && norm(o) === t);
  }).filter((i) => i >= 0);
}

function parsePoints(value) {
  const n = norm(value);
  if (!n || n.startsWith('estandar') || n === 'normal' || n === '1') return 1;
  if (n.startsWith('doble') || n === '2' || n === 'x2') return 2;
  if (n.startsWith('sin') || n === '0' || n.startsWith('ningun')) return 0;
  return null;
}

function parseMedia(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (youtubeId(v)) return { type: 'youtube', src: v };
  if (/^https?:\/\//i.test(v)) return { type: 'image', src: v };
  return undefined;
}

// Convierte un registro {type, text, o1..o4, ...} en pregunta, anotando avisos con su origen.
function recordToQuestion(rec, where) {
  const warnings = [];
  const options = [rec.o1, rec.o2, rec.o3, rec.o4].map((o) => String(o ?? '').trim());
  let type = parseType(rec.type, options);
  if (!type) { warnings.push(`tipo «${rec.type}» desconocido, se usa Quiz`); type = 'quiz'; }
  const points = parsePoints(rec.points);
  if (points === null) warnings.push(`puntos «${rec.points}» no reconocidos, se usa Estándar`);
  const media = parseMedia(rec.media);
  if (media === undefined) warnings.push('el multimedia debe ser un enlace (http…) de imagen o de YouTube; se ignora');
  const timeRaw = String(rec.time ?? '').trim();
  if (timeRaw && !Number(timeRaw)) warnings.push(`tiempo «${timeRaw}» no válido, se usan 20 s`);

  const { question, errors } = normalizeQuestion({
    type, text: rec.text, options, correct: parseCorrect(rec.correct, type, options),
    time: Number(timeRaw) || 20, points: points ?? 1, explanation: rec.explanation, media: media || null,
  });
  return { question, warnings: [...warnings, ...errors].map((w) => `${where}: ${w}`) };
}

const isEmptyRecord = (rec) => Object.values(rec).every((v) => !String(v ?? '').trim());

async function parseExcel(buffer) {
  const sheets = await readXlsx(buffer);
  const sheet = sheets.find((s) => norm(s.name) === 'preguntas') || sheets[0];

  // Busca la fila de cabecera (la que contiene «Pregunta») para tolerar filas de título.
  const headerIndex = sheet.rows.findIndex((row) => row.some((cell) => fieldForLabel(cell) === 'text'));
  if (headerIndex < 0) throw new Error('No encuentro la fila de cabecera con la columna «Pregunta». Usa la plantilla de Excel.');
  const columns = {};
  sheet.rows[headerIndex].forEach((cell, col) => { const f = fieldForLabel(cell); if (f && !(f in columns)) columns[f] = col; });

  const questions = [];
  const warnings = [];
  sheet.rows.slice(headerIndex + 1).forEach((row, i) => {
    const rec = Object.fromEntries(Object.entries(columns).map(([f, col]) => [f, row[col] ?? '']));
    if (isEmptyRecord(rec)) return;
    const r = recordToQuestion(rec, `Fila ${headerIndex + i + 2}`);
    questions.push(r.question);
    warnings.push(...r.warnings);
  });
  return { questions, warnings };
}

const decodeHtml = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function parseWord(buffer) {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const tables = html.match(/<table[\s\S]*?<\/table>/g) || [];
  const questions = [];
  const warnings = [];
  let n = 0;
  for (const table of tables) {
    const rec = {};
    for (const row of table.match(/<tr[\s\S]*?<\/tr>/g) || []) {
      const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []).map(decodeHtml);
      const f = fieldForLabel(cells[0]);
      if (f && cells.length > 1) rec[f] = cells.slice(1).join(' ').trim();
    }
    if (!('text' in rec)) continue; // tablas que no son preguntas (p. ej. instrucciones)
    n++;
    if (isEmptyRecord(rec) || !String(rec.text || '').trim()) continue; // tablas vacías de la plantilla
    const r = recordToQuestion(rec, `Pregunta ${n}`);
    questions.push(r.question);
    warnings.push(...r.warnings);
  }
  if (!n) throw new Error('No encuentro tablas de preguntas en el documento. Usa la plantilla de Word.');
  return { questions, warnings };
}

async function parseFile(filename, buffer) {
  const ext = String(filename).toLowerCase().split('.').pop();
  if (ext === 'xlsx') return parseExcel(buffer);
  if (ext === 'docx') return parseWord(buffer);
  if (ext === 'xls' || ext === 'doc') throw new Error('Formato antiguo: guarda el archivo como .xlsx o .docx e inténtalo de nuevo.');
  throw new Error('Sube un archivo Excel (.xlsx) o Word (.docx).');
}

// ---------- Escritura ----------

function questionToRecord(q) {
  const opts = [...q.options, '', '', '', ''].slice(0, 4);
  const correct = q.type === 'truefalse' ? (q.correct[0] === 1 ? 'Falso' : 'Verdadero')
    : q.type === 'poll' ? '' : q.correct.map((i) => i + 1).join(',');
  const media = q.media && (q.media.type === 'youtube' || /^https?:\/\//i.test(q.media.src)) ? q.media.src : '';
  return {
    type: TYPE_LABELS[q.type] || getType(q.type)?.label || q.type, text: q.text,
    o1: opts[0], o2: opts[1], o3: opts[2], o4: opts[3], correct, time: q.time,
    points: q.type === 'poll' ? '' : POINT_LABELS[q.points], explanation: q.explanation, media,
  };
}

async function buildExcel(quiz) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Quiz';
  const ws = wb.addWorksheet('Preguntas', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = FIELDS.map((f) => ({ header: f.label, key: f.key, width: f.width }));
  const header = ws.getRow(1);
  header.height = 34;
  header.eachCell((cell, col) => {
    const color = col >= 3 && col <= 6 ? ANSWER_COLORS[col - 3] : '1F3A93';
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    const help = FIELDS[col - 1].help;
    if (help) cell.note = help;
  });

  const records = quiz ? quiz.questions.map(questionToRecord) : EXAMPLES;
  records.forEach((r) => ws.addRow(r));
  const last = 500;
  for (let r = 2; r <= last; r++) ws.getRow(r).alignment = { vertical: 'top', wrapText: true };
  ws.dataValidations.add(`A2:A${last}`, {
    type: 'list', allowBlank: true, formulae: ['"Quiz,Verdadero o falso,Encuesta"'],
    showErrorMessage: true, errorTitle: 'Tipo no válido', error: 'Elige Quiz, Verdadero o falso o Encuesta',
  });
  ws.dataValidations.add(`I2:I${last}`, {
    type: 'list', allowBlank: true, formulae: ['"Estándar,Doble,Sin puntos"'],
    showErrorMessage: true, errorTitle: 'Puntos no válidos', error: 'Elige Estándar, Doble o Sin puntos',
  });
  ws.dataValidations.add(`H2:H${last}`, {
    type: 'whole', operator: 'between', allowBlank: true, formulae: [5, 240],
    showErrorMessage: true, errorTitle: 'Tiempo no válido', error: 'Indica un número de segundos entre 5 y 240',
  });

  const info = wb.addWorksheet('Instrucciones');
  info.getColumn(1).width = 120;
  info.addRow(['Cómo rellenar la plantilla']).font = { bold: true, size: 14, color: { argb: 'FF1F3A93' } };
  info.addRow([]);
  INSTRUCTIONS.forEach((t, i) => { info.addRow([`${i + 1}. ${t}`]).alignment = { wrapText: true }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function wordQuestionTable(rec, n) {
  const cell = (text, opts = {}) => new TableCell({
    width: { size: opts.width, type: WidthType.PERCENTAGE },
    shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text: String(text ?? ''), bold: !!opts.bold, color: opts.color })] })],
  });
  const rows = FIELDS.map((f, i) => {
    const answer = /^o[1-4]$/.test(f.key) ? ANSWER_COLORS[Number(f.key[1]) - 1] : null;
    return new TableRow({
      children: [
        cell(f.label.replace(': URL de imagen o YouTube (opcional)', ' (URL, opcional)'), {
          width: 30, bold: true, fill: answer || (i % 2 ? 'EEF1F8' : 'E3E8F4'), color: answer ? 'FFFFFF' : '1F3A93',
        }),
        cell(rec[f.key], { width: 70 }),
      ],
    });
  });
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [new TextRun(`Pregunta ${n}`)] }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
  ];
}

async function buildWord(quiz = null) {
  const empty = Object.fromEntries(FIELDS.map((f) => [f.key, '']));
  const blank = [{ ...empty, type: 'Quiz', time: 20, points: 'Estándar' }, { ...empty, type: 'Quiz', time: 20, points: 'Estándar' }];
  const records = quiz ? quiz.questions.map(questionToRecord) : [...EXAMPLES, ...blank];
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(quiz ? quiz.title : 'Plantilla de preguntas')] }),
        ...(quiz ? [] : [
          new Paragraph({ children: [new TextRun({ text: 'Cómo rellenarla', bold: true, color: '1F3A93' })] }),
          ...INSTRUCTIONS.map((t) => new Paragraph({ bullet: { level: 0 }, children: [new TextRun(t.replace('Cada fila (en Excel) o cada tabla (en Word)', 'Cada tabla'))] })),
          new Paragraph({ children: [new TextRun({ text: 'Para añadir preguntas, copia y pega una de las tablas. No cambies los textos de la columna izquierda.', italics: true })] }),
        ]),
        ...records.flatMap((rec, i) => wordQuestionTable(rec, i + 1)),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { parseFile, buildExcel, buildWord };
