import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultKiosk, mergeKiosk, priceRevealed, viewReducer, initialView } from '../tv/src/kioskState.js';

test('no unit price is revealed at the start of a session', () => {
  const k = defaultKiosk('p');
  assert.deepEqual(k.inventory.price_units, []);
  assert.equal(priceRevealed(k.inventory, 'A-1'), false);
});

test('only the revealed unit shows its price', () => {
  const k = mergeKiosk(defaultKiosk('p'), { inventory: { price_units: ['A-1', 102] } });
  assert.equal(priceRevealed(k.inventory, 'A-1'), true);
  assert.equal(priceRevealed(k.inventory, '102'), true);
  assert.equal(priceRevealed(k.inventory, 'A-2'), false);
});

test('a missing or malformed list hides the price', () => {
  assert.equal(priceRevealed(undefined, 'A-1'), false);
  assert.equal(priceRevealed({}, 'A-1'), false);
  assert.equal(priceRevealed({ price_units: 'A-1' }, 'A-1'), false);
  assert.equal(priceRevealed({ price_units: ['A-1'] }, null), false);
});

test('a new presentation clears revealed prices', () => {
  const shown = viewReducer(viewReducer(initialView, { type: 'frame', state: { cmd: 'present', slug: 'p' } }), {
    type: 'frame', state: { v: 2, slug: 'p', chapter: 'inventory', inventory: { price_units: ['A-1'] } },
  });
  assert.deepEqual(shown.kiosk.inventory.price_units, ['A-1']);
  const next = viewReducer(shown, { type: 'frame', state: { cmd: 'present', slug: 'p' } });
  assert.deepEqual(next.kiosk.inventory.price_units, []);
});
