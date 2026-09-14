// Chrome DevTools Protocol, kept only for reload and recovery: Chromium stays pointed at the local
// TV app permanently (scripts/kiosk.sh), and the app switches screens itself from relay frames.
import CDP from 'chrome-remote-interface';

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export class Cdp {
  constructor({ port, host = '127.0.0.1', timeoutMs = 5000 }) {
    this.port = port;
    this.host = host;
    this.timeoutMs = timeoutMs;
  }

  async #withPage(fn) {
    const targets = await withTimeout(CDP.List({ port: this.port, host: this.host }), this.timeoutMs, 'CDP list');
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('no page target');
    const client = await withTimeout(CDP({ port: this.port, host: this.host, target: page }), this.timeoutMs, 'CDP connect');
    try {
      return await withTimeout(fn(client, page), this.timeoutMs, 'CDP call');
    } finally {
      await client.close().catch(() => {});
    }
  }

  async currentUrl() {
    const targets = await withTimeout(CDP.List({ port: this.port, host: this.host }), this.timeoutMs, 'CDP list');
    return targets.find((t) => t.type === 'page')?.url ?? null;
  }

  reload() {
    return this.#withPage((client) => client.Page.reload({ ignoreCache: true }));
  }

  navigate(url) {
    return this.#withPage(async (client) => {
      await client.Page.enable();
      await client.Page.navigate({ url });
    });
  }
}
