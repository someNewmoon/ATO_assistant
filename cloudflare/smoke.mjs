import assert from 'node:assert/strict';

const origin = process.argv[2] || 'http://127.0.0.1:8798';
const url = origin + '/api/campaign-state.php';
let cookie = '';
async function request(query = '', payload, headers = {}) {
  const res = await fetch(url + query, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie') };
}
assert.match(await (await fetch(origin + '/api/cycle-theme.css')).text(), /--/);
assert.equal((await fetch(origin + '/api/health')).status, 200);
assert.equal((await request()).status, 401);
const username = 'smoke-' + crypto.randomUUID().slice(0, 12);
const password = crypto.randomUUID();
const register = await request('?action=register', { username, password });
assert.equal(register.status, 200, JSON.stringify(register.data));
assert.equal(register.data.user.id, username);
assert.match(register.cookie, /HttpOnly/);
cookie = register.cookie.split(';')[0];
assert.equal((await request('?action=me')).data.authenticated, true);
const dashboard = { activeProfileId: 'default', profiles: { default: { name: '验收战役', activeCycleId: 'c1', cycles: { c1: { state: { day: 7 } } } } } };
const record = { cycle: 'c1', titans: [{ id: 't1', type: '梦行者', notes: '测试' }], loadouts: { h1: { titanId: 't1', gear: { AJ0160: 1 } } } };
const heroes = { heroes: [{ id: 'h1', argonaut: 'odys', mnemos: { c1: ['c1_00'] } }] };
assert.equal((await request('?action=import-sections', { sections: { dashboard, heroes }, expectedAccountId: username })).status, 200);
const write = { section: 'record', state: record, userId: 'default', expectedRevision: 0, expectedAccountId: username };
const conflict = await Promise.all([request('', write), request('', write)]);
assert.deepEqual(conflict.map(item => item.status).sort(), [200, 409]);
const loaded = (await request()).data.campaign;
assert.deepEqual(loaded.sections.record.users.default, record);
assert.deepEqual(loaded.sections.heroes, heroes);
const imported = await request('?action=import-sections', { sections: { heroes: { heroes: [] }, story: { a: 1 } }, expectedRevisions: { heroes: 0 } });
assert.equal(imported.status, 409);
assert.equal((await request('?section=story')).data.state, null);
assert.equal((await request('', { ...write, expectedAccountId: 'other', expectedRevision: 1 })).data.code, 'ACCOUNT_MISMATCH');
assert.equal((await request('', { ...write, expectedRevision: 1 }, { Origin: 'https://invalid.example' })).status, 403);
assert.equal((await request('', { ...write, expectedRevision: 1, campaignNotes: {
  profileId: 'default', entries: [{ cycleId: 'c1', source: '军械库', text: '验收战役日志' }],
} })).status, 200);
assert.match((await request('?section=dashboard')).data.state.profiles.default.cycles.c1.state.notes, /验收战役日志/);
assert.equal((await request('?action=logout', {})).status, 200);
assert.equal((await request()).status, 401);
assert.equal((await request('?action=login', { username, password: 'incorrect-password' })).status, 401);
const login = await request('?action=login', { username, password });
assert.equal(login.status, 200);
cookie = login.cookie.split(';')[0];
assert.deepEqual((await request('?section=record')).data.state.users.default.loadouts, record.loadouts);
console.log('Passed: Pages routing, account/auth, durable record + heroes, atomic import, concurrent revisions, campaign logs, logout and login.');
