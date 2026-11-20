'use strict';
// Cliente minimalista de solo lectura para Supabase Realtime Broadcast (Phoenix v1).
// No publica mensajes ni expone el JWT en URLs. Ante errores el presentador
// mantiene una consulta periódica como respaldo.
(() => {
  function createHostRealtime({ roomId, onChange, onStatus }) {
    const topic = 'realtime:quizzz:host:' + roomId;
    const wait = [1000, 2000, 5000, 10000];
    let ws = null;
    let heartbeat = null;
    let reconnect = null;
    let attempt = 0;
    let counter = 0;
    let joinRef = '';
    let connected = false;
    let stopped = false;
    let currentJwt = '';
    let settings = null;
    let refreshPending = false;

    const setStatus = (s) => {
      connected = s === 'live';
      onStatus?.(s);
    };
    const nextRef = () => String(++counter);
    const send = (event, payload, target = topic, jRef = joinRef) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({
        topic: target, event, payload, ref: nextRef(), join_ref: jRef,
      }));
      return true;
    };
    const clear = () => {
      if (heartbeat !== null) clearInterval(heartbeat);
      if (reconnect !== null) clearTimeout(reconnect);
      heartbeat = null;
      reconnect = null;
    };
    const queueReconnect = () => {
      if (stopped || reconnect !== null) return;
      const ms = wait[Math.min(attempt++, wait.length - 1)];
      reconnect = setTimeout(() => {
        reconnect = null;
        connect();
      }, ms);
    };
    const closeSocket = () => {
      if (!ws) return;
      const previous = ws;
      ws = null;
      previous.onopen = null;
      previous.onmessage = null;
      previous.onerror = null;
      previous.onclose = null;
      try { previous.close(); } catch {}
    };
    const receive = (event) => {
      if (typeof event.data !== 'string' || event.data.length > 20000) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || message.topic !== topic) return;
      if (message.event === 'phx_reply' && String(message.ref) === joinRef) {
        if (message.payload?.status === 'ok') {
          attempt = 0;
          setStatus('live');
          onChange();
        } else {
          setStatus('fallback');
          closeSocket();
          queueReconnect();
        }
      } else if (message.event === 'broadcast' &&
                 message.payload?.event === 'changed' &&
                 message.payload?.payload?.room_id === roomId) {
        onChange();
      } else if (message.event === 'phx_error' ||
                 message.event === 'phx_close') {
        setStatus('fallback');
        closeSocket();
        queueReconnect();
      }
    };
    const connect = () => {
      if (stopped || !currentJwt || !settings || ws) return;
      try {
        const url = new URL(settings.supabaseUrl);
        if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
          setStatus('fallback'); return;
        }
        const socketUrl = 'wss://' + url.host +
          '/realtime/v1/websocket?vsn=1.0.0&apikey=' +
          encodeURIComponent(settings.publishableKey);
        ws = new WebSocket(socketUrl);
        setStatus('connecting');
        const current = ws;
        current.onopen = () => {
          if (ws !== current) return;
          joinRef = nextRef();
          current.send(JSON.stringify({
            topic, event: 'phx_join', ref: joinRef, join_ref: joinRef,
            payload: {
              config: {
                private: true, broadcast: { ack: false, self: false },
                presence: { enabled: false }, postgres_changes: [],
              },
              access_token: currentJwt,
            },
          }));
          heartbeat = setInterval(() => send('heartbeat', {}, 'phoenix', null), 25000);
        };
        current.onmessage = receive;
        current.onerror = () => { if (ws === current) current.close(); };
        current.onclose = () => {
          if (ws !== current) return;
          ws = null;
          if (heartbeat !== null) clearInterval(heartbeat);
          heartbeat = null;
          setStatus('fallback');
          queueReconnect();
        };
      } catch {
        setStatus('fallback');
        closeSocket();
        queueReconnect();
      }
    };
    const initialize = async () => {
      try {
        const response = await fetch('/api/cloud/config', { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok || !/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(body.supabaseUrl) ||
            typeof body.publishableKey !== 'string' || !body.publishableKey) {
          throw new Error('invalid_config');
        }
        settings = body;
        connect();
      } catch { setStatus('fallback'); }
    };
    return {
      start: () => void initialize(),
      setToken: (jwt) => {
        if (stopped || typeof jwt !== 'string' || !jwt) return;
        const old = currentJwt;
        currentJwt = jwt;
        if (ws?.readyState === WebSocket.OPEN) {
          if (old !== jwt) send('access_token', { access_token: jwt });
        } else connect();
      },
      stop: () => {
        stopped = true;
        clear();
        closeSocket();
        setStatus('fallback');
      },
      isLive: () => connected,
    };
  }
  window.QuizzzHostRealtime = Object.freeze({ createHostRealtime });
})();