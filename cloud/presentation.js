'use strict';

// Presentación en la nube adaptada de la clasificación, el podio y los efectos
// de public/host.js y public/effects.js. Solo consume datos del anfitrión.
(() => {
  const byId = (id) => document.getElementById(id);
  const STEP = 74;
  const MAX_ROWS = 8;
  const medals = ['🥇', '🥈', '🥉'];
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const number = (value) => Number(value).toLocaleString('es-ES');
  const collator = new Intl.Collator('es', { sensitivity: 'base' });
  const normalizeScores = (input) => (Array.isArray(input) ? input : [])
    .filter((p) => typeof p?.nickname === 'string' && Number.isFinite(Number(p.score)))
    .map((p) => ({ nickname: p.nickname, score: Math.max(0, Number(p.score)), answered: Number(p.answered) || 0 }))
    .sort((a, b) => b.score - a.score || collator.compare(a.nickname, b.nickname));
  const emoji = (name) => window.QuizzzNames?.emojiForName?.(name) || '⭐';

  function createPresenter({ advance }) {
    const dialog = byId('game-presentation-dialog');
    const ranking = byId('game-presentation-ranking');
    const podium = byId('game-presentation-podium');
    const leaderboard = byId('game-ranking-board');
    const stage = byId('game-podium-stage');
    let timeouts = [];
    let sequence = 0;
    let last = null;
    let currentRoomId = '';

    function delay(ms, fn) {
      const id = window.setTimeout(fn, reduced() ? 0 : ms);
      timeouts.push(id);
    }
    function cancel() {
      sequence++;
      timeouts.forEach(window.clearTimeout);
      timeouts = [];
    }
    function close() {
      cancel();
      if (dialog.open) dialog.close();
    }
    byId('game-presentation-close').addEventListener('click', close);
    dialog.addEventListener('close', cancel);
    byId('game-presentation-replay').addEventListener('click', () => {
      if (last?.type === 'ranking') openRanking(last.roomId, last.scores, last.baseline, last.index, last.count);
      if (last?.type === 'podium') openPodium(last.roomId, last.scores);
    });
    byId('game-presentation-next').addEventListener('click', async () => {
      if (last?.type !== 'ranking') return;
      const button = byId('game-presentation-next');
      button.disabled = true;
      try {
        await advance(last.roomId);
      } finally {
        button.disabled = false;
      }
    });

    function open(type, roomId) {
      cancel();
      currentRoomId = roomId;
      ranking.hidden = type !== 'ranking';
      podium.hidden = type !== 'podium';
      byId('game-presentation-replay').textContent = type === 'podium'
        ? '↻ Repetir podio' : '↻ Repetir clasificación';
      byId('game-presentation-next').hidden = type === 'podium';
      if (!dialog.open) dialog.showModal();
    }

    function openRanking(roomId, rawScores, rawBaseline, index, count) {
      const scores = normalizeScores(rawScores);
      const baseline = normalizeScores(rawBaseline);
      last = { type: 'ranking', roomId, scores, baseline, index, count };
      open('ranking', roomId);
      byId('game-ranking-title').textContent = 'Clasificación · Pregunta ' + (index + 1);
      byId('game-ranking-subtitle').textContent = '¡Atentos a los cambios en la clasificación!';
      byId('game-presentation-next').textContent = index + 1 < count
        ? 'Siguiente pregunta ▶' : 'Ver podio final 🏆';
      const previous = new Map(baseline.map((p, i) => [p.nickname, { score: p.score, position: i + 1 }]));
      const visible = scores.slice(0, MAX_ROWS);
      leaderboard.replaceChildren();
      leaderboard.style.height = Math.max(1, visible.length) * STEP + 'px';
      byId('game-ranking-extra').textContent = scores.length > MAX_ROWS
        ? 'Y ' + (scores.length - MAX_ROWS) + ' participantes más.' : '';
      const rows = visible.map((player, i) => {
        const old = previous.get(player.nickname) || { score: 0, position: MAX_ROWS + 1 };
        const position = i + 1;
        const movement = old.position - position;
        const gain = player.score - old.score;
        const row = document.createElement('div');
        row.className = 'cloud-rrow';
        row.setAttribute('role', 'listitem');
        const rank = document.createElement('span');
        rank.className = 'cloud-rpos';
        rank.textContent = old.position <= MAX_ROWS ? old.position : '';
        const name = document.createElement('span');
        name.className = 'cloud-rname';
        name.textContent = emoji(player.nickname) + ' ' + player.nickname;
        const change = document.createElement('span');
        change.className = 'cloud-rmove';
        change.textContent = movement > 0 ? '▲' + movement : movement < 0 ? '▼' + Math.abs(movement) : '';
        change.dataset.direction = movement > 0 ? 'up' : movement < 0 ? 'down' : 'same';
        const extra = document.createElement('span');
        extra.className = 'cloud-rgain';
        extra.textContent = gain > 0 ? '+' + number(gain) : '';
        const points = document.createElement('span');
        points.className = 'cloud-rscore';
        points.textContent = number(old.score);
        row.append(rank, name, change, extra, points);
        const previousSlot = Math.min(MAX_ROWS, Math.max(0, old.position - 1));
        row.style.transform = 'translateY(' + (previousSlot * STEP) + 'px)';
        row.style.opacity = previousSlot >= MAX_ROWS ? '0' : '1';
        leaderboard.append(row);
        return { row, rank, points, from: old.score, to: player.score, position };
      });
      const epoch = sequence;
      delay(450, () => {
        if (epoch !== sequence) return;
        if (!reduced() && typeof Sound !== 'undefined') Sound.whoosh();
        rows.forEach(({ row, rank, points, from, to, position }, i) => {
          row.classList.add('moving');
          row.style.transitionDelay = reduced() ? '0ms' : (i * 70) + 'ms';
          row.style.transform = 'translateY(' + ((position - 1) * STEP) + 'px)';
          row.style.opacity = '1';
          rank.textContent = position;
          row.classList.add('done');
          if (typeof countUp === 'function') countUp(points, from, to, reduced() ? 0 : 1050);
          else points.textContent = number(to);
        });
      });
    }

    function openPodium(roomId, rawScores) {
      const scores = normalizeScores(rawScores);
      last = { type: 'podium', roomId, scores };
      open('podium', roomId);
      const title = byId('game-podium-title');
      title.textContent = scores.length ? 'Y el ganador es…' : '¡Partida terminada!';
      stage.replaceChildren();
      const entries = [1, 0, 2].filter((i) => scores[i]).map((i) => {
        const player = scores[i];
        const place = document.createElement('div');
        place.className = 'cloud-place cloud-place-' + (i + 1);
        place.dataset.place = String(i + 1);
        const avatar = document.createElement('div');
        avatar.className = 'cloud-avatar';
        const animal = document.createElement('span');
        animal.className = 'cloud-animal';
        animal.textContent = emoji(player.nickname);
        const medal = document.createElement('span');
        medal.className = 'cloud-medal';
        medal.textContent = medals[i];
        avatar.append(animal, medal);
        const name = document.createElement('div');
        name.className = 'cloud-pname';
        name.textContent = player.nickname;
        const points = document.createElement('div');
        points.className = 'cloud-pscore';
        points.textContent = number(player.score) + ' puntos';
        const pedestal = document.createElement('div');
        pedestal.className = 'cloud-pedestal';
        pedestal.textContent = String(i + 1);
        place.append(avatar, name, points, pedestal);
        stage.append(place);
        return { i, place };
      });
      byId('game-podium-rest').replaceChildren();
      const remainder = scores.slice(3);
      remainder.forEach((player, i) => {
        const item = document.createElement('li');
        item.textContent = (i + 4) + 'º · ' + emoji(player.nickname) + ' ' +
          player.nickname + ' · ' + number(player.score) + ' puntos';
        byId('game-podium-rest').append(item);
      });
      byId('game-podium-rest-heading').hidden = remainder.length === 0;
      const reveal = (index) => {
        const entry = entries.find(({ i }) => i === index);
        if (!entry) return;
        entry.place.classList.add('show');
        if (!reduced() && typeof Sound !== 'undefined') Sound.pop();
      };
      if (scores.length && !reduced() && typeof Sound !== 'undefined') Sound.drumroll(2.4);
      delay(2100, () => reveal(2));
      delay(3600, () => reveal(1));
      delay(5700, () => {
        reveal(0);
        if (scores[0]) title.textContent = '🏆 ¡Enhorabuena, ' + scores[0].nickname + '!';
        if (!reduced()) {
          if (typeof Sound !== 'undefined') Sound.fanfare();
          if (typeof confetti === 'function') confetti({ duration: 4800, count: 175,
            colors: ['#6989e6', '#efa6a4', '#f2bc38', '#ffffff'] });
        }
      });
      delay(6800, () => entries.forEach(({ place }) => place.classList.add('celebrate')));
      if (reduced()) {
        entries.forEach(({ place }) => place.classList.add('show'));
        if (scores[0]) title.textContent = '🏆 ¡Enhorabuena, ' + scores[0].nickname + '!';
      }
    }

    return {
      openRanking,
      openPodium,
      close,
      isOpen: () => dialog.open,
      roomId: () => currentRoomId,
    };
  }
  window.QuizzzPresentation = Object.freeze({ createPresenter, normalizeScores });
})();