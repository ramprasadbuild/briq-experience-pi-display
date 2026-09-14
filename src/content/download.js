// One file download into the store: resumable with HTTP Range, streamed to disk with sha256
// computed on the way (including the bytes already on disk from an earlier attempt), verified
// against the manifest before it is renamed into place.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { normalizeSha } from './store.js';

export class DownloadError extends Error {
  constructor(message, { retryable = true, status = null } = {}) {
    super(message);
    this.name = 'DownloadError';
    this.retryable = retryable;
    this.status = status;
  }
}

export class IntegrityError extends DownloadError {
  constructor(message) {
    super(message, { retryable: true });
    this.name = 'IntegrityError';
  }
}

async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/**
 * @param {object} o
 * @param {string} o.url
 * @param {string} o.partPath   staging file (kept on retryable failures so the next attempt resumes)
 * @param {string} o.finalPath  store file
 * @param {number|null} o.bytes expected size, if the manifest knows it
 * @param {string|null} o.sha256 expected hash, if the manifest knows it
 * @param {(n: number) => void} [o.onBytes] called with the count of newly written bytes
 */
export async function downloadFile({ url, partPath, finalPath, bytes = null, sha256 = null, fetch = globalThis.fetch, signal, onBytes = () => {} }) {
  const expectedSha = normalizeSha(sha256);
  const expectedBytes = bytes == null ? null : Number(bytes);
  let offset = await sizeOf(partPath);

  if (expectedBytes != null && offset > expectedBytes) {
    await rm(partPath, { force: true });
    offset = 0;
  }

  const hash = createHash('sha256');
  const headers = {};
  if (offset > 0 && !(expectedBytes != null && offset === expectedBytes)) headers.Range = `bytes=${offset}-`;

  let response = null;
  if (expectedBytes == null || offset < expectedBytes) {
    try {
      response = await fetch(url, { headers, signal, redirect: 'follow' });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new DownloadError(`network error for ${url}: ${err.message}`);
    }
    if (response.status === 416 && offset > 0) {
      // Server says our range starts past the end: the part is either complete or garbage.
      await response.body?.cancel().catch(() => {});
      response = null;
      if (expectedBytes != null && offset !== expectedBytes) {
        await rm(partPath, { force: true });
        throw new DownloadError(`range not satisfiable for ${url}; restarting`);
      }
    } else if (response.status === 200) {
      offset = 0; // server ignored Range: start over
    } else if (response.status === 206) {
      const cr = response.headers.get('content-range') ?? '';
      const m = cr.match(/bytes (\d+)-/);
      if (!m || Number(m[1]) !== offset) {
        await response.body?.cancel().catch(() => {});
        await rm(partPath, { force: true });
        throw new DownloadError(`unexpected Content-Range "${cr}" for ${url}`);
      }
    } else {
      await response.body?.cancel().catch(() => {});
      const retryable = response.status >= 500 || response.status === 408 || response.status === 429 || response.status === 404;
      throw new DownloadError(`HTTP ${response.status} for ${url}`, { retryable, status: response.status });
    }
  }

  // Hash whatever we're keeping from a previous attempt before appending to it.
  if (offset > 0) {
    await pipeline(createReadStream(partPath, { end: offset - 1 }), new Transform({
      transform(chunk, _enc, cb) { hash.update(chunk); cb(); },
    }));
  }

  if (response) {
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        onBytes(chunk.length);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(partPath, { flags: offset > 0 ? 'a' : 'w' }), { signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new DownloadError(`stream interrupted for ${url}: ${err.message}`);
    }
  }

  const size = await sizeOf(partPath);
  if (expectedBytes != null && size !== expectedBytes) {
    if (size > expectedBytes) await rm(partPath, { force: true });
    throw new IntegrityError(`size mismatch for ${url}: got ${size}, expected ${expectedBytes}`);
  }
  const actual = hash.digest('hex');
  if (expectedSha && actual !== expectedSha) {
    // Corrupt bytes can't be resumed from: throw the part away so the retry starts clean.
    await rm(partPath, { force: true });
    throw new IntegrityError(`sha256 mismatch for ${url}: got ${actual}, expected ${expectedSha}`);
  }
  await rename(partPath, finalPath);
  return { bytes: size, sha256: actual };
}
