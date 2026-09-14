#!/usr/bin/env bash
# Launches Chromium inside cage, permanently on the local TV app. Tunables in /etc/default/briq-kiosk:
#   KIOSK_URL             default http://127.0.0.1:8787/tv/
#   CHROMIUM_HWDEC_FLAGS  override the auto-detected hardware video decode flags
#   CHROMIUM_EXTRA_FLAGS  anything else
set -euo pipefail

KIOSK_URL="${KIOSK_URL:-http://127.0.0.1:${BRIQ_PORT:-8787}/tv/}"
PROFILE="${CHROMIUM_PROFILE:-$HOME/.config/briq-kiosk}"
CDP_PORT="${CDP_PORT:-9222}"

BIN=""
for b in chromium chromium-browser google-chrome-stable; do
  if command -v "$b" >/dev/null 2>&1; then BIN="$(command -v "$b")"; break; fi
done
[ -n "$BIN" ] || { echo "kiosk.sh: no chromium binary found" >&2; exit 1; }

# A power cut leaves "exit_type: Crashed" behind, which makes Chromium show a restore bubble.
mkdir -p "$PROFILE/Default"
if [ -f "$PROFILE/Default/Preferences" ]; then
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' "$PROFILE/Default/Preferences" || true
fi

# Hardware video decode. 4K films are HEVC (SHOWROOM-CONTRACT §3.3).
#  - Raspberry Pi 5: HEVC is decoded by the rpi-hevc-dec V4L2 stateless decoder. Raspberry Pi OS's
#    Chromium build carries the V4L2 path; the features below enable the GL/zero-copy route.
#    (The Pi 5 has no hardware H.264 decoder — H.264 4K will fall back to software and stutter.)
#  - x86 mini PCs (Intel/AMD): VA-API (install intel-media-va-driver-non-free or mesa-va-drivers).
if [ -z "${CHROMIUM_HWDEC_FLAGS:-}" ]; then
  MODEL="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || true)"
  case "$MODEL" in
    *"Raspberry Pi"*)
      CHROMIUM_HWDEC_FLAGS="--enable-features=AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL --use-gl=egl"
      ;;
    *)
      if [ -e /dev/dri/renderD128 ]; then
        CHROMIUM_HWDEC_FLAGS="--enable-features=AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL,VaapiVideoDecoder,VaapiIgnoreDriverChecks,PlatformHEVCDecoderSupport"
      else
        CHROMIUM_HWDEC_FLAGS=""
      fi
      ;;
  esac
fi

# shellcheck disable=SC2086
exec "$BIN" \
  --kiosk "$KIOSK_URL" \
  --user-data-dir="$PROFILE" \
  --ozone-platform=wayland \
  --noerrdialogs --disable-infobars --disable-session-crashed-bubble --no-first-run --no-default-browser-check \
  --password-store=basic --disable-translate --disable-features=Translate,MediaRouter,OverscrollHistoryNavigation,HardwareMediaKeyHandling \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port="$CDP_PORT" \
  --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy --enable-oop-rasterization \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  --disable-pinch --overscroll-history-navigation=0 --hide-scrollbars \
  --force-device-scale-factor=1 \
  $CHROMIUM_HWDEC_FLAGS \
  ${CHROMIUM_EXTRA_FLAGS:-}
