#!/usr/bin/env bash
# Provision a TV box (Raspberry Pi 5 on Raspberry Pi OS Lite 64-bit, or a Debian-based mini PC).
#
#   sudo ./install.sh [--api https://…] [--mapbox-token pk.…] [--user briq] [--app-dir /opt/briq-display]
#                     [--prefill-from /media/usb/briq-display] [--skip-os]
#
# Idempotent: re-run it to update the app. It installs Node 22, cage and Chromium, copies this repo
# to the app dir, builds the TV app (public/tv), installs the systemd units, a sudoers rule for the
# two commands the daemon may run, disables console blanking, and starts everything.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/opt/briq-display
SVC_USER=briq
API=""
MAPBOX=""
PREFILL_FROM=""
SKIP_OS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --api) API="$2"; shift 2 ;;
    --mapbox-token) MAPBOX="$2"; shift 2 ;;
    --user) SVC_USER="$2"; shift 2 ;;
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --prefill-from) PREFILL_FROM="$2"; shift 2 ;;
    --skip-os) SKIP_OS=1; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" = 0 ] || { echo "run as root (sudo ./install.sh)" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }

if [ "$SKIP_OS" = 0 ]; then
  log "Packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl rsync cage seatd kbd fonts-dejavu-core
  if apt-cache show chromium >/dev/null 2>&1; then apt-get install -y --no-install-recommends chromium
  else apt-get install -y --no-install-recommends chromium-browser; fi
  # VA-API drivers help x86 boxes; harmless (or unavailable) on a Pi.
  apt-get install -y --no-install-recommends intel-media-va-driver-non-free mesa-va-drivers 2>/dev/null || true

  log "Node.js"
  NODE_OK=0
  if command -v node >/dev/null 2>&1; then
    node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>20||(a===20&&b>=19)?0:1)' && NODE_OK=1
  fi
  if [ "$NODE_OK" = 0 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
fi

log "Service user $SVC_USER"
if ! id "$SVC_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$SVC_USER" --shell /usr/sbin/nologin "$SVC_USER"
fi
for g in video render input audio seat; do getent group "$g" >/dev/null && usermod -aG "$g" "$SVC_USER"; done

log "App → $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude data --exclude 'data-*' --exclude public/tv --exclude .git "$SRC_DIR/" "$APP_DIR/"
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build
npm prune --omit=dev --no-audit --no-fund
chown -R root:root "$APP_DIR"
chmod +x "$APP_DIR/scripts/kiosk.sh"

log "Data dir /var/lib/briq-display"
install -d -o "$SVC_USER" -g "$SVC_USER" -m 0750 /var/lib/briq-display

log "Config"
if [ ! -f /etc/default/briq-display ]; then
  cat > /etc/default/briq-display <<CONF
# BriQ TV box daemon. See README.md.
API_BASE_URL=${API:-https://briq-crm-app-preprod-hiw6sglj2q-ue.a.run.app}
BRIQ_PORT=8787
MAPBOX_TOKEN=${MAPBOX}
CONF
else
  [ -n "$API" ] && sed -i "s|^API_BASE_URL=.*|API_BASE_URL=$API|" /etc/default/briq-display
  [ -n "$MAPBOX" ] && sed -i "s|^MAPBOX_TOKEN=.*|MAPBOX_TOKEN=$MAPBOX|" /etc/default/briq-display
fi
if [ ! -f /etc/default/briq-kiosk ]; then
  cat > /etc/default/briq-kiosk <<'CONF'
# BriQ kiosk browser. See scripts/kiosk.sh.
KIOSK_URL=http://127.0.0.1:8787/tv/
# CHROMIUM_HWDEC_FLAGS=
# CHROMIUM_EXTRA_FLAGS=
CONF
fi

log "sudoers (restart_browser, reboot)"
SYSTEMCTL="$(command -v systemctl)"
cat > /etc/sudoers.d/briq-display <<CONF
$SVC_USER ALL=(root) NOPASSWD: $SYSTEMCTL restart briq-kiosk.service, $SYSTEMCTL reboot
CONF
chmod 0440 /etc/sudoers.d/briq-display
visudo -cf /etc/sudoers.d/briq-display
# kiosk.js calls /usr/bin/systemctl; make sure that path exists on merged-/usr systems too.
[ -x /usr/bin/systemctl ] || ln -s "$SYSTEMCTL" /usr/bin/systemctl

log "systemd units"
for unit in briq-display-daemon.service briq-kiosk.service; do
  sed -e "s|@USER@|$SVC_USER|g" -e "s|@APP_DIR@|$APP_DIR|g" "$APP_DIR/systemd/$unit" > "/etc/systemd/system/$unit"
done
systemctl daemon-reload

if [ "$SKIP_OS" = 0 ]; then
  log "Display: no console blanking, no Wi-Fi power save"
  for f in /boot/firmware/cmdline.txt /boot/cmdline.txt; do
    if [ -f "$f" ] && ! grep -q 'consoleblank=0' "$f"; then sed -i '1 s/$/ consoleblank=0/' "$f"; break; fi
  done
  command -v raspi-config >/dev/null 2>&1 && raspi-config nonint do_blanking 1 || true
  if [ -d /etc/NetworkManager/conf.d ]; then
    printf '[connection]\nwifi.powersave = 2\n' > /etc/NetworkManager/conf.d/briq-wifi-powersave.conf
  fi
  command -v ufw >/dev/null 2>&1 && ufw status | grep -q active && ufw allow 8787/tcp || true
  systemctl set-default graphical.target
  systemctl enable --now seatd.service 2>/dev/null || true
fi

if [ -n "$PREFILL_FROM" ]; then
  log "Prefill from $PREFILL_FROM"
  sudo -u "$SVC_USER" env BRIQ_DATA_DIR=/var/lib/briq-display node "$APP_DIR/src/prefill.js" --from "$PREFILL_FROM" --verify
fi

log "Start"
systemctl enable briq-display-daemon.service briq-kiosk.service
systemctl restart briq-display-daemon.service
systemctl restart briq-kiosk.service
sleep 3
systemctl --no-pager --lines=0 status briq-display-daemon.service briq-kiosk.service || true
echo
echo "Done. Logs: journalctl -u briq-display-daemon -f   |   TV app: http://127.0.0.1:8787/tv/"
