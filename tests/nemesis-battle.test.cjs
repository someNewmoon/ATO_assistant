const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const dashboard = read('index.html');
const map = read('map/app.js');
const mapRules = { window: {}, URLSearchParams };
vm.runInNewContext(read('map/nemesis-path.js'), mapRules);
vm.runInNewContext(read('map/nemesis-battle.js'), mapRules);
const nemesis = mapRules.window.ATO_NEMESIS_BATTLE;

const clone = value => JSON.parse(JSON.stringify(value));
const noop = () => {};
function fn(source, name) {
  const match = source.match(new RegExp('^( *)(?:async )?function ' + name + '\\([^]*?^\\1}', 'm'));
  assert.ok(match, name);
  return match[0];
}
function harness(values = {}) {
  const ctx = vm.createContext({ URLSearchParams, window: {}, console, ...values });
  vm.runInContext(read('map/nemesis-battle.js'), ctx);
  return ctx;
}
function params(href) {
  const query = new URL(href, 'http://localhost/').searchParams;
  return Object.fromEntries(query);
}
function response(state, status = 200, accountId = 'owner') {
  return { ok: status === 200, status, json: async () => ({
    ok: status === 200, exists: Boolean(state), state, user: { id: accountId }, revision: 3,
  }) };
}
function target(ctx, cycle, record) {
  ctx.cycle = cycle;
  ctx.record = record;
  return clone(vm.runInContext('window.ATO_NEMESIS_BATTLE.targetFor(cycle, record)', ctx));
}

test('every permitted nemesis resolves to its battle, with defaults and invalid selections handled consistently', () => {
  const expected = {
    c1: { pursuer: 'c1' }, c2: { adversary: 'c2', pursuer: 'c1', dahaka: 'c4' },
    c3: { adversary: 'c2', dahaka: 'c4' }, c4: { dahaka: 'c4' }, c5: { titanX: 'c5' },
  };
  const ctx = harness();
  const stories = { window: {} };
  vm.runInNewContext(read('story/storybook-placeholder.js'), stories);
  for (const [cycle, options] of Object.entries(expected)) {
    assert.equal(target(ctx, cycle, {}).book, Object.values(options)[0]);
    assert.deepEqual(target(ctx, cycle, { nemesisSelections: { [cycle]: 'bad' } }), target(ctx, cycle, {}));
    for (const [nemesis, bookId] of Object.entries(options)) {
      const battle = target(ctx, cycle, { nemesisSelections: { [cycle]: nemesis } });
      assert.equal(battle.book, bookId, `${cycle}/${nemesis}`);
      const book = stories.window.STORYBOOK_DATA.books.find(b => b.id === bookId);
      assert.ok(book.entries.some(e => e.id === battle.entry && e.encounterKey === battle.encounter
        && e.chapterKey === battle.chapter), `${cycle}/${nemesis} has a real story entry`);
    }
  }
  assert.equal(target(ctx, 'invalid', {}), null);
});

test('dashboard, map and toolbox use the shared battle resolver', () => {
  assert.match(read('map/index.html'), /<script src="\.\/nemesis-battle\.js/);
  assert.match(dashboard, /<script src="\.\/map\/nemesis-battle\.js/);
  for (const source of [map, dashboard, read('assets/campaign-nemesis-tool.js')]) {
    assert.match(source, /ATO_NEMESIS_BATTLE(?:\?\.|\.)targetFor\(/);
  }
});

test('the map reads the latest record for its original profile on every encounter', async () => {
  let selection = 'dahaka';
  const requests = [];
  const ctx = harness({
    state: { activeCycleId: 'c2' }, mapStateProfileId: 'original', campaignStorageUrl: '/api',
    campaignSession: { accept: value => value },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return response({ users: {
        original: { nemesisSelections: { c2: selection } },
        other: { nemesisSelections: { c2: 'adversary' } },
      } });
    },
  });
  vm.runInContext(fn(map, 'adversaryBattleUrl'), ctx);
  assert.equal(params(await ctx.adversaryBattleUrl()).book, 'c4');
  selection = 'pursuer';
  assert.equal(params(await ctx.adversaryBattleUrl()).book, 'c1');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(r => r.url === '/api?section=record' && r.options.cache === 'no-store'));
});

test('dashboard record reads pin the command profile while another profile becomes active', async () => {
  const ctx = harness({
    archive: { activeProfileId: 'other' }, authUrl: '/api', sessionUser: { id: 'owner' },
    isPlainObject: value => value && typeof value === 'object' && !Array.isArray(value),
    stopForAccountMismatch: noop,
    fetch: async () => response({ users: {
      original: { nemesisSelections: { c2: 'dahaka' } },
      other: { nemesisSelections: { c2: 'adversary' } },
    } }),
  });
  vm.runInContext([fn(dashboard, 'readServerArgoRecord'), fn(dashboard, 'adversaryBattleHref')].join('\n'), ctx);
  assert.equal(params(await ctx.adversaryBattleHref('c2', 'original')).book, 'c4');
  assert.equal(params(await ctx.adversaryBattleHref('c2')).book, 'c2');
  ctx.fetch = async () => response({}, 200, 'different-account');
  await assert.rejects(ctx.adversaryBattleHref('c2', 'original'), /无法读取/);
});

test('a missing record uses cycle defaults, while failed reads never choose an incorrect fallback battle', async () => {
  const ctx = harness({
    state: { activeCycleId: 'c3' }, mapStateProfileId: 'original', campaignStorageUrl: '/api',
    campaignSession: { accept: value => value }, fetch: async () => response(null),
  });
  vm.runInContext(fn(map, 'adversaryBattleUrl'), ctx);
  assert.equal(params(await ctx.adversaryBattleUrl()).book, 'c2');
  ctx.fetch = async () => response(null, 503);
  await assert.rejects(ctx.adversaryBattleUrl(), /HTTP 503/);
  ctx.fetch = async () => response({ users: {} });
  ctx.campaignSession.accept = () => { throw new Error('ACCOUNT_MISMATCH'); };
  await assert.rejects(ctx.adversaryBattleUrl(), /ACCOUNT_MISMATCH/);
});

function loadMapEncounter(ctx) {
  ctx.loadCampaignDashboardArchive = async () => ({ profiles: { original: { cycles: { c2: { state: { day: 38 } } } } } });
  ctx.window.ATO_NEMESIS_BATTLE = nemesis;
  vm.runInContext(fn(map, 'triggerAdversaryBattle'), ctx);
}

test('map collision reads the battle before removing the nemesis and saves before navigation', async () => {
  const sequence = [];
  const cycleState = { tokens: { AD: '001' } };
  const ctx = vm.createContext({
    state: { activeCycleId: 'c2' }, mapStateProfileId: 'original',
    activeCycleState: () => cycleState, render: noop, pushUndo: noop,
    adversaryBattleUrl: async (cycle, profile) => { sequence.push(`read:${cycle}:${profile}`); return '/story?book=c4'; },
    saveState: () => sequence.push('queue-save'),
    flushCampaignMapSave: async () => { sequence.push('save'); assert.equal(cycleState.tokens.AD, ''); return true; },
    window: { location: {}, alert: () => sequence.push('alert') },
  });
  loadMapEncounter(ctx);
  await ctx.triggerAdversaryBattle();
  assert.deepEqual(sequence, ['read:c2:original', 'queue-save', 'save', 'alert']);
  assert.equal(ctx.window.location.href, '/story?book=c4');
});

test('map collision retains its nemesis when its record cannot be read or the cycle changes during the read', async () => {
  for (const kind of ['failure', 'cycle change']) {
    let saves = 0;
    const cycleState = { tokens: { AD: '001' } };
    const ctx = vm.createContext({
      state: { activeCycleId: 'c2' }, mapStateProfileId: 'original',
      activeCycleState: () => cycleState, render: noop, pushUndo: noop,
      saveState: () => saves++, window: { location: {}, alert: noop },
      adversaryBattleUrl: async () => {
        if (kind === 'failure') throw new Error('offline');
        ctx.state.activeCycleId = 'c3';
        return '/story?book=c4';
      },
    });
    loadMapEncounter(ctx);
    await ctx.triggerAdversaryBattle();
    assert.equal(cycleState.tokens.AD, '001');
    assert.equal(saves, kind === 'failure' ? 1 : 0);
    assert.equal(ctx.window.location.href, undefined);
  }
});

for (const command of ['move-argo', 'move-special', 'chase-nemesis']) {
  test(`dashboard ${command} collision awaits the selected nemesis battle and saves before opening it`, async () => {
    const activity = [];
    const cycleId = command === 'move-special' ? 'c3' : 'c2';
    const cycleState = { currentTile: '001', explored: {}, tokens: { AG: '001', AD: '002' } };
    const commandState = { state: {}, profileId: 'original' };
    const cycle = { id: cycleId };
    const ctx = vm.createContext({
      mapCommandBusy: false, document: { querySelectorAll: () => [] }, setMapCommandStatus: noop,
      structureTechTarget: () => ({ profileId: 'original', day: 38 }), assertStructureTechTarget: noop,
      loadMapCommandState: async () => commandState, cloneJson: clone,
      currentMapCommandCycle: () => ({ cycleId, cycle, cycleState }),
      mapDirectionalTarget: () => '002', currentC3SpecialTargets: () => ['002'],
      adversaryBattleHref: async (id, profile) => { activity.push(`read:${id}:${profile}`); return '/story?book=c4'; },
      saveMapCommandState: async () => { activity.push('save'); assert.equal(cycleState.tokens.AD, ''); },
      syncMapCommandLandmarks: noop, syncDashboardMapSnapshot: noop, updateDashboardTitanXTrack: noop,
      window: {
        ATO_NEMESIS_BATTLE: nemesis,
        ATO_NEMESIS_PATH: { shortestPath: () => ['002', '001'], pursuitMovement: mapRules.window.ATO_NEMESIS_PATH.pursuitMovement },
        ATO_PAGE_ROUTER: { focusOrNavigate: async href => activity.push(href) },
      },
    });
    vm.runInContext(fn(dashboard, 'runMapCommand'), ctx);
    await ctx.runMapCommand(command, '002');
    assert.deepEqual(activity, [`read:${cycleId}:original`, 'save', '/story?book=c4']);
    assert.equal(cycleState.nemesisEncounters['38'].tileId, cycleState.currentTile);
  });
}

test('Android nemesis encounter saves the map then opens the exact battle in a new native tab', async () => {
  const sequence = [];
  const cycleState = { tokens: { AD: '001' } };
  const target = '../story/index.html?book=c4&chapter=battle&encounter=dahaka&entry=123';
  const ctx = vm.createContext({
    URL,
    state: { activeCycleId: 'c2' }, mapStateProfileId: 'original',
    activeCycleState: () => cycleState, render: () => sequence.push('render'), pushUndo: noop,
    adversaryBattleUrl: async () => target,
    saveState: () => sequence.push('queue-save'),
    flushCampaignMapSave: async () => { sequence.push('save'); return true; },
    window: { location: { href: 'file:///android_asset/web/map/index.html?cycle=c2' },
      alert: () => sequence.push('alert'),
      ATOAndroid: { openModuleTab(url) { sequence.push('open:' + url); return true; } } },
  });
  loadMapEncounter(ctx);
  await ctx.triggerAdversaryBattle();
  assert.deepEqual(sequence, ['queue-save', 'save', 'alert', 'render',
    'open:file:///android_asset/web/story/index.html?book=c4&chapter=battle&encounter=dahaka&entry=123']);
  assert.equal(ctx.window.location.href, 'file:///android_asset/web/map/index.html?cycle=c2');
});

test('Android encounter does not navigate after a failed map save', async () => {
  let opened = false;
  const cycleState = { tokens: { AD: '001' } };
  const ctx = vm.createContext({
    URL, state: { activeCycleId: 'c2' }, mapStateProfileId: 'original',
    activeCycleState: () => cycleState, render: noop, pushUndo: noop, saveState: noop,
    adversaryBattleUrl: async () => '../story/index.html?entry=123',
    flushCampaignMapSave: async () => false,
    campaignSession: { changed: false }, mapSaveConflict: false,
    window: { location: { href: 'file:///android_asset/web/map/index.html' }, alert: noop,
      ATOAndroid: { openModuleTab() { opened = true; return true; } } },
  });
  loadMapEncounter(ctx);
  await ctx.triggerAdversaryBattle();
  assert.equal(opened, false);
  assert.equal(ctx.window.location.href, 'file:///android_asset/web/map/index.html');
});

test('encounter badge resolves the recorded battle for today and a pursuit-generated encounter', () => {
  const mapState = { currentTile: '009' };
  nemesis.recordEncounter(mapState, 38, './story/?book=c4&chapter=battle&entry=dahaka');
  assert.equal(mapState.adversaryIntroduced, true);
  const ctx = harness({
    state: { day: 38, techAutomation: { events: {} } },
    currentCycleConfig: () => ({ id: 'c1' }),
    getStructureTechContext: () => ({ map: { cycles: { c1: mapState } } }),
    cachedArgoRecord: {},
  });
  vm.runInContext(fn(dashboard, 'todayNemesisEncounter'), ctx);
  assert.equal(ctx.todayNemesisEncounter().tile, '009');
  assert.match(ctx.todayNemesisEncounter().href, /book=c4&chapter=battle&entry=dahaka/);
  ctx.state.day = 39;
  assert.equal(ctx.todayNemesisEncounter(), null);
  ctx.state.techAutomation.events.round = { cycleId: 'c1', createdDay: 39, pursuit: { battle: true, path: ['014', '009'] } };
  assert.equal(ctx.todayNemesisEncounter().tile, '009');
  assert.match(ctx.todayNemesisEncounter().href, /book=c1.*chapter=battle/);
});
