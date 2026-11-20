const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const source = read('index.html');
const recordSource = read('record/index.html');
const clone = value => JSON.parse(JSON.stringify(value));
const noop = () => {};
function extract(text, name) {
  const match = text.match(new RegExp('^( *)(?:async )?function ' + name + '\\([^]*?^\\1}', 'm'));
  assert.ok(match, name);
  return match[0];
}
function declaration(name) {
  const start = source.indexOf(`    const ${name} = `);
  const end = source.indexOf('\n    };', start) + 7;
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}
function harness(cycle, adventures = []) {
  const activity = { heroReads: 0, broadcasts: [], writes: [] };
  let server = { cycle, adventures, syncLog: '' }, revision = 1;
  const c = vm.createContext({
    console: { warn: error => { throw error; } },
    state: { day: '3', surveyConstants: null }, archive: { activeProfileId: 'A' },
    authUrl: '/api', sessionUser: { id: 'owner' }, campaignSessionEpoch: 1,
    currentCycleConfig: () => ({ id: cycle }), normalizeCampaignDay: String,
    readLocalArgoRecord: () => ({}), isPlainObject: value => value && typeof value === 'object' && !Array.isArray(value),
    setNextBattleTerrainFromHub: noop, clearNextBattleTerrainForHub: noop,
    saveState: noop, renderFlow: noop, updateRecordLinks: noop,
    recordSyncChannel: { postMessage: value => activity.broadcasts.push(value) },
    readLatestHeroState: async () => { activity.heroReads++; return { heroes: [] }; },
    fetch: async (url, options) => {
      if (!options?.method) return { ok: true, status: 200, json: async () => ({
        ok: true, exists: true, revision, user: { id: 'owner' }, state: { users: { A: clone(server) } },
      }) };
      const payload = JSON.parse(options.body);
      assert.equal(payload.userId, 'A');
      assert.equal(payload.expectedAccountId, 'owner');
      assert.equal(payload.expectedRevision, revision);
      server = payload.state;
      activity.writes.push(payload);
      return { ok: true, status: 200, json: async () => ({ ok: true, revision: ++revision }) };
    },
  });
  const names = ['cloneJson', 'getCurrentSurveyConstantData', 'findSurveyHub', 'findSurveyHubBox',
    'ensureTodaySurveyConstants', 'normalizeSurveyConstants', 'surveyConstantsDayKey',
    'latestSurveyAdventureRecordAction', 'readServerArgoRecord', 'writeServerArgoRecord',
    'mergeArgoRecords', 'normalizeRecordCrewCounters', 'syncAdventureActionToArgoRecord',
    'syncSurveyAdventureToArgoRecord', 'normalizeAdventureTitle', 'recordAdventureIndex',
    'markRecordAdventure', 'recordAdventureMiddleSlots', 'appendRecordSyncLog', 'adventureSlotLabel',
    'setSurveyConstant', 'heroProgressTarget', 'assertHeroProgressTarget', 'applyMnemosTagToHeroes', 'confirmMnemosTagForHeroes',
    'currentPharosDreamConstants', 'findSimpleConstantRow',
    'simpleConstantSlotIds', 'ensureTodaySimpleConstants', 'pharosDreamsDayKey', 'ensureTodayPharosDreams',
    'setSimpleConstant', 'setPharosDreamConstant', 'latestSimpleAdventureRecordAction',
    'beginSurveyConstantInteraction', 'surveyConstantInteractionIsCurrent',
    'beginSurveyConstantMnemosSync', 'finishSurveyConstantMnemosSync', 'restoreSurveyConstantHubSelection'];
  vm.runInContext(['surveyConstantData', 'pharosDreamConstants'].map(declaration).join('\n')
    + '\nlet surveyConstantInteractionVersions = new Map();'
    + '\nlet mnemosTagApplication = Promise.resolve();'
    + '\nlet surveyConstantMnemosSyncPending = 0;'
    + '\nlet surveyConstantExternalSyncDeferred = false;\n'
    + names.map(name => extract(source, name)).join('\n'), c);
  const sync = c.syncSurveyAdventureToArgoRecord;
  c.syncSurveyAdventureToArgoRecord = () => (activity.pending = sync());
  const syncAction = c.syncAdventureActionToArgoRecord;
  c.syncAdventureActionToArgoRecord = action => (activity.pending = syncAction(action));
  return { c, activity, record: () => clone(server) };
}
function renderedRecord(cycle, record) {
  const element = () => ({
    children: [], style: {}, set innerHTML(value) { this.children = []; },
    append(...values) { this.children.push(...values); }, appendChild(value) { this.children.push(value); },
    setAttribute: noop, addEventListener: noop,
  });
  const c = vm.createContext({ state: clone(record), elements: { adventureMeta: element(), adventureList: element() },
    document: { createElement: element }, escapeHtml: String,
    cycleScopedBindKeys: new Set(['boons', 'afflictions', 'counters', 'notes', 'syncLog']),
  });
  const names = ['currentCycle', 'renderAdventures', 'normalizeState', 'normalizeCycleStats', 'normalizeCrewCounters',
    'normalizeResources', 'migrateSharedResourceKey', 'normalizeCount', 'normalizeSummonSelection',
    'normalizeTitanList', 'normalizeTitanLimit', 'normalizeDeadTitans', 'migrateTitanLimit', 'normalizeMatrix', 'normalizeMatrixKey',
    'defaultDayForCycle', 'normalizeCycleDay', 'isPlainObject', 'cloneJson', 'migrateEnemyStages', 'getBindValue', 'getCycleStat', 'currentCycleStats',
    // normalizeState() 还依赖这些（记录表加入按循环选择宿敌、进化阶段之后）：漏掉就会
    // ReferenceError，让整组用例在 record 侧加字段时莫名其妙地红掉。
    'normalizeNemesisSelections', 'migrateNemesisProgress', 'normalizeNemesisResourceHistory',
    'evolutionStages', 'getEvolutionStage'];
  vm.runInContext("globalThis.window ??= {};\n" + require("node:fs").readFileSync(require("node:path").join(__dirname, "../record/enemy-evolution.js"), "utf8"), c);
  vm.runInContext(recordSource.slice(recordSource.indexOf('    const cycleData = '), recordSource.indexOf('    const elements = '))
    + '\n' + names.map(name => extract(recordSource, name)).join('\n'), c);
  c.state = c.normalizeState(c.state);
  c.state.cycle = cycle;
  c.renderAdventures();
  return { cards: c.elements.adventureList.children, state: c.state, log: c.getBindValue('syncLog') };
}
for (const cycle of ['c1', 'c2', 'c3', 'c4', 'c5']) {
  test(`${cycle}: no heroes, empty PHP adventure map still saves and displays the constant mark`, async () => {
    const { c, activity, record } = harness(cycle);
    vm.runInContext('this.hub = surveyConstantData[currentCycleConfig().id].hubs[0]', c);
    c.setSurveyConstant('hubs', c.hub.id, 'alpha', true);
    await activity.pending;
    await Promise.resolve();
    const saved = record();
    assert.equal(saved.adventures[`${cycle}-0-alpha`], true, 'the actual serialized POST must include the mark');
    assert.match(saved.syncLog, /定数写入/);
    assert.equal(activity.writes.length, 1);
    const { cards, log } = renderedRecord(cycle, saved);
    assert.match(log, /定数写入/);
    assert.ok(cards[0].children[1].children[0].className.includes('active'), 'the record sheet displays the saved mark');
  });
}

test('a constant updates the existing cycle day and the visible cycle-scoped log', async () => {
  const { c, activity, record } = harness('c1', {});
  let saved = { cycle: 'c1', day: '1', cycleDays: { c1: '1' }, adventures: {}, cycleStats: { c1: { syncLog: 'previous entry' } } };
  c.readServerArgoRecord = async () => ({ available: true, record: clone(saved), revision: 1 });
  c.writeServerArgoRecord = async value => { saved = clone(value); return { conflict: false, revision: 2 }; };
  vm.runInContext('this.hub = surveyConstantData.c1.hubs[0]', c);
  c.setSurveyConstant('hubs', c.hub.id, 'alpha', true);
  await activity.pending;
  const displayed = renderedRecord('c1', saved);
  assert.equal(displayed.state.day, '3');
  assert.match(displayed.log, /定数写入/);
  assert.match(displayed.log, /previous entry/);
  assert.equal(saved.adventures['c1-0-alpha'], true);
});

for (const cycle of ['c1', 'c2', 'c3', 'c4', 'c5']) test(`${cycle}: blank and omega marks survive repeated record saves`, async () => {
  const { c, activity, record } = harness(cycle, { [`${cycle}-0-alpha`]: true, 'c2-1-omega': true });
  vm.runInContext('this.hub = surveyConstantData[currentCycleConfig().id].hubs[0]', c);
  const middleBox = c.hub.boxes.find(box => !['alpha', 'omega'].includes(box[0]));
  c.setSurveyConstant('hubs', c.hub.id, middleBox[0], true);
  await activity.pending;
  c.setSurveyConstant('hubs', c.hub.id, 'omega', true);
  await activity.pending;
  const saved = record();
  assert.equal(saved.adventures[`${cycle}-0-mid1`], true);
  assert.equal(saved.adventures[`${cycle}-0-alpha`], true);
  assert.equal(saved.adventures[`${cycle}-0-omega`], true);
  assert.equal(saved.adventures['c2-1-omega'], true);
  const { cards } = renderedRecord(cycle, saved);
  const buttons = cards[0].children[1].children;
  assert.ok(buttons[1].className.includes('active'));
  assert.ok(buttons.at(-1).className.includes('active'));
});

for (const cycle of ['c4', 'c5']) test(`${cycle}: Pharos named constants also save from an empty PHP map`, async () => {
  const { c, activity, record } = harness(cycle);
  c.setPharosDreamConstant('beta', true);
  await activity.pending;
  const saved = record();
  assert.equal(saved.adventures[`${cycle}-7-beta`], true);
  const { cards, log } = renderedRecord(cycle, saved);
  assert.ok(cards[7].children[1].children[1].className.includes('active'));
  assert.match(log, /定数写入/);
});

test('a conflict retry preserves remote resources while normalizing the newest empty PHP map', async () => {
  const { c, activity } = harness('c1');
  let reads = 0, writes = 0, saved;
  c.readServerArgoRecord = async () => ({ available: true, revision: ++reads,
    record: { adventures: [], resources: { bone: reads === 1 ? 0 : 7 } },
  });
  c.writeServerArgoRecord = async value => {
    if (++writes === 1) return { conflict: true };
    saved = clone(value);
    return { conflict: false, revision: 3 };
  };
  vm.runInContext('this.hub = surveyConstantData.c1.hubs[0]', c);
  c.setSurveyConstant('hubs', c.hub.id, 'alpha', true);
  await activity.pending;
  assert.equal(writes, 2);
  assert.equal(saved.adventures['c1-0-alpha'], true);
  assert.equal(saved.resources.bone, 7);
});

function adventureRollHarness() {
  const fn = ['adventureRollFaces', 'pickAdventureD10', 'pickPharosDreamRoll', 'pickRestAdventure',
    'pickBranchAdventure', 'simpleConstantSlotIds', 'recordAdventureMiddleSlots',
    'adventureRollContext', 'runAdventureRoll', 'rollPharosDream', 'pharosTimelineForDay'];
  const opened = [];
  const ctx = vm.createContext({
    state: { day: 4, pharosTimeline: { today: { day: 4 }, later: { day: 5 } }, pharosDreams: {} },
    archive: { activeProfileId: 'test' }, campaignSessionEpoch: 1,
    currentCycleConfig: () => ({ id: 'c1' }), ownsDashboardWriteLease: () => true,
    renderFlow: noop, renderDateTrack: noop, getStoryHref: ({ chapter, entry }) => chapter + '/' + entry,
    window: { ATO_PAGE_ROUTER: { focusOrNavigate: href => opened.push(href) } },
  });
  vm.runInContext(['surveyConstantData', 'pharosDreamConstants'].map(declaration).join('\n') +
    '\nlet pendingAdventureRoll = null, adventureRollBusy = false;\n' +
    fn.map(name => extract(source, name)).join('\n') +
    '\nthis.survey = surveyConstantData; this.pharos = pharosDreamConstants;' +
    '\nthis.currentPharosDreamConstants = () => pharos.c1; this.ensureTodayPharosDreams = () => state.pharosDreams;', ctx);
  return { ctx, opened };
}

test('休整：已标第一格的特殊结果打开第二段，整表标完才清表', () => {
  const { ctx } = adventureRollHarness();
  const table = ctx.survey.c1;
  const second = ctx.pickRestAdventure(table, { 1: true }, () => 0);
  assert.equal(second.row.slot, '1-goto');
  assert.equal(second.row.entry, '11');
  assert.equal(ctx.pickRestAdventure(table, { 1: true, '1-goto': true }, () => 0).row.id, '2');
  const full = Object.fromEntries(table.rr.flatMap(([id, , extra]) =>
    [[id, true], ...(extra?.goTo ? [[id + '-goto', true]] : [])]));
  assert.equal(ctx.pickRestAdventure(table, full, () => 0).reset, true);
});

test('分支：按当前剧情列选分支，冒险记录轨决定 α、普通、Ω，已满分支重掷', () => {
  const { ctx } = adventureRollHarness();
  const data = ctx.survey.c1;
  const select = (adventures, values = {}, column = 0, random = () => 0) =>
    ctx.pickBranchAdventure(data, column, 'c1', { adventures }, values, random);
  const first = select({});
  assert.equal(first.hub.id, 'fated-conundrum');
  assert.equal(first.slot, 'alpha');
  const middle = select({ 'c1-0-alpha': true }, { hubs: { 'fated-conundrum': { '1-2': true } } });
  assert.equal(middle.recordSlot, 'mid1');
  assert.equal(middle.slot, '3-4');
  const marked = Object.fromEntries(['alpha', 'mid1', 'mid2', 'mid3'].map(id => ['c1-0-' + id, true]));
  assert.equal(select(marked).slot, 'omega');
  assert.equal(select({ ...marked, 'c1-0-omega': true }).hub.id, 'plight-of-the-people');
  assert.equal(select({}, {}, 3).hub.id, 'man-of-purpose');
  assert.equal(select({}, {}, -1), null);
  assert.equal(select({}, {}, 0, () => 0.29).hub.id, 'fated-conundrum');
  assert.equal(select({}, {}, 0, () => 0.30).hub.id, 'plight-of-the-people');
});

test('航标梦境：今日事件保存标记后才跳转，失败重试和继续阅读都复用原段落', async () => {
  const { ctx, opened } = adventureRollHarness();
  let marks = 0, save = false;
  ctx.setPharosDreamConstant = id => { ctx.state.pharosDreams[id] = true; marks++; };
  ctx.flushCampaignSave = async () => save;
  assert.equal(ctx.pharosTimelineForDay(4).length, 1);
  await ctx.rollPharosDream('later');
  assert.equal(marks, 0);
  await ctx.rollPharosDream('today');
  const entry = ctx.state.pharosTimeline.today.entry;
  assert.equal(marks, 1);
  assert.ok(ctx.state.pharosDreams[entry]);
  assert.deepEqual(opened, []);
  save = true;
  await ctx.rollPharosDream('today');
  await ctx.rollPharosDream('today');
  assert.equal(marks, 1);
  assert.deepEqual(opened, ['dreams-of-pharos/' + entry, 'dreams-of-pharos/' + entry]);
});

test('航标梦境：跳过已满点数，整表已满时可重新抽选', () => {
  const { ctx } = adventureRollHarness();
  const data = ctx.pharos.c1;
  assert.equal(ctx.pickPharosDreamRoll(data, { 1: true }, () => 0).row.entry, '2');
  const full = Object.fromEntries(data.boxes.map(([id]) => [id, true]));
  const result = ctx.pickPharosDreamRoll(data, full, () => 0.95);
  assert.equal(result.reset, true);
  assert.equal(result.row.entry, '10');
});

test('同一个自动分支记录格重试不会占用下一个空格', () => {
  const { c } = harness('c1');
  const record = {};
  const action = { cycle: 'c1', adventure: 'Fated Conundrum', box: '1-2', recordSlot: 'mid1' };
  assert.equal(c.markRecordAdventure(record, action), 'mid1');
  assert.equal(c.markRecordAdventure(record, action), '');
  assert.deepEqual(clone(record.adventures), { 'c1-0-mid1': true });
});
