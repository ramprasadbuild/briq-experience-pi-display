// Classic-script entry for hosts that cannot load ES modules (the tablet's file:// WebView):
// exposes the scene as window.BriqScene. Built by scripts/build-scene-bundle.mjs.
import { createScene, STATUS_COLORS, SUN, towerLayout } from './scene.js';

window.BriqScene = { createScene, STATUS_COLORS, SUN, towerLayout };
