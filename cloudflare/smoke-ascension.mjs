import assert from 'node:assert/strict';
import inventory from '../technology/gear-inventory.js';
const origin = process.argv[2] || 'http://127.0.0.1:8807';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('仅用于本地测试。');
let cookie;
const username = 'ascend-' + crypto.randomUUID().slice(0, 12);
async function call(action, body) {
  const res = await fetch(origin + '/api/campaign-state.php' + (action ? '?action=' + action : ''), {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
  return { status: res.status, body: await res.json() };
}
assert.equal((await call('register', { username, password: crypto.randomUUID() })).status, 200);
const record = { arsenal: { AJ0160: { quantity: 2, manufactured: 2 } }, titans: [], loadouts: {} };
assert.equal((await call('import-sections', { sections: {
  dashboard: { activeProfileId: 'default', profiles: { default: { activeCycleId: 'c1' } } },
  heroes: { heroes: [{ id: 'h1', argonaut: 'odys' }] },
  record: { users: { default: record, other: { notes: 'preserve' } } },
  theatre: { hold: { c1: { core: { count: 3, notes: 'preserve' } } } },
} })).status, 200);
const payload = { operationId: crypto.randomUUID(), gearId: 'AJ0160', profileId: 'default', expectedAccountId: username };
if (!inventory.ascensionEnabled) {
  const before = (await call()).body.campaign;
  const locked = await call('ascend-gear', payload);
  assert.equal(locked.status, 403);
  assert.equal(locked.body.code, 'ASCENSION_DISABLED');
  assert.deepEqual((await call()).body.campaign, before);
  console.log('登升未开启，提交被拒绝，装备库存和升华核心余额保持原值。');
  process.exit(0);
}
// Discard the first successful result, exactly as if its response had been lost.
assert.equal((await call('ascend-gear', payload)).status, 200);
const replay = await call('ascend-gear', payload);
assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
let state = (await call()).body.campaign;
assert.equal(state.sections.theatre.hold.c1.core.count, 2);
assert.equal(state.sectionRevisions.record, 2); assert.equal(state.sectionRevisions.theatre, 2);
assert.equal(state.sections.record.users.default.arsenal['AJ0160@c2'].quantity, 1);
assert.equal(state.sections.record.users.other.notes, 'preserve');
assert.equal(state.sections.theatre.hold.c1.core.notes, 'preserve');
assert.equal((await call('ascend-gear', { ...payload, gearId: 'AJ0161' })).status, 409);
const simultaneous = { ...payload, operationId: crypto.randomUUID() };
const duplicates = await Promise.all(Array.from({ length: 5 }, () => call('ascend-gear', simultaneous)));
assert.ok(duplicates.every(r => r.status === 200));
state = (await call()).body.campaign;
assert.equal(state.sections.theatre.hold.c1.core.count, 1);
assert.equal(state.sectionRevisions.record, 3); assert.equal(state.sectionRevisions.theatre, 3);
assert.equal(state.sections.record.users.default.arsenal['AJ0160@c2'].quantity, 2);
const before = structuredClone(state);
assert.equal((await call('ascend-gear', { ...payload, operationId: crypto.randomUUID() })).status, 409);
assert.deepEqual((await call()).body.campaign, before);
assert.equal((await call('ascend-gear', { ...payload, operationId: crypto.randomUUID(), profileId: 'other' })).status, 409);
assert.equal((await call('ascend-gear', { ...payload, expectedAccountId: 'other' })).status, 409);
const reservedRecord = { ...record, loadouts: { h1: { gear: { AJ0160: 2 } } } };
assert.equal((await call('import-sections', { sections: { record: { users: { default: reservedRecord } } } })).status, 200);
const reservedBefore = (await call()).body.campaign;
assert.equal((await call('ascend-gear', { ...payload, operationId: crypto.randomUUID() })).status, 409);
assert.deepEqual((await call()).body.campaign, reservedBefore);
assert.equal((await call('import-sections', { sections: { theatre: { hold: { c1: { core: { count: 0 } } } } } })).status, 200);
const emptyBefore = (await call()).body.campaign;
assert.equal((await call('ascend-gear', { ...payload, operationId: crypto.randomUUID() })).status, 409);
assert.deepEqual((await call()).body.campaign, emptyBefore);
assert.equal((await call('ascend-gear', payload)).body.replayed, true);
assert.deepEqual((await call()).body.campaign, emptyBefore);
console.log('Passed atomic ascension, lost-response replay, concurrent duplicates, insufficient-stock rollback, profile/account and receipt identity isolation.');
