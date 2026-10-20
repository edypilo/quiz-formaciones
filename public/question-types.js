// Registro de tipos de pregunta y validación común. Se usa en el servidor (require)
// y en el navegador (window.QuestionTypes). Para añadir un tipo nuevo: definirlo aquí
// con available: true y programar cómo se muestra y se puntúa.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuestionTypes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TYPES = [
    { id: 'quiz', label: 'Quiz', icon: '❓', available: true, scored: true, minOptions: 2, maxOptions: 4,
      description: 'De 2 a 4 respuestas; una o varias correctas.' },
    { id: 'truefalse', label: 'Verdadero o falso', icon: '⚖️', available: true, scored: true, minOptions: 2, maxOptions: 2,
      fixedOptions: ['Verdadero', 'Falso'], description: 'Una afirmación y dos respuestas.' },
    { id: 'poll', label: 'Encuesta', icon: '📊', available: true, scored: false, minOptions: 2, maxOptions: 4,
      description: 'Sin respuesta correcta ni puntos. Ideal para conocer al grupo.' },
    { id: 'typeanswer', label: 'Respuesta escrita', icon: '⌨️', available: false, description: 'Próximamente' },
    { id: 'puzzle', label: 'Ordenar', icon: '🧩', available: false, description: 'Próximamente' },
    { id: 'slider', label: 'Escala', icon: '🎚️', available: false, description: 'Próximamente' },
    { id: 'wordcloud', label: 'Nube de palabras', icon: '☁️', available: false, description: 'Próximamente' },
  ];

  const TIMES = [5, 10, 20, 30, 45, 60, 90, 120, 240];
  const POINTS = [{ value: 1, label: 'Estándar' }, { value: 2, label: 'Doble' }, { value: 0, label: 'Sin puntos' }];
  const LIMITS = { text: 250, option: 120, explanation: 400 };

  const getType = (id) => TYPES.find((t) => t.id === id);

  function youtubeId(url) {
    const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i.exec(String(url || ''));
    return m ? m[1] : null;
  }

  function normalizeMedia(media) {
    if (!media || !media.src) return null;
    const src = String(media.src).trim();
    if (media.type === 'youtube') return youtubeId(src) ? { type: 'youtube', src } : null;
    if (media.type === 'image' || media.type === 'video') return { type: media.type, src };
    return null;
  }

  // Devuelve la pregunta limpia y la lista de problemas (vacía si se puede jugar).
  function normalizeQuestion(input, defaultTime = 20) {
    const q = input || {};
    const errors = [];
    let type = getType(q.type) ? q.type : 'quiz';
    const def = getType(type);
    if (!def.available) errors.push(`El tipo «${def.label}» aún no está disponible`);

    const text = String(q.text || '').trim().slice(0, LIMITS.text);
    if (!text) errors.push('Falta el texto de la pregunta');

    let options = def.fixedOptions
      ? def.fixedOptions.slice()
      : (Array.isArray(q.options) ? q.options : []).map((o) => String(o ?? '').trim().slice(0, LIMITS.option));
    // Se conservan los huecos (como en Kahoot, la 3ª y 4ª respuesta pueden quedar vacías);
    // al jugar se eliminan con toPlayable().
    options = options.slice(0, def.maxOptions || 4);
    const filled = options.filter(Boolean).length;
    if (def.minOptions && filled < def.minOptions) errors.push(`Necesita al menos ${def.minOptions} respuestas`);

    let correct = [...new Set((Array.isArray(q.correct) ? q.correct : [q.correct]).map(Number))]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < options.length).sort((a, b) => a - b);
    if (!def.scored) correct = [];
    else if (type === 'truefalse') correct = correct.slice(0, 1);
    if (def.scored && !correct.length) errors.push('Marca la respuesta correcta');
    else if (correct.some((i) => !options[i])) errors.push('Una respuesta marcada como correcta está vacía');

    const time = Math.max(5, Math.min(240, Math.round(Number(q.time) || defaultTime)));
    const points = def.scored ? ([0, 1, 2].includes(Number(q.points)) ? Number(q.points) : 1) : 0;
    const explanation = String(q.explanation || '').trim().slice(0, LIMITS.explanation);
    const media = normalizeMedia(q.media);
    if (q.media && q.media.src && !media) errors.push('El enlace multimedia no es válido');

    return { question: { type, text, options, correct, time, points, explanation, media }, errors };
  }

  // Versión para jugar: sin respuestas vacías y con los índices de las correctas reajustados.
  function toPlayable(q) {
    const keep = q.options.map((o, i) => (o ? i : -1)).filter((i) => i >= 0);
    return { ...q, options: keep.map((i) => q.options[i]), correct: q.correct.map((i) => keep.indexOf(i)).filter((i) => i >= 0) };
  }

  return { TYPES, TIMES, POINTS, LIMITS, getType, youtubeId, normalizeQuestion, toPlayable };
});
