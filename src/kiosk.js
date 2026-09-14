// Controls for the kiosk browser and the box, used by heartbeat commands and the watchdog.
// systemctl calls go through `sudo -n`; install.sh grants the service user exactly these commands.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export class KioskControl {
  constructor({ cdp, unit = 'briq-kiosk.service', exec = run, log = console }) {
    this.cdp = cdp;
    this.unit = unit;
    this.exec = exec;
    this.log = log;
  }

  async #systemctl(...args) {
    await this.exec('sudo', ['-n', '/usr/bin/systemctl', ...args], { timeout: 20_000 });
  }

  /** `restart_browser`: a CDP reload unless args.hard; falls back to restarting the kiosk unit. */
  async restartBrowser({ hard = false } = {}) {
    if (!hard) {
      try {
        await this.cdp.reload();
        return { method: 'cdp_reload' };
      } catch (err) {
        this.log.warn?.(`[kiosk] CDP reload failed (${err.message}); restarting ${this.unit}`);
      }
    }
    await this.#systemctl('restart', this.unit);
    return { method: 'systemctl_restart' };
  }

  async reboot() {
    await this.#systemctl('reboot');
  }

  /** Watchdog: make sure the kiosk tab is on the local TV app; reload if it is but went quiet. */
  async recover(localUrl) {
    const url = await this.cdp.currentUrl();
    if (!url || !url.startsWith(localUrl)) {
      await this.cdp.navigate(localUrl);
      return { action: 'navigate', from: url };
    }
    await this.cdp.reload();
    return { action: 'reload' };
  }
}
