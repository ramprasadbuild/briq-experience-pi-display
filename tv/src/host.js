// Host bridge: the transport used when this TV app runs inside the Android TV app's WebView
// (briq-experience-display) instead of Chromium on a Linux box. There is no Node daemon there, so
// instead of the loopback sockets (`/relay?role=viewer`, `/local/events`) and `/local/projects/*`,
// the native host delivers every message by calling `window.__briqHost.receive(message)`:
//
//   {t:'state', state}                          relay frame (§6.2 command or §6.3 kiosk state)
//   {t:'status', status}                        device status, same shape as /local/status.json
//   {t:'identify', name, device_id, seconds}    identify overlay
//   {t:'content', …}                            content switched: re-request the open project
//   {t:'reload'}                                reload the page
//   {t:'project', slug, state:'ready', manifest} | {…, state:'missing'} | {…, state:'error', error}
//
// and the page talks back with `window.ReactNativeWebView.postMessage(JSON)`:
//
//   {t:'ready'}              subscribed; the host replies with status + the last command/state
//   {t:'project', slug}      asks for a project's local manifest
//
// Without `window.ReactNativeWebView` (the Linux box) nothing here is used.

const listeners = new Set();

export const hostBridge = typeof window !== 'undefined' && !!window.ReactNativeWebView;

export function onHost(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function toHost(message) {
  try {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  } catch {
    // not inside the host
  }
}

if (hostBridge) {
  window.__briqHost = {
    receive(message) {
      let m = message;
      if (typeof m === 'string') {
        try { m = JSON.parse(m); } catch { return; }
      }
      if (!m || typeof m !== 'object') return;
      for (const fn of [...listeners]) {
        try { fn(m); } catch (err) { console.error('[host]', err); }
      }
    },
  };
}
