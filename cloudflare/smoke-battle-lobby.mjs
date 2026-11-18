import assert from 'node:assert/strict';

const origin = process.argv[2] || 'http://127.0.0.1:8798';
let cookie = '';
let squad;

async function request(path, data, token, account = false) {
  const response = await fetch(origin + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(account && cookie ? { Cookie: cookie } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
}

const action = (type, fields = {}, token = squad.keys.host) =>
  request('/api/battle-room/' + squad.room.id + '/action', { id: crypto.randomUUID(), type, ...fields }, token);
const entry = async () => (await request('/api/battle-room/open')).data.rooms.find(room => room.id === squad.room.id);
const newKey = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

try {
  const username = 'lobby-' + crypto.randomUUID().slice(0, 12);
  const registration = await request('/api/campaign-state.php?action=register', { username, password: crypto.randomUUID() });
  assert.equal(registration.status, 200);
  cookie = registration.cookie.split(';')[0];
  const sections = {
    dashboard: { activeProfileId: 'default', profiles: { default: { name: '测试存档' } } },
    heroes: { heroes: [{ id: 'h1', argonaut: 'odys', triskelion: { fate: 2 } }, { id: 'h2', argonaut: 'mnem' }] },
  };
  assert.equal((await request('/api/campaign-state.php?action=import-sections', { sections }, undefined, true)).status, 200);
  const payload = { squad: true, heroIds: ['h1', 'h2'], publicLobby: false, title: '测试小队' };
  assert.equal((await request('/api/battle-room/create', { ...payload, squad: false }, undefined, true)).status, 400);
  const created = await request('/api/battle-room/create', payload, undefined, true);
  assert.equal(created.status, 201);
  squad = created.data;

  assert.equal(await entry(), undefined);
  const room = '/api/battle-room/' + squad.room.id;
  assert.equal((await request(room + '/lobby', { quick: true })).status, 403);
  assert.equal((await request('/api/battle-room/home')).status, 401);
  const home = await request('/api/battle-room/home', undefined, undefined, true);
  assert.equal(home.data.squad.id, squad.room.id);
  assert.equal(home.data.squad.credentials.token, squad.keys.host);
  assert.equal((await request('/api/battle-room/create', payload, undefined, true)).status, 409);
  assert.equal((await action('public-lobby', { value: true })).status, 200);
  const listed = await entry();
  assert.equal(listed.hostName, username);
  assert.equal(listed.saveName, '测试存档');
  assert.equal(listed.available, 2);
  for (const key of Object.values(squad.keys)) assert.ok(!JSON.stringify(listed).includes(key));

  const first = newKey(), second = newKey();
  assert.equal((await request(room + '/join', { quick: true, seat: 0, player: '队友', playerKey: first })).status, 200);
  assert.equal((await entry()).available, 1);
  assert.equal((await request(room + '/join', { quick: true, seat: 0, player: '队友', playerKey: second, reclaim: true })).status, 409);
  assert.equal((await request(room + '/join', { seat: 0, player: '队友', playerKey: second, reclaim: true }, squad.keys.invite)).status, 200);
  assert.equal((await request(room + '/state', undefined, first)).status, 401);
  assert.equal((await action('squad-host-seat', { seat: 0, reclaim: true })).status, 200);
  assert.equal((await request(room + '/state', undefined, second)).status, 401);
  const rolled = await action('squad-roll', { seat: 0, sides: 10, count: 1, target: 6, skill: '', modifier: 0 });
  assert.equal(rolled.status, 200);
  const roll = rolled.data.room.squad.checks[0].id;
  const rerolled = await action('squad-reroll', { seat: 0, roll });
  assert.equal(rerolled.status, 200);
  assert.equal(rerolled.data.room.heroes[0].storyStats.fate, 3);
  assert.equal((await action('squad-reroll', { seat: 0, roll })).status, 409);
  assert.equal((await action('squad-disband', {}, squad.keys.viewer)).status, 403);
  assert.equal((await action('squad-disband')).status, 200);
  assert.equal(await entry(), undefined);
  assert.equal((await request('/api/battle-room/home', undefined, undefined, true)).data.squad, null);
  console.log('Passed squad discovery and labels, host recovery, protected seat takeover, Fate reroll, and disband.');
} finally {
  if (squad) await action('squad-disband').catch(() => {});
}
