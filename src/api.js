// Backend calls the box makes (SHOWROOM-CONTRACT §1.3, §2.2, §5). Every call except register sends
// `Authorization: Device <id>:<secret>` once a secret exists. Against today's preprod (legacy
// register without a secret, heartbeat answering `{}`, manifest 404) each call degrades cleanly:
// no auth header, `{}` treated as "nothing new", 404 surfaced as ManifestUnavailableError.

export class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

export class ManifestUnavailableError extends HttpError {
  constructor(status, body) {
    super(`manifest endpoint unavailable (HTTP ${status})`, status, body);
    this.name = 'ManifestUnavailableError';
  }
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class ApiClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl
   * @param {import('./identity.js').IdentityStore} opts.identity
   * @param {typeof fetch} [opts.fetch]
   * @param {number} [opts.timeoutMs]
   */
  constructor({ baseUrl, identity, fetch: fetchImpl = globalThis.fetch, timeoutMs = 20_000 }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.identity = identity;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async #request(method, path, { body, auth = true, timeoutMs = this.timeoutMs } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const authHeader = auth ? this.identity.authHeader() : null;
    if (authHeader) headers.Authorization = authHeader;
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const parsed = await readBody(response);
    return { status: response.status, ok: response.ok, body: parsed };
  }

  /** §1.3. Sends whatever identity we hold (both optional); stores what comes back. */
  async register() {
    const { device_id, device_secret } = this.identity.get();
    const payload = {};
    if (device_id != null) payload.device_id = device_id;
    if (device_secret) payload.device_secret = device_secret;
    const res = await this.#request('POST', '/api/public/experience/devices/register', { body: payload, auth: false });
    if (!res.ok || !res.body || typeof res.body !== 'object') {
      throw new HttpError(`register failed: HTTP ${res.status}`, res.status, res.body);
    }
    const json = res.body;
    const patch = {
      device_id: json.device_id ?? device_id,
      pairing_code: json.pairing_code ?? null,
      pairing_code_expires_at: json.pairing_code_expires_at ?? null,
    };
    if (typeof json.claimed === 'boolean') patch.claimed = json.claimed;
    if (json.device_id != null && device_id != null && String(json.device_id) !== String(device_id)) {
      // The backend treated us as a new device (wrong/missing secret): everything we knew is stale.
      console.warn(`[api] register issued a new device id ${json.device_id} (was ${device_id})`);
      Object.assign(patch, { device_secret: null, relay_key: null, name: null, claimed: json.claimed ?? false });
    }
    if (json.device_secret) patch.device_secret = json.device_secret;
    await this.identity.update(patch);
    return json;
  }

  /** §2.2. Returns the parsed response; `{}` from a legacy backend comes back as `{}`. */
  async heartbeat(report) {
    const id = this.identity.get().device_id;
    const res = await this.#request('POST', `/api/public/experience/devices/${encodeURIComponent(id)}/heartbeat`, { body: report });
    if (!res.ok) throw new HttpError(`heartbeat failed: HTTP ${res.status}`, res.status, res.body);
    return res.body && typeof res.body === 'object' ? res.body : {};
  }

  async ackCommand(commandId, { ok, result = {} }) {
    const id = this.identity.get().device_id;
    const res = await this.#request(
      'POST',
      `/api/public/experience/devices/${encodeURIComponent(id)}/commands/${encodeURIComponent(commandId)}/ack`,
      { body: { ok, result } },
    );
    if (!res.ok) throw new HttpError(`ack ${commandId} failed: HTTP ${res.status}`, res.status, res.body);
  }

  /** §5. `GET /api/experience/manifest?device_class=tv[&slug=]` with Device auth. */
  async manifest({ slug } = {}) {
    const qs = new URLSearchParams({ device_class: 'tv' });
    if (slug) qs.set('slug', slug);
    const res = await this.#request('GET', `/api/experience/manifest?${qs}`, { timeoutMs: 60_000 });
    if (res.status === 404 || res.status === 405 || res.status === 501) throw new ManifestUnavailableError(res.status, res.body);
    // Today's preprod answers 401 "Authentication required" to a box that has no secret to send
    // (legacy register issues none): that is "not available to us yet", not a sync failure.
    if ((res.status === 401 || res.status === 403) && !this.identity.authHeader()) throw new ManifestUnavailableError(res.status, res.body);
    if (!res.ok) throw new HttpError(`manifest failed: HTTP ${res.status}`, res.status, res.body);
    if (!res.body || typeof res.body !== 'object' || !Array.isArray(res.body.projects)) {
      throw new HttpError('manifest response has no projects[]', res.status, res.body);
    }
    return res.body;
  }
}
