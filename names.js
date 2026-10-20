// Nombres anónimos "Animal + Adjetivo". Los adjetivos son invariables en género
// para que siempre concuerden (Nutria Valiente, Lince Valiente...).
const ANIMALS = [
  ['Pingüino', '🐧'], ['Koala', '🐨'], ['Nutria', '🦦'], ['Búho', '🦉'], ['Zorro', '🦊'],
  ['Panda', '🐼'], ['Tortuga', '🐢'], ['Jirafa', '🦒'], ['Halcón', '🦅'], ['Ardilla', '🐿️'],
  ['Castor', '🦫'], ['Erizo', '🦔'], ['Foca', '🦭'], ['Mapache', '🦝'], ['Llama', '🦙'],
  ['Colibrí', '🐦'], ['Tigre', '🐯'], ['León', '🦁'], ['Ballena', '🐳'], ['Pulpo', '🐙'],
  ['Camaleón', '🦎'], ['Flamenco', '🦩'], ['Canguro', '🦘'], ['Lobo', '🐺'], ['Oso', '🐻'],
  ['Delfín', '🐬'], ['Rana', '🐸'], ['Abeja', '🐝'], ['Mariposa', '🦋'], ['Elefante', '🐘'],
  ['Cebra', '🦓'], ['Gato', '🐱'], ['Perro', '🐶'], ['Conejo', '🐰'], ['Unicornio', '🦄'],
];
const ADJECTIVES = [
  'Valiente', 'Veloz', 'Feliz', 'Audaz', 'Sagaz', 'Genial', 'Brillante', 'Elegante',
  'Inteligente', 'Alegre', 'Leal', 'Tenaz', 'Fugaz', 'Paciente', 'Amable', 'Increíble',
  'Imparable', 'Estelar', 'Original', 'Formidable', 'Ágil', 'Noble', 'Libre', 'Jovial',
  'Radiante', 'Constante', 'Sutil', 'Capaz', 'Fiel', 'Cordial', 'Vibrante', 'Optimista',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function generateName(used = new Set()) {
  for (let i = 0; i < 200; i++) {
    const [animal, emoji] = pick(ANIMALS);
    const name = `${animal} ${pick(ADJECTIVES)}`;
    if (!used.has(name)) return { name, emoji };
  }
  const [animal, emoji] = pick(ANIMALS);
  return { name: `${animal} ${pick(ADJECTIVES)} ${used.size + 1}`, emoji };
}

module.exports = { generateName };
