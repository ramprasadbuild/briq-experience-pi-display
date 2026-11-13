// Classic-script entry for the tablet's file:// WebView (which cannot load ES modules): exposes the
// Master Plan scene as window.BriqMasterPlan. Built by scripts/build-masterplan-bundle.mjs.
import { AMBIENT } from './ambient.js';
import { createMasterPlan } from './scene.js';

window.BriqMasterPlan = { createMasterPlan, ambient: AMBIENT };
