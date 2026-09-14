/** A WebSocket that reconnects with backoff. Returns a close function. */
export function openSocket(url, { onMessage, onOpen, onClose }) {
  let ws = null;
  let closed = false;
  let delay = 500;
  let timer = null;
  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => { delay = 500; onOpen?.(); };
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch { /* not JSON */ }
    };
    ws.onclose = () => {
      onClose?.();
      if (closed) return;
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 5000);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  };
  connect();
  return () => { closed = true; clearTimeout(timer); ws?.close(); };
}

export const wsBase = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
