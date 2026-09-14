// Facts the heartbeat reports about the box itself.
import { statfs } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';

/** Non-internal IPv4 addresses, wired first (eth*, en*), so tablets try the most reliable one first. */
export function lanAddresses(interfaces = networkInterfaces()) {
  const out = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const e of entries ?? []) {
      if (e.internal || (e.family !== 'IPv4' && e.family !== 4)) continue;
      if (e.address.startsWith('169.254.')) continue; // link-local: no DHCP, useless to a tablet
      out.push({ name, address: e.address });
    }
  }
  const rank = (n) => (/^(eth|en)/.test(n) ? 0 : /^(wlan|wl)/.test(n) ? 1 : 2);
  return out.sort((a, b) => rank(a.name) - rank(b.name)).map((e) => e.address);
}

export async function storage(path) {
  try {
    const s = await statfs(path);
    return { total_bytes: Number(s.blocks) * Number(s.bsize), free_bytes: Number(s.bavail) * Number(s.bsize) };
  } catch {
    return { total_bytes: null, free_bytes: null };
  }
}

export function isLoopbackAddress(address) {
  if (!address) return false;
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.');
}
