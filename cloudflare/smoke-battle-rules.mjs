import assert from 'node:assert/strict';
const origin = process.argv[2] || 'http://127.0.0.1:8807';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('此测试仅用于本地 Worker。');
let cookie, squad;
async function request(path, body, token) {
  const res = await fetch(origin + path, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }),
      ...(token && { Authorization: 'Bearer ' + token }) }, ...(body && { body: JSON.stringify(body) }) });
  if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
  return { status: res.status, body: await res.json() };
}
const action = (type, fields = {}, token = squad.keys.host) => request(`/api/battle-room/${squad.room.id}/action`,
  { id: crypto.randomUUID(), type, battleNumber: 1, ...fields }, token);
try {
  assert.equal((await request('/api/campaign-state.php?action=register', {
    username: 'rules-' + crypto.randomUUID().slice(0, 12), password: crypto.randomUUID(),
  })).status, 200);
  assert.equal((await request('/api/campaign-state.php?action=import-sections', { sections: {
    dashboard: { activeProfileId: 'default', profiles: { default: { name: '规则验收', activeCycleId: 'c1' } } },
    heroes: { heroes: [{ id: 'h1', argonaut: 'odys' }] },
    record: { titans: [{ id: 't1', typeId: 'dreamwalker', type: '梦行者' }], loadouts: { h1: { titanId: 't1', gear: {} } } },
  } })).status, 200);
  const created = await request('/api/battle-room/create', { squad: true, heroIds: ['h1'] });
  assert.equal(created.status, 201); squad = created.body;
  assert.equal((await action('squad-phase', { phase: 'prep' })).status, 200);
  assert.equal((await action('squad-start', { battleNumber: 0, board: { apostle: 'HEKATON', level: 1 } })).status, 200);
  assert.equal((await action('pool', { key: 'opening', delta: 1 }, squad.keys.viewer)).status, 403);
  const zero = await action('trauma-draw', { seat: 0, mode: 'draw', deck: 'auto' });
  assert.equal(zero.status, 200); assert.equal(zero.body.room.trauma.drawn.length, 0);
  const draw = await action('trauma-draw', { seat: 0, mode: 'hit', amount: 14, deck: 'auto' });
  assert.equal(draw.status, 200); assert.equal(draw.body.room.heroes[0].stats.danger, 9);
  assert.equal(draw.body.room.trauma.latest.card.deck, 'obol');
  assert.equal(draw.body.room.trauma.counts.obol + draw.body.room.trauma.drawn.length, 3);
  const id = crypto.randomUUID();
  const first = await action('pool', { id, key: 'opening', delta: 1 });
  const retry = await action('pool', { id, key: 'opening', delta: 1 });
  assert.equal(retry.body.room.revision, first.body.room.revision);
  assert.equal(retry.body.room.pool.opening, 1);
  assert.equal((await action('end')).status, 200);
  assert.equal((await action('stat', { seat: 0, key: 'rage', delta: 1 })).status, 409);
  assert.equal((await action('squad-phase', { phase: 'prep' })).status, 200);
  const next = await action('squad-start', { board: { apostle: 'HEKATON', level: 1 } });
  assert.equal(next.status, 200); assert.equal(next.body.room.squad.battleNumber, 2);
  assert.equal(next.body.room.heroes[0].stats.danger, 0); assert.equal(next.body.room.trauma.drawn.length, 0);
  assert.equal(next.body.room.pool.opening, 0);
  assert.equal((await action('pool', { key: 'opening', delta: 1 })).status, 409);
  console.log('Passed local HTTP battle lifecycle, zero-danger draw, overflow, viewer permissions, idempotency and stale-battle rejection.');
} finally {
  if (squad) await action('squad-disband').catch(() => {});
}
