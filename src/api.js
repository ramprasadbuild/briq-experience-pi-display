// The two calls this daemon makes to the backend — same contract as the (not-yet-built)
// ExperienceDeviceController from the plan. See briq-experience-display's src/api.ts for the
// mobile-app version of this same pairing contract; this is the Node equivalent.
import { API_BASE_URL } from './config.js';

export async function register(existingDeviceId) {
  const response = await fetch(`${API_BASE_URL}/api/public/experience/devices/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: existingDeviceId }),
  });
  if (!response.ok) throw new Error(`register failed: HTTP ${response.status}`);
  const json = await response.json();
  return {
    deviceId: json.device_id,
    pairingCode: json.pairing_code,
    pairingCodeExpiresAt: json.pairing_code_expires_at,
  };
}

// Marks the device online for the controller's device list. Verified against the deployed
// preprod backend to answer a bare `{}` -- it carries no pairing code, so it can't be used to
// refresh an expiring one or to notice that an agent has claimed this device. Call register()
// again for that; it's idempotent for a known id (same id, same code back).
export async function heartbeat(deviceId) {
  const response = await fetch(`${API_BASE_URL}/api/public/experience/devices/${deviceId}/heartbeat`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error(`heartbeat failed: HTTP ${response.status}`);
}
