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
function socketAction(token, action) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/battle-room/${squad.room.id}/socket`, origin);
    url.protocol = 'ws:';
    const socket = new WebSocket(url, ['ato-battle-v1', token]);
    const timer = setTimeout(() => { socket.close(); reject(new Error('WebSocket confirmation timed out.')); }, 5000);
    socket.onmessage = event => {
      const packet = JSON.parse(event.data);
      if (packet.socketActions) {
        assert.equal(packet.socketHeartbeat, true);
        socket.send('{"type":"ping"}');
      } else if (packet.type === 'pong') {
        socket.send(JSON.stringify({ type: 'action', action }));
      } else if (packet.type === 'action-result') {
        clearTimeout(timer);
        socket.close();
        resolve(packet);
      }
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket connection failed.')); };
  });
}
try {
  assert.equal((await request('/api/campaign-state.php?action=register', {
    username: 'rules-' + crypto.randomUUID().slice(0, 12), password: crypto.randomUUID(),
  })).status, 200);
  assert.equal((await request('/api/campaign-state.php?action=import-sections', { sections: {
    dashboard: { activeProfileId: 'default', profiles: { default: { name: '规则验收', activeCycleId: 'c1' } } },
    heroes: { heroes: [{ id: 'h1', argonaut: 'odys' }] },
    record: { titans: [{ id: 't1', typeId: 'dreamwalker', type: '梦行者' }], loadouts: { h1: { titanId: 't1', gear: {} } } },
  } })).status, 200);
  const library = '/api/campaign-state.php?action=trauma-library';
  const firstLibrary = await request(library);
  assert.equal(firstLibrary.status, 200);
  const saveFields = { profile: 'default', cycle: 'c1', revision: firstLibrary.body.revision };
  const savedLibrary = await request(library, { ...saveFields, card: 'light_bleeding', enabled: false });
  assert.equal(savedLibrary.status, 200);
  assert.equal(savedLibrary.body.catalog.find(card => card.id === 'light_bleeding').enabled, false);
  assert.equal((await request(library, { ...saveFields, card: 'light_feint', enabled: false })).status, 409);
  assert.equal((await request(library, { ...saveFields, revision: savedLibrary.body.revision, card: 'AM0357', enabled: true })).status, 400);
  const backup = await request('/api/campaign-state.php');
  assert.deepEqual(backup.body.campaign.sections.trauma.users.default.cycles.c1.excluded, ['light_bleeding']);
  const created = await request('/api/battle-room/create', { squad: true, heroIds: ['h1'] });
  assert.equal(created.status, 201); squad = created.body;
  assert.equal((await action('squad-phase', { phase: 'prep' })).status, 200);
  const battle = await action('squad-start', { battleNumber: 0, board: { apostle: 'HEKATON', level: 1 } });
  assert.equal(battle.status, 200);
  assert.equal(battle.body.room.trauma.catalog.find(card => card.id === 'light_bleeding').inPlay, false);
  const socketMove = { id: crypto.randomUUID(), type: 'pool', key: 'hope', delta: 1, battleNumber: 1 };
  const socketFirst = await socketAction(squad.keys.host, socketMove);
  const socketRetry = await socketAction(squad.keys.host, socketMove);
  const httpRetry = await action('pool', socketMove);
  assert.equal(socketFirst.status, 200);
  assert.equal(socketFirst.data.room.pool.hope, 1);
  assert.equal(socketRetry.data.room.revision, socketFirst.data.room.revision);
  assert.equal(httpRetry.body.room.revision, socketFirst.data.room.revision);
  assert.deepEqual(socketFirst.data.actor, { role: 'host' });
  assert.equal((await socketAction(squad.keys.viewer, { ...socketMove, id: crypto.randomUUID() })).status, 403);
  assert.equal((await action('pool', { key: 'opening', delta: 1 }, squad.keys.viewer)).status, 403);
  assert.equal((await action('pool', { key: 'opening', delta: 1, expectedRound: 0 })).status, 409);
  const zero = await action('trauma-draw', { seat: 0, mode: 'draw', deck: 'auto' });
  assert.equal(zero.status, 200); assert.equal(zero.body.room.trauma.drawn.length, 0);
  const draw = await action('trauma-draw', { seat: 0, mode: 'hit', amount: 14, deck: 'auto' });
  assert.equal(draw.status, 200); assert.equal(draw.body.room.heroes[0].stats.danger, 9);
  assert.equal(draw.body.room.trauma.latest.card.deck, 'obol');
  assert.equal(draw.body.room.trauma.counts.obol + draw.body.room.trauma.drawn.length, 3);
  const temporary = await action('trauma-deck', { card: 'light_bleeding', operation: 'add' });
  assert.equal(temporary.status, 200);
  assert.equal(temporary.body.room.trauma.catalog.find(card => card.id === 'light_bleeding').inPlay, true);
  const id = crypto.randomUUID();
  const first = await action('pool', { id, key: 'opening', delta: 1 });
  const retry = await action('pool', { id, key: 'opening', delta: 1 });
  assert.equal(retry.body.room.revision, first.body.room.revision);
  assert.equal(retry.body.room.pool.opening, 1);
  assert.equal((await action('end')).status, 200);
  assert.equal((await action('stat', { seat: 0, key: 'rage', delta: 1 })).status, 409);
  assert.equal((await action('squad-phase', { phase: 'prep' })).status, 200);
  const next = await action('squad-start', { board: { apostle: 'LABYRINTHAUROS', level: 1 } });
  assert.equal(next.status, 200); assert.equal(next.body.room.squad.battleNumber, 2);
  assert.equal(next.body.room.heroes[0].stats.danger, 0); assert.equal(next.body.room.trauma.drawn.length, 0);
  assert.equal(next.body.room.pool.opening, 0);
  assert.equal(next.body.room.trauma.counts.obol, 2);
  assert.equal(next.body.room.trauma.catalog.find(card => card.id === 'light_bleeding').inPlay, false);
  assert.equal((await request(library)).body.revision, savedLibrary.body.revision);
  assert.equal((await action('squad-disband')).status, 200);
  const rebuilt = await request('/api/battle-room/create', { squad: true, heroIds: ['h1'] });
  assert.equal(rebuilt.status, 201);
  squad = rebuilt.body;
  assert.equal(squad.room.trauma.catalog.find(card => card.id === 'light_bleeding').inPlay, false);
  assert.equal((await action('pool', { key: 'opening', delta: 1 })).status, 409);
  console.log('Passed battle lifecycle, permissions, idempotency, saved opening trauma decks, and reset of drawn cards and temporary additions across bosses.');
} finally {
  if (squad) await action('squad-disband').catch(() => {});
}
