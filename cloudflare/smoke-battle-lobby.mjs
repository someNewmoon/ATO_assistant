import assert from 'node:assert/strict';
const origin = process.argv[2] || 'http://127.0.0.1:8798';
let cookie = '';
const created = [];
async function request(path, data, token, account = false) {
  const response = await fetch(origin + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(account && cookie ? { Cookie: cookie } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
}
const action = (room, type, extra = {}, token = room.keys.host) => request('/api/battle-room/' + room.room.id + '/action', { id: crypto.randomUUID(), type, ...extra }, token);
const list = async () => (await request('/api/battle-room/open')).data.rooms;
try {
  const registration = await request('/api/campaign-state.php?action=register', { username: 'lobby-' + crypto.randomUUID().slice(0, 12), password: crypto.randomUUID() });
  assert.equal(registration.status, 200); cookie = registration.cookie.split(';')[0];
  assert.equal((await request('/api/campaign-state.php?action=import-sections', { sections: { heroes: { heroes: [{ id: 'h', argonaut: 'odys' }] } } }, undefined, true)).status, 200);
  for (const publicLobby of [false, true]) {
    const result = await request('/api/battle-room/create', { heroIds: ['h'], publicLobby, title: '测试房间', board: { apostle: 'HEKATON', level: 1 } }, undefined, true);
    assert.equal(result.status, 201); created.push(result.data);
  }
  const [privateRoom, publicRoom] = created;
  let rooms = await list(); assert.ok(!rooms.some(room => room.id === privateRoom.room.id)); assert.ok(rooms.some(room => room.id === publicRoom.room.id));
  for (const key of Object.values(publicRoom.keys)) assert.ok(!JSON.stringify(rooms).includes(key));
  assert.equal((await request('/api/battle-room/' + privateRoom.room.id + '/lobby', { quick: true })).status, 403);
  const playerKey = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const joined = await request('/api/battle-room/' + publicRoom.room.id + '/join', { quick: true, seat: 0, player: '队友', playerKey });
  assert.equal(joined.status, 200); assert.equal(joined.data.actor.role, 'player');
  assert.equal((await list()).find(room => room.id === publicRoom.room.id).available, 0);
  assert.equal((await action(publicRoom, 'public-lobby', { value: false }, playerKey)).status, 403);
  assert.equal((await action(publicRoom, 'roll', { seat: 0, mode: 'power', counts: { red: 7, black: 0, white: 0 } }, playerKey)).status, 400);
  assert.equal((await action(publicRoom, 'public-lobby', { value: false })).status, 200);
  assert.ok(!(await list()).some(room => room.id === publicRoom.room.id));
  assert.equal((await request('/api/battle-room/' + publicRoom.room.id + '/lobby', { quick: true })).status, 403);
  assert.equal((await action(privateRoom, 'public-lobby', { value: true })).status, 200);
  assert.ok((await list()).some(room => room.id === privateRoom.room.id));
  assert.equal((await action(privateRoom, 'end')).status, 200);
  assert.ok(!(await list()).some(room => room.id === privateRoom.room.id));
  console.log('Passed: public-room discovery, private-room protection, capability secrecy, anonymous joining, slot updates, host-only publication, dice caps and closed-room removal.');
} finally {
  for (const room of created) await action(room, 'end').catch(() => {});
}
