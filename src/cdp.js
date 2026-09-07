// Drives the already-running kiosk browser via the Chrome DevTools Protocol instead of
// restarting it — no flicker, no re-negotiating the GPU/video decode pipeline on every
// navigation. Requires the browser to have been launched with --remote-debugging-port
// matching CDP_PORT (see systemd/briq-kiosk.service).
import CDP from 'chrome-remote-interface';
import { CDP_PORT } from './config.js';

let clientPromise = null;

// Reuses one CDP connection to the browser's first tab across calls; reconnects lazily if the
// browser was restarted (e.g. after a crash the systemd unit recovered from).
async function getClient() {
  if (clientPromise) {
    try {
      const client = await clientPromise;
      // A dead connection throws on any protocol call; cheap way to check liveness.
      await client.Runtime.evaluate({ expression: '1' });
      return client;
    } catch {
      clientPromise = null;
    }
  }
  clientPromise = CDP({ port: CDP_PORT }).then(async (client) => {
    await client.Page.enable();
    return client;
  });
  return clientPromise;
}

export async function navigate(url) {
  const client = await getClient();
  await client.Page.navigate({ url });
  console.log(`[cdp] navigated to ${url}`);
}
