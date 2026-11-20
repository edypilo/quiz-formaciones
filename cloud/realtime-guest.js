'use strict';
// Invitados: canal público de AVISOS OPACOS; nunca contiene datos de juego.
// Los datos siguen leyéndose mediante RPC con el token secreto del jugador.
// El canal utiliza un tema SHA-256 derivado del secreto de invitación de sala.
// Fallos de WebSocket -> consultas periódicas, sin bloquear la partida.
(() => {
  const wait = [1000, 2000, 5000, 10000];
  function createGuestRealtime({ rpc, config, onChange, onStatus }) {
    let ws = null;
    let connected = false;
    let stopped = true;
    let topic = '';
    let socketRef = 0;
    let joinRef = '';
    let heartbeat = null;
    let reconnect = null;
    let attempt = 0;
    let playerToken = '';
    let generation = 0;
    const state = (value) => {
      connected = value === 'live';
      onStatus?.(value);
    };
    const clear = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (reconnect) clearTimeout(reconnect);
      heartbeat = null;
      reconnect = null;
    };
    const shut = () => {
      const old = ws;
      ws = null;
      if (!old) return;
      old.onopen = null;
      old.onmessage = null;
      old.onclose = null;
      old.onerror = null;
      try { old.close(); } catch {}
    };
    const schedule = () => {
      if (stopped || reconnect) return;
      reconnect = setTimeout(() => {
        reconnect = null;
        void connect();
      }, wait[Math.min(attempt++, wait.length - 1)]);
    };
    const send = (event, payload, target = topic, ref = joinRef) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        topic: target, event, payload, ref: String(++socketRef), join_ref: ref,
      }));
    };
    async function connect() {
      if (stopped || ws || !playerToken) return;
      const ticket = ++generation;
      try {
        const result = await rpc('quiz_guest_stream', { p_token: playerToken });
        if (ticket !== generation || stopped) return;
        if (!result?.ok || !/^quizzz:guest:[a-f0-9]{64}$/.test(result.topic)) {
          state('fallback');
          schedule();
          return;
        }
        topic = 'realtime:' + result.topic;
        const origin = new URL(config.supabaseUrl);
        if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.supabase.co'))
          throw new Error('invalid_origin');
        const url = 'wss://' + origin.host +
          '/realtime/v1/websocket?vsn=1.0.0&apikey=' +
          encodeURIComponent(config.publishableKey);
        const socket = new WebSocket(url);
        ws = socket;
        state('connecting');
        socket.onopen = () => {
          if (ws !== socket || stopped) return;
          joinRef = String(++socketRef);
          socket.send(JSON.stringify({
            topic, event: 'phx_join', ref: joinRef, join_ref: joinRef,
            payload: {
              config: {
                private: false,
                broadcast: { ack: false, self: false },
                presence: { enabled: false },
                postgres_changes: [],
              },
            },
          }));
          heartbeat = setInterval(() => send('heartbeat', {}, 'phoenix', null), 25000);
        };
        socket.onmessage = (event) => {
          if (ws !== socket || typeof event.data !== 'string' ||
              event.data.length > 10000) return;
          let msg;
          try { msg = JSON.parse(event.data); } catch { return; }
          if (msg?.topic !== topic) return;
          if (msg.event === 'phx_reply' && String(msg.ref) === joinRef) {
            if (msg.payload?.status === 'ok') {
              attempt = 0;
              state('live');
              onChange();
            } else {
              state('fallback');
              shut();
              schedule();
            }
          } else if (msg.event === 'broadcast' &&
              msg.payload?.event === 'changed' &&
              ['phase', 'participant'].includes(msg.payload?.payload?.kind)) {
            onChange();
          } else if (msg.event === 'phx_error' || msg.event === 'phx_close') {
            state('fallback');
            shut();
            schedule();
          }
        };
        socket.onerror = () => { if (ws === socket) socket.close(); };
        socket.onclose = () => {
          if (ws !== socket) return;
          ws = null;
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = null;
          state('fallback');
          schedule();
        };
      } catch {
        if (ticket !== generation || stopped) return;
        state('fallback');
        shut();
        schedule();
      }
    }
    return {
      start: (token) => {
        if (typeof token !== 'string' || !token) return;
        if (!stopped && playerToken === token) return;
        generation++;
        clear();
        shut();
        playerToken = token;
        topic = '';
        attempt = 0;
        stopped = false;
        state('connecting');
        void connect();
      },
      stop: () => {
        stopped = true;
        generation++;
        playerToken = '';
        topic = '';
        clear();
        shut();
        state('off');
      },
      isLive: () => connected,
    };
  }
  window.QuizzzGuestRealtime = Object.freeze({ createGuestRealtime });
})();