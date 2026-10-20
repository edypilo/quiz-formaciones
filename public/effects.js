// Efectos: sonidos sintetizados con Web Audio (sin archivos, funciona sin internet) y confeti.
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const Sound = (() => {
  let ctx = null;
  let enabled = true;
  try { enabled = localStorage.getItem('quiz-sound') !== 'off'; } catch {}

  function audio() {
    if (!enabled) return null;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch { return null; }
  }

  function tone(freq, start, dur, { type = 'triangle', gain = 0.18 } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + start;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Ruido filtrado: base del redoble y del barrido.
  function noise(start, dur, { gain = 0.2, freq = 1800, q = 0.8, sweepTo = null } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + start;
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    filter.Q.value = q;
    const g = a.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(a.destination);
    src.start(t);
  }

  return {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem('quiz-sound', enabled ? 'on' : 'off'); } catch {}
      if (!enabled && ctx) ctx.suspend();
      return enabled;
    },
    // Al revelar la respuesta.
    reveal() { tone(660, 0, 0.18); tone(990, 0.12, 0.35); },
    // Cambios en la clasificación.
    whoosh() { noise(0, 0.6, { gain: 0.25, freq: 400, sweepTo: 3000, q: 1.2 }); },
    // Un puesto del podio aparece.
    pop() { tone(392, 0, 0.12, { type: 'square', gain: 0.08 }); tone(784, 0.08, 0.3); },
    // Redoble de tambor que va creciendo.
    drumroll(seconds) {
      const hits = Math.floor(seconds / 0.045);
      for (let i = 0; i < hits; i++) {
        noise(i * 0.045, 0.06, { gain: 0.05 + 0.25 * (i / hits), freq: 1800, q: 0.6 });
      }
    },
    // Fanfarria del ganador.
    fanfare() {
      [523, 659, 784].forEach((f, i) => tone(f, i * 0.14, 0.2, { type: 'square', gain: 0.07 }));
      [523, 659, 784, 1047].forEach((f) => tone(f, 0.45, 1.4, { type: 'triangle', gain: 0.12 }));
      noise(0.45, 0.9, { gain: 0.3, freq: 5000, q: 0.5 }); // platillo
    },
  };
})();

// Lluvia de confeti en un lienzo sobre toda la página.
function confetti({ duration = 4000, count = 220, colors } = {}) {
  if (reducedMotion()) return;
  const palette = colors || ['#E21B3C', '#1368CE', '#D89E00', '#26890C', '#FFFFFF',
    getComputedStyle(document.documentElement).getPropertyValue('--secondary').trim() || '#00A8A8'];
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d');
  const resize = () => { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; };
  resize();
  const W = () => canvas.width;
  const parts = Array.from({ length: count }, () => ({
    x: W() * (0.2 + Math.random() * 0.6), y: canvas.height * 0.35,
    vx: (Math.random() - 0.5) * 18 * devicePixelRatio, vy: (-10 - Math.random() * 14) * devicePixelRatio,
    w: (6 + Math.random() * 8) * devicePixelRatio, h: (8 + Math.random() * 10) * devicePixelRatio,
    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    color: palette[Math.floor(Math.random() * palette.length)],
  }));
  const start = performance.now();
  (function frame(now) {
    const t = now - start;
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += 0.35 * devicePixelRatio;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      g.save();
      g.globalAlpha = Math.max(0, 1 - t / duration);
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.color;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)));
      g.restore();
    }
    if (t < duration) requestAnimationFrame(frame); else canvas.remove();
  })(start);
  setTimeout(() => canvas.remove(), duration + 500); // por si la ventana estaba oculta
}

// Cuenta animada de un número dentro de un elemento.
function countUp(el, from, to, ms = 1000) {
  if (reducedMotion() || from === to) { el.textContent = to; return; }
  const start = performance.now();
  (function frame(now) {
    const k = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - k) ** 3;
    el.textContent = Math.round(from + (to - from) * eased);
    if (k < 1) requestAnimationFrame(frame);
  })(start);
  // Seguro: si la ventana está oculta no se dibujan fotogramas, pero el total final debe quedar.
  setTimeout(() => { el.textContent = to; }, ms + 100);
}
