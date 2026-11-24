import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import dice from '../aibp/room-dice.js';
import gearRolls from '../aibp/gear-roll-profiles.js';
import guide from '../aibp/ai-turn-guide.js';
import los from '../aibp/battle_los.js';
import terrain from '../ss/terrain-data.js';

// Exercise the real Worker reducers; only the Cloudflare base class is replaced.
// Run: cd cloudflare && node --test battle-rules.test.mjs
const bundled = await build({
  stdin: { contents: `export { BattleRoom } from './worker/battle-room.js';
    export { createTrauma, applyTrauma, traumaView } from './worker/room-trauma.js';
    export { applySquad, syncCampaignStock } from './worker/room-squad.js';
    export { setupRoomBoard } from './worker/board.js';
    export { captureTurnUndo, canUndoTurn, undoTurn } from './worker/room-turn.js';
    export { prepareRoomDeck, roomDeckProjection } from './worker/room-deck.js';`, resolveDir: import.meta.dirname },
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'cloudflare-test-base', setup(builder) {
    builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'workers', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export class DurableObject {}' }));
  } }],
});
const temporary = await mkdtemp(join(tmpdir(), 'ato-battle-rules-'));
let api;
try {
  const target = join(temporary, 'worker.mjs');
  await writeFile(target, bundled.outputFiles[0].text);
  api = await import(pathToFileURL(target));
} finally { await rm(temporary, { recursive: true, force: true }); }
const { BattleRoom, createTrauma, applyTrauma, traumaView, applySquad, syncCampaignStock } = api;
const host = { role: 'host' }, player = { role: 'player', seat: 0 };
const random = max => max - 1;
const room = (danger = 0) => ({
  heroes: [0, 1].map(i => ({ id: 'h' + i, name: '英雄' + i, player: '',
    titan: { typeId: 'dreamwalker' }, stats: { danger, rage: 0, fate: 0 },
    condition: 'standing', gear: [], mnemos: [] })),
  trauma: createTrauma('c1', false, random), round: 1, pool: { opening: 0 }, rolls: [],
});
function draw(r, fields = {}) {
  return applyTrauma(r, player, { id: crypto.randomUUID(), type: 'trauma-draw',
    seat: 0, mode: 'draw', deck: 'auto', ...fields }, random);
}
function resolve(r, operation = 'bottom') {
  applyTrauma(r, player, { type: 'trauma-resolve', seat: 0, draw: r.trauma.drawn.at(-1).id, operation }, random);
}
const reducer = Object.create(BattleRoom.prototype);

test('官方中文规则 p42：凶险为0的普通创伤抽取无事发生', () => {
  const r = room(), before = structuredClone(r);
  draw(r);
  assert.deepEqual(r, before);
});
test('凶险为0时卡文指定险情等级仍可抽取', () => {
  const r = room(); draw(r, { deck: 'heavy' });
  assert.equal(traumaView(r, player).latest.card.deck, 'heavy');
  assert.equal(r.heroes[0].stats.danger, 0);
});
test('护甲减至0：不增加凶险、不抽创伤', () => {
  const r = room(3), before = structuredClone(r);
  draw(r, { mode: 'hit', amount: 0 }); assert.deepEqual(r, before);
});
test('非攻击获得凶险不超过9：不抽创伤', () => {
  const r = room(8); draw(r, { mode: 'gain', amount: 1 });
  assert.equal(r.heroes[0].stats.danger, 9); assert.equal(r.trauma.drawn.length, 0);
});
for (const [danger, deck] of [[1, 'light'], [3, 'light'], [4, 'heavy'], [6, 'heavy'], [7, 'lethal'], [9, 'lethal']]) {
  test(`梦行者凶险${danger}：按面板抽取${deck}`, () => {
    const r = room(danger); draw(r); assert.equal(traumaView(r, player).latest.card.deck, deck);
  });
}
test('受击先增加凶险，再按新的险情等级抽取', () => {
  const r = room(3); draw(r, { mode: 'hit', amount: 1 });
  assert.equal(r.heroes[0].stats.danger, 4); assert.equal(traumaView(r, player).latest.card.deck, 'heavy');
});
test('非攻击获得凶险超过9：抽生死关头且三曲盘保持9', () => {
  const r = room(9); draw(r, { mode: 'gain', amount: 1 });
  assert.equal(r.heroes[0].stats.danger, 9); assert.equal(r.trauma.latest.danger, 10);
  assert.equal(traumaView(r, player).latest.card.deck, 'obol');
});
for (const [danger, count] of [[13, 2], [14, 3], [18, 4], [21, 5]]) {
  test(`极度凶险${danger}：抽牌前共享生死关头牌数为${count}`, () => {
    const r = room(9); draw(r, { mode: 'hit', amount: danger - 9 });
    assert.equal(r.trauma.piles.obol.length + r.trauma.drawn.length, count);
    resolve(r); r.heroes[0].stats.danger = 9;
    draw(r, { mode: 'hit', amount: danger - 9 });
    assert.equal(r.trauma.piles.obol.length + r.trauma.drawn.length, count, '不重复加入阈值牌');
  });
}
test('普通创伤结算后回到底部', () => {
  const r = room(1); draw(r); const card = r.trauma.latest.card; resolve(r);
  assert.equal(r.trauma.piles.light.at(-1), card);
});
test('死亡泰坦不能再抽创伤；玩家不能操作别人', () => {
  const r = room(3); r.heroes[0].condition = 'dead';
  assert.throws(() => draw(r), /状态/); assert.throws(() => draw(r, { seat: 1 }), /自己/);
});
test('每颗骰子只能重掷一次；转换后不可回到重掷阶段', () => {
  const r = room(); r.rolls = [{ id: 'roll', seat: 0, dice: [{ id: 'die', kind: 'red', face: 0 }] }];
  reducer.changeRoll(r, 0, { type: 'reroll', roll: 'roll', ids: ['die'] });
  assert.throws(() => reducer.changeRoll(r, 0, { type: 'reroll', roll: 'roll', ids: ['die'] }), /已经重掷/);
  r.rolls[0].dice = [{ id: 'die', kind: 'red', face: 0 }];
  reducer.changeRoll(r, 0, { type: 'convert', roll: 'roll', die: 'die', symbol: 'potential' });
  assert.throws(() => reducer.changeRoll(r, 0, { type: 'reroll', roll: 'roll', ids: ['die'] }), /转换/);
});
test('实时操作在确认中更新发起端，同时广播给其他标签页和投屏', async () => {
  const r = room();
  r.revision = 0;
  r.secrets = { host: 'host', viewer: 'viewer', players: [null, null] };
  function socket(role, secretHash, patches = false) {
    const messages = [];
    return {
      messages,
      deserializeAttachment: () => ({ role, secretHash, patches }),
      send: text => messages.push(JSON.parse(text)),
    };
  }
  const sender = socket('host', 'host');
  const otherTab = socket('host', 'host');
  const viewer = socket('viewer', 'viewer');
  const compactHost = socket('host', 'host', true);
  const battle = Object.assign(Object.create(BattleRoom.prototype), {
    load: () => r,
    save: () => {},
    ctx: { getWebSockets: () => [sender, otherTab, viewer, compactHost],
      storage: { transactionSync: write => write() } },
    sql: { exec: () => ({ toArray: () => [] }) },
  });
  const id = crypto.randomUUID();
  await battle.webSocketMessage(sender, JSON.stringify({
    type: 'action', action: { id, type: 'pool', key: 'opening', delta: 1 },
  }));
  assert.equal(sender.messages.length, 1);
  const [acknowledgement] = sender.messages;
  assert.equal(acknowledgement.type, 'action-result');
  assert.equal(acknowledgement.id, id);
  assert.equal(acknowledgement.status, 200);
  assert.equal(acknowledgement.data.room.pool.opening, 1);
  for (const [observer, role] of [[otherTab, 'host'], [viewer, 'viewer']]) {
    assert.equal(observer.messages.length, 1);
    assert.equal(observer.messages[0].actor.role, role);
    assert.equal(observer.messages[0].room.revision, acknowledgement.data.room.revision);
  }
  assert.deepEqual(compactHost.messages, [{
    roomPatch: { baseRevision: 0, revision: 1, room: { pool: { opening: 1 } }, activity: r.activity[0] },
  }]);
  const clear = crypto.randomUUID();
  await battle.webSocketMessage(compactHost, JSON.stringify({
    type: 'action', action: { id: clear, type: 'pool-clear' },
  }));
  const clearAck = compactHost.messages[1];
  assert.equal(clearAck.id, clear);
  assert.equal(clearAck.data.roomPatch.room.pool.opening, 0);
  assert.equal(clearAck.data.roomPatch.activity.id, clear);
  assert.equal(clearAck.data.roomPatch.baseRevision, 1);
  assert.equal(sender.messages[1].room.revision, 2);
});

test('历史战斗编号不能修改新一场战斗', () => {
  const r = room(); r.squad = { phase: 'battle', battleNumber: 2 };
  assert.throws(() => reducer.apply(r, player, { type: 'pool', key: 'opening', delta: 1, battleNumber: 1 }), /已经切换/);
  assert.equal(r.pool.opening, 0);
});
test('从备战开始下一场：重置战斗状态，保留剧情三曲盘', () => {
  const r = room(); r.squad = { phase: 'prep', battleNumber: 1, cycle: 'c1',
    stock: { loadouts: {}, titans: [] }, gearNames: {} };
  r.heroes[0].storyStats = { danger: 2, rage: 3, fate: 4 };
  r.heroes[0].stats.danger = 9; r.heroes[0].condition = 'dead'; r.pool.opening = 7;
  r.round = 4; r.rolls = [{ id: 'old' }]; r.argoAbilities = { old: { used: 1 } };
  applySquad(r, host, { type: 'squad-start', battleNumber: 1, board: { apostle: 'HEKATON', level: 1 } }, random);
  assert.equal(r.squad.phase, 'battle'); assert.equal(r.squad.battleNumber, 2); assert.equal(r.round, 1);
  assert.equal(r.pool.opening, 0); assert.deepEqual(r.rolls, []); assert.deepEqual(r.argoAbilities, {});
  assert.equal(r.heroes[0].condition, 'standing');
  assert.deepEqual(r.heroes[0].stats, { danger: 2, rage: 3, fate: 4 });
  assert.equal(r.trauma.highestDanger, 0); assert.equal(r.trauma.drawn.length, 0);
  assert.deepEqual(r.heroes[0].storyStats, { danger: 2, rage: 3, fate: 4 });
});

test('战斗结算清零三曲盘和临时状态，并保留损伤、投掷与阵亡记录', () => {
  const r = room(6);
  r.squad = { phase: 'battle', battleNumber: 1, cycle: 'c1', checks: [],
    stock: { loadouts: {}, titans: [] }, gearNames: {} };
  r.heroes[0].storyStats = { danger: 2, rage: 3, fate: 4 };
  r.heroes[1].storyStats = { danger: 1, rage: 2, fate: 3 };
  r.heroes[0].stats.rage = 5;
  r.heroes[1].stats.fate = 7;
  r.heroes[0].markers = { despair: 1, ambrosia: 2 };
  r.heroes[0].condition = 'down';
  r.heroes[1].condition = 'dead';
  r.rolls = [{ id: 'last', seat: 0, mode: 'power', wounds: 3 }];

  reducer.apply(r, host, { type: 'end', battleNumber: 1, damage: [null, 2] });
  assert.equal(r.squad.phase, 'story');
  for (const hero of r.heroes) {
    const zeroes = { rage: 0, fate: 0, danger: 0 };
    assert.deepEqual(hero.stats, zeroes);
    assert.deepEqual(hero.storyStats, zeroes);
    assert.equal(hero.markers, undefined);
  }
  assert.deepEqual(r.heroes.map(hero => hero.condition), ['standing', 'dead']);
  assert.deepEqual(r.squad.recap.heroes.map(hero => hero.damage), [3, 2]);
  assert.equal(r.squad.lastBattleRoll.id, 'last');

  applySquad(r, player, { type: 'squad-stat', seat: 0, key: 'fate', delta: 1 }, random);
  assert.equal(r.heroes[0].storyStats.fate, 1);
  assert.equal(r.heroes[0].stats.fate, 0);
  applySquad(r, host, { type: 'squad-phase', phase: 'prep' }, random);
  applySquad(r, host, { type: 'squad-start', battleNumber: 1, board: { apostle: 'HEKATON', level: 1 } }, random);
  assert.deepEqual(r.heroes[0].stats, { rage: 0, fate: 1, danger: 0 });
});

test('读剧情保存配装，备战刷新库存时保存未被军械库改动的个人配装', () => {
  const r = room();
  const kit = { player: '', titanId: 't', gear: {} };
  const titans = [{ id: 't', count: 2, typeId: 'dreamwalker' }];
  const stock = { arsenal: {}, titans, loadouts: { h0: kit, h1: kit } };
  r.squad = { phase: 'story', battleNumber: 0, cycle: 'c1', gearNames: {}, stock,
    campaignLoadouts: structuredClone(stock.loadouts) };
  applySquad(r, player, { type: 'squad-kit', seat: 0, base: kit,
    kit: { ...kit, titanPanelId: 'solon' } }, random);
  const fresh = { gearNames: { AJ0001: '测试装备' }, stock: { ...stock,
    arsenal: { AJ0001: { quantity: 1 } },
    titans: [{ ...titans[0], traumaPatternId: 'AW0285', panelId: 'ulyssia' }],
    loadouts: { h0: kit, h1: { ...kit, gear: { AJ0001: 1 } } },
  } };
  assert.equal(syncCampaignStock(r, fresh), true);
  assert.equal(syncCampaignStock(r, fresh), false);
  assert.equal(r.squad.stock.loadouts.h0.titanPanelId, 'solon');
  assert.equal(r.squad.stock.loadouts.h1.gear.AJ0001, 1);
  applySquad(r, host, { type: 'squad-phase', phase: 'prep' }, random);
  applySquad(r, host, { type: 'squad-start', battleNumber: 0, board: { apostle: 'HEKATON', level: 1 },
    goal: '在三轮内撤离' }, random);
  assert.equal(r.battleGoal, '在三轮内撤离');
  assert.deepEqual(r.heroes.map(hero => hero.titan.panelId), ['ulyssia', 'ulyssia']);
  assert.deepEqual(r.heroes[0].titan.patternIds, ['AW0285']);
  assert.equal(syncCampaignStock(r, { stock: { ...stock }, gearNames: {} }), false);
});

test('开战库存刷新清理小队旧草稿里的零库存分析模块，保留有效草稿和真实短缺', () => {
  const r = room();
  const kit = { player: '', titanId: 't', gear: {} };
  const titans = [{ id: 't', count: 2, typeId: 'dreamwalker' }];
  const fresh = { gearNames: { AJ0001: '测试装备' }, stock: {
    arsenal: { AJ0001: { quantity: 1 } }, titans, loadouts: { h0: kit, h1: kit },
  } };
  r.squad = { phase: 'prep', battleNumber: 0, cycle: 'c1', gearNames: { AJ0217: '分析模块' },
    campaignLoadouts: structuredClone(fresh.stock.loadouts), stock: { ...fresh.stock, loadouts: {
      h0: { ...kit, gear: { AJ0217: 1, AJ0001: 1 } }, h1: kit,
    } } };
  const inconsistent = structuredClone(r);
  const savedStock = structuredClone(fresh);
  savedStock.stock.loadouts.h0 = { ...kit, gear: { AJ0217: 1 } };
  savedStock.gearNames.AJ0217 = '分析模块';
  assert.equal(syncCampaignStock(inconsistent, savedStock), true);
  const start = { type: 'squad-start', battleNumber: 0, board: { apostle: 'HEKATON', level: 1 } };
  assert.throws(() => applySquad(inconsistent, host, start, random), /分析模块.*库存 0 件.*英雄0 ×1/);

  assert.equal(syncCampaignStock(r, fresh), true);
  assert.equal(syncCampaignStock(r, fresh), false);
  assert.deepEqual(r.squad.stock.loadouts.h0.gear, { AJ0001: 1 });
  applySquad(r, host, start, random);
  assert.equal(r.squad.phase, 'battle');
});

test('创伤样式覆盖旧配装，受击到凶险 1 时更新凶险并跳过抽取', () => {
  const r = room();
  const kit = { player: '', titanId: 't', gear: {}, traumaTrack: Array(9).fill('lethal') };
  r.squad = { phase: 'prep', battleNumber: 0, cycle: 'c1', gearNames: {}, stock: {
    arsenal: {}, titans: [{ id: 't', count: 2, typeId: 'dreamwalker' }],
    loadouts: { h0: kit, h1: { ...kit } },
  } };
  const chosen = { ...kit, traumaPatternId: 'AW0285', kratosPatternId: 'AW0286' };
  r.squad.stock.loadouts.h0 = chosen;
  applySquad(r, player, { type: 'squad-kit', seat: 0, base: r.squad.stock.loadouts.h0,
    kit: { titanId: 't', titanPanelId: 'solon', gear: {} } }, random);
  applySquad(r, host, { type: 'squad-start', battleNumber: 0, board: { apostle: 'HEKATON', level: 1 } }, random);
  assert.deepEqual(r.heroes[0].titan.patternIds, ['AW0285', 'AW0286']);
  assert.deepEqual(r.heroes[1].titan.patternIds, []);
  draw(r, { mode: 'hit', amount: 1 });
  assert.equal(r.heroes[0].stats.danger, 1);
  assert.equal(r.trauma.drawn.length, 0);
  draw(r, { deck: 'light' });
  assert.equal(traumaView(r, player).latest.card.deck, 'light');
  draw(r, { mode: 'hit', amount: 3 });
  assert.equal(traumaView(r, player).latest.card.deck, 'heavy');
  draw(r, { mode: 'hit', amount: 6 });
  assert.equal(traumaView(r, player).latest.card.deck, 'obol');
});

test('创伤样式按凶险逐格读取，不合并非连续的轻微创伤档位', () => {
  const r = room();
  r.squad = { phase: 'prep', battleNumber: 0, cycle: 'c3', gearNames: {}, stock: {
    arsenal: {}, titans: [{ id: 't', count: 1, typeId: 'dreamwalker' }],
    loadouts: { h0: { titanId: 't', traumaPatternId: 'CW1553', gear: {} } },
  } };
  applySquad(r, host, { type: 'squad-start', battleNumber: 0, board: { apostle: 'HEKATON', level: 1 } }, random);
  const picked = [];
  for (const danger of [4, 5, 6]) {
    r.heroes[0].stats.danger = danger;
    draw(r);
    picked.push(traumaView(r, player).latest.card.deck);
  }
  assert.deepEqual(picked, ['heavy', 'light', 'heavy']);
});

test('旧战斗没有牌堆快照时，需要由房主初始化，玩家不能自行导入', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HEKATON', level: 1 }, 2);
  r.turn = { phase: 'apostle', seat: null, finished: [] };
  const reveal = { type: 'bp-request', round: 1, id: 'request' };
  assert.throws(() => reducer.apply(r, player, reveal), /泰坦回合/);
  r.turn.phase = 'titans';
  assert.throws(() => reducer.apply(r, player, reveal), /先同步牌堆/);
  assert.throws(() => reducer.apply(r, player, { type: 'room-projection' }), /由房主同步/);
});

test('导航揭示 AI 使用 Worker 当前牌堆，重试不会多抽牌', () => {
  const r = room();
  r.board = { apostle: 'HEKATON' };
  r.turn = { phase: 'apostle', seat: null, finished: [] };
  const card = n => ({ type: 'AI', level: 'I', index: n, _room: { face: { src: 'ps/HEKATON/AI' + n + '.jpg', label: 'AI ' + n } } });
  const pile = { deck: [], discard: [card(1), card(2)], removed: [], supply: {} };
  const data = { apostle: 'HEKATON', lastRevealed: {}, tokens: [], AI: pile,
    BP: { ...pile, discard: [] }, flags: { aiBottom: true } };
  r.battleDeck = api.prepareRoomDeck(data, 'HEKATON');
  r.projection = api.roomDeckProjection(r.battleDeck, {});
  assert.throws(() => reducer.apply(r, player, { type: 'ai-request' }), /只有房主/);
  reducer.apply(r, host, { type: 'ai-request', id: 'first' });
  const first = r.projection.ai.src;
  assert.match(first, /AI[12]\.jpg$/);
  assert.equal(r.projection.aiPending, true);
  assert.equal(r.projection.aiDeck.count, 1);
  assert.equal(r.projection.aiDeck.discard, 0);
  reducer.apply(r, host, { type: 'ai-request', id: 'retry' });
  assert.equal(r.projection.ai.src, first);
  assert.equal(r.battleDeck.revision, 2);
  assert.equal(r.battleDeck.operation, 'first');
});

test('卡牌增量按客户端版本发送，只有房主收到完整牌堆', () => {
  const r = room();
  r.revision = 0;
  r.board = api.setupRoomBoard({ apostle: 'HEKATON', level: 1 }, 2);
  r.turn = { phase: 'apostle', seat: null, finished: [] };
  const card = index => ({ type: 'AI', level: 'I', index, _room: {
    face: { src: 'ps/HEKATON/AI' + index + '.jpg', label: 'AI ' + index },
  } });
  const pile = { deck: [card(1), card(2)], discard: [], removed: [], supply: {} };
  r.battleDeck = api.prepareRoomDeck({ apostle: 'HEKATON', AI: pile,
    BP: { ...pile, deck: [] }, tokens: [], lastRevealed: {} }, 'HEKATON');
  r.projection = api.roomDeckProjection(r.battleDeck, {});
  function socket(role, version) {
    const messages = [];
    return { messages, deserializeAttachment: () => ({ role, patches: true, cardPatches: version === 2 }),
      send: text => messages.push(JSON.parse(text)) };
  }
  const sender = socket('host', 2);
  const viewer = socket('viewer', 2);
  const legacy = socket('viewer', 1);
  const next = Object.assign(Object.create(BattleRoom.prototype), {
    save: () => {},
    ctx: { getWebSockets: () => [sender, viewer, legacy], storage: { transactionSync: write => write() } },
    sql: { exec: () => ({ toArray: () => [] }) },
  });
  const result = next.action(r, host, { type: 'ai-request', id: crypto.randomUUID() }, [], undefined, sender);
  const patch = viewer.messages[0].roomPatch;
  assert.equal(result.roomPatch.room.hostBattleDeck.revision, 2);
  assert.equal(sender.messages.length, 0);
  assert.equal(patch.room.projection.aiPending, true);
  assert.equal(patch.room.hostBattleDeck, undefined);
  assert.equal(patch.room.deckRevision, 2);
  assert.equal(legacy.messages[0].room.revision, patch.revision);
  assert.equal(legacy.messages[0].room.hostBattleDeck, undefined);
});

test('成员的投屏连接使用只读身份，并只投影共享剧情', () => {
  const r = room();
  r.secrets = { host: 'host', viewer: 'viewer', players: ['player'] };
  r.squad = { phase: 'story', story: { text: '共享剧情' } };
  const projected = reducer.actor(r, 'player', true);
  assert.deepEqual(projected, { role: 'viewer', seat: 0 });
  const view = reducer.view(r, projected);
  assert.deepEqual(view.actor, { role: 'viewer' });
  assert.equal(view.room.squad.story.text, '共享剧情');
  assert.equal(view.room.squad.loadouts, undefined);
  assert.equal(view.room.secrets, undefined);
  assert.throws(() => reducer.action(r, projected, {}), /只能查看/);
  assert.deepEqual(reducer.actor(r, 'player'), player);
});

test('Worker 独立揭示、结算部位牌并激化，完整牌堆只对房主可见', () => {
  const face = (type, level, index) => {
    const src = `ps/HEKATON/HEKATON_${type}_${level}_00${index}.jpg`;
    return { type, level, index, _room: { face: { src, label: type + ' ' + level },
      back: { src: src.replace('.jpg', '_BACK.jpg') }, tier: level } };
  };
  for (const [outcome, level, damage] of [[0, 'I', 0], [1, 'I', 1], [2, 'II', 1], [1, 'III', 2], [2, 'III', 2]]) {
    const r = room();
    r.board = api.setupRoomBoard({ apostle: 'HEKATON', level: 1 }, 2);
    r.turn = { phase: 'titans', seat: null, finished: [] };
    r.pool = { opening: 3 };
    r.rolls = [{ id: 'power', mode: 'power', seat: 0, round: 1 }];
    const hidden = face('BP', 'I', 2);
    const current = face('BP', level, 1);
    const data = { apostle: 'HEKATON', lastRevealed: {}, tokens: [
      { file: 'DA+.png', count: 2, id: 'private-id', x: 8 },
      { file: 'SP-.png', count: 1 }, { file: '../BP.png', count: 1 },
    ],
      AI: { deck: [face('AI', 'I', 1)], discard: [], removed: [], supply: { II: [face('AI', 'II', 1)], III: [] } },
      BP: { deck: [current, hidden], discard: [], removed: [], damage: [],
        supply: { II: [face('BP', 'II', 1)], III: [face('BP', 'III', 2), face('BP', 'III', 3)] } } };
    r.battleDeck = api.prepareRoomDeck(data, 'HEKATON');
    r.projection = api.roomDeckProjection(r.battleDeck, {});
    if (outcome === 0) {
      reducer.apply(r, host, { type: 'bp-request', id: 'preview', round: 1 });
      assert.equal(r.turn.seat, null);
      assert.equal(r.battleDeck.bpSeat, undefined);
    } else if (outcome === 2) {
      reducer.apply(r, host, { type: 'bp-request', id: 'preview', round: 1, seat: 1 });
      assert.equal(r.battleDeck.bpSeat, 1);
    }
    reducer.apply(r, player, { type: 'bp-request', id: 'reveal', round: 1 });
    assert.equal(r.battleDeck.bpSeat, 0);
    assert.equal(r.projection.bp.src, current._room.face.src);
    assert.equal(r.projection.bpDeck.back.src, hidden._room.back.src);
    const viewer = reducer.view(r, { role: 'viewer' }).room;
    assert.equal(viewer.hostBattleDeck, undefined);
    assert.deepEqual(viewer.projection.tokens, [{ file: 'DA+.png', count: 2 }, { file: 'SP-.png', count: 1 }]);
    assert.ok(!JSON.stringify(viewer).includes('HEKATON_BP_I_002.jpg'));
    assert.throws(() => reducer.apply(r, host, { type: 'room-projection', deckRevision: 1, deck: data, projection: r.projection }), /牌堆已更新/);
    const manual = level === 'III' && outcome === 1;
    if (manual) r.rolls = [];
    const settlement = { type: 'bp-settle', id: 'settled', round: 1,
      ...(manual ? {} : { roll: 'power' }), seat: 0, value: outcome, card: current._room.face.src };
    if (r.turn.seat === 0) reducer.apply(r, player, { type: 'turn-finish', seat: 0, round: 1, phase: 'titans' });
    const priorSeat = r.turn.seat;
    if (manual) assert.throws(() => reducer.apply(r, player, { type: 'bp-request', id: 'another', round: 1 }), /泰坦回合/);
    else {
      const other = { id: 'other-power', mode: 'power', seat: 1, round: 1 };
      r.rolls.push(other);
      const rival = { role: 'player', seat: 1 };
      assert.throws(() => reducer.apply(r, rival, { ...settlement, roll: other.id }), /核对当前部位牌/);
      assert.throws(() => reducer.apply(r, rival, { type: 'bp-request', id: 'another', round: 1 }), /另一位泰坦/);
      r.rolls.pop();
    }
    if (manual) assert.throws(() => reducer.apply(r, player, settlement), /威力投掷/);
    else assert.throws(() => reducer.apply(r, { role: 'player', seat: 1 }, settlement), /威力投掷|核对当前部位牌/);
    reducer.apply(r, manual ? host : player, settlement);
    assert.equal(r.projection.bpPending, false);
    assert.equal(r.projection.damage.total, damage);
    if (manual) assert.equal(r.secondAbility.roll, null);
    else {
      assert.equal(r.rolls[0].bpOutcome, outcome);
      assert.equal(r.rolls[0].wounds, damage);
    }
    assert.equal(r.battleStats[0].damage, damage);
    assert.equal(r.turn.seat, priorSeat);
    assert.equal(r.secondAbility.id, 'settled');
    assert.equal(r.pool.opening, 3);
    assert.equal(r.battleDeck.revision, outcome === 1 ? 3 : 4);
    if (!outcome) assert.deepEqual(r.battleDeck.data.BP.discard, [current]);
    if (level === 'I' && outcome) assert.equal(r.battleDeck.data.AI.deck[0].level, 'II');
    if (level === 'III' && outcome === 1) assert.equal(r.battleDeck.data.BP.deck.at(-1), current);
    if (level === 'III' && outcome === 2) assert.equal(r.battleDeck.data.BP.damage[0], current);
    if (level === 'III') {
      assert.deepEqual(reducer.view(r, player).room.projection.tokens, [
        { file: 'DA+.png', count: 2 }, { file: 'SP-.png', count: 1 },
        { file: 'DA+.png', count: 1, perHit: true }, { file: 'HT+.png', count: 1 },
      ]);
    }
  }
});

test('骇物允许落到泰坦和地形所在格，路线只走正交步', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HEKATON', level: 1 }, 2);
  const pieces = r.board.map.pieces;
  r.board.map.terrain = [{ id: 'obstacle', name: 'Column', column: 2, row: 2, rotation: 0 }];
  pieces.apostle = { column: 10.5, row: 8.5, facing: 90 };
  pieces.titans[0] = { column: 2, row: 2 };
  const point = { column: 2.5, row: 2.5 };
  reducer.apply(r, host, { type: 'board-apostle-move', from: pieces.apostle, point, speed: 32 });
  assert.deepEqual(pieces.apostle, { ...point, facing: 90 });
  const route = r.board.lastApostleMove.route;
  assert.deepEqual(route[0], { column: 10.5, row: 8.5 });
  assert.deepEqual(route.at(-1), point);
  for (let i = 1; i < route.length; i++) {
    assert.equal(Math.abs(route[i].column - route[i - 1].column) + Math.abs(route[i].row - route[i - 1].row), 1);
  }
});

test('撤回只应用于自己的最新移动，原格被占用时拒绝', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HEKATON', level: 1 }, 2);
  r.board.map.terrain = [];
  r.board.map.pieces.titans = [{ column: 2, row: 2 }, { column: 5, row: 5 }];
  const move = { type: 'board-move', seat: 0, id: 'move', from: { column: 2, row: 2 }, point: { column: 3, row: 2 }, speed: 5 };
  reducer.apply(r, player, move);
  const undo = { type: 'board-undo-move', seat: 0, move: 'move' };
  assert.throws(() => reducer.apply(r, { role: 'player', seat: 1 }, undo), /自己/);
  assert.throws(() => reducer.apply(r, player, { ...undo, move: 'old' }), /撤回/);
  r.board.map.pieces.titans[1] = move.from;
  assert.throws(() => reducer.apply(r, player, undo), /原位置/);
  r.board.map.pieces.titans[1] = { column: 5, row: 5 };
  reducer.apply(r, player, undo);
  assert.deepEqual(r.board.map.pieces.titans[0], move.from);
  assert.equal(r.board.lastTitanMove, undefined);
  assert.throws(() => reducer.apply(r, player, undo), /撤回/);
});

test('首要目标按怒气严格超过时转移，平局保留，支持锁定和死亡后转移', () => {
  const r = room();
  const rage = seat => reducer.apply(r, host, { type: 'stat', seat, key: 'rage', delta: 1 });
  rage(0); rage(1);
  assert.deepEqual(r.priorityTarget, { seat: 0, locked: false });
  rage(1);
  assert.deepEqual(r.priorityTarget, { seat: 1, locked: false });
  reducer.apply(r, host, { type: 'priority-target', seat: 0, locked: true });
  rage(1);
  assert.deepEqual(r.priorityTarget, { seat: 0, locked: true });
  reducer.apply(r, host, { type: 'condition', seat: 0, value: 'dead' });
  assert.deepEqual(r.priorityTarget, { seat: 1, locked: false });
});

test('骰子回应只允许队友，且一人可换票或取消', () => {
  const r = room();
  const id = crypto.randomUUID();
  reducer.apply(r, player, { type: 'roll', id, seat: 0, mode: 'attack', counts: { d10: 1 } });
  const react = { type: 'roll-reaction', roll: id, value: 'up' };
  assert.throws(() => reducer.apply(r, player, react), /队友/);
  r.squad = { phase: 'battle', battleNumber: 1, hostSeat: 1 };
  r.heroes[1].player = '原席位玩家';
  reducer.apply(r, host, { ...react, battleNumber: 1 });
  assert.equal(r.rolls[0].reactionPeople.host.player, '原席位玩家');
  reducer.apply(r, host, { ...react, value: 'down', battleNumber: 1 });
  assert.deepEqual(r.rolls[0].reactions, { host: 'down' });
  reducer.apply(r, host, { ...react, value: null, battleNumber: 1 });
  assert.deepEqual(r.rolls[0].reactionPeople, {});
  assert.deepEqual(r.rolls[0].reactions, {});
});

test('一次泰坦移动共享步数，追加、撤回、结束和新回合正确同步', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HEKATON', level: 1 }, 2);
  r.board.map.terrain = [];
  r.board.map.pieces.titans = [{ column: 2, row: 2 }, { column: 5, row: 5 }];
  const point = (column, row = 2) => ({ column, row });
  const move = (id, previous, from, to, speed = 5) => reducer.apply(r, player, {
    type: 'board-move', id, seat: 0, move: previous, from, point: to, speed,
  });
  move('first', null, point(2), point(4));
  assert.equal(r.board.titanMoves[0].remaining, 3);
  assert.throws(() => reducer.apply(r, player, { type: 'board-move', seat: 0,
    from: point(4), point: point(2), speed: 5, move: r.board.titanMoves[0].id }), /不可达/);
  assert.throws(() => move('stale', null, point(4), point(5)), /移动已更新/);
  assert.throws(() => move('over-budget', 'first', point(4), point(8), 20), /不可达/);
  move('second', 'first', point(4), point(6), 20);
  assert.equal(r.board.titanMoves[0].speed, 5);
  assert.equal(r.board.titanMoves[0].remaining, 1);
  assert.deepEqual(r.board.lastTitanMove.route, [2, 3, 4, 5, 6].map(column => point(column)));
  reducer.apply(r, player, { type: 'board-undo-move', seat: 0, move: 'second' });
  assert.deepEqual(r.board.map.pieces.titans[0], point(4));
  assert.equal(r.board.titanMoves[0].remaining, 3);
  assert.equal(r.board.lastTitanMove.id, 'first');
  move('last', 'first', point(4), point(7));
  assert.equal(r.board.titanMoves[0].remaining, 0);
  assert.throws(() => move('over', 'last', point(7), point(8)), /没有剩余/);
  reducer.apply(r, player, { type: 'board-end-move', seat: 0, move: 'last' });
  assert.equal(r.board.titanMoves[0], undefined);
  assert.equal(r.board.lastTitanMove.id, 'last');
  move('next', null, point(7), point(8), 1);
  reducer.apply(r, host, { type: 'round' });
  assert.equal(r.board.titanMoves, undefined);
  assert.equal(r.board.lastTitanMove.id, 'next');
});

test('退出版图模式后保留泰坦选择、移动上限与武器配置', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HEKATON', level: 1 }, 2);
  assert.equal(r.board.los.active, false);
  reducer.apply(r, host, { type: 'board-overlay', overlay: {
    active: false, selectedTitan: 1, titanSpeeds: [5, 7], weaponControls: { kind: 'reach', reach: 3 },
  } });
  assert.equal(r.board.los.active, false);
  assert.equal(r.board.los.mode, '');
  assert.equal(r.board.los.selectedTitan, 1);
  assert.deepEqual(r.board.los.titanSpeeds, [5, 7]);
  assert.equal(r.board.los.weaponControls.reach, 3);
});

test('单个英雄连续掷骰不会挤掉队友的最后一次结果', () => {
  const r = room();
  const other = { role: 'player', seat: 1 };
  reducer.apply(r, other, { type: 'roll', id: 'teammate', seat: 1, mode: 'attack', counts: { d10: 1 } });
  for (let i = 0; i < 35; i++) {
    reducer.apply(r, player, { type: 'roll', id: 'attack-' + i, seat: 0, mode: 'attack', counts: { d10: 1 } });
  }
  assert.equal(r.rolls.length, 30);
  assert.equal(r.rolls[0].id, 'attack-34');
  assert.ok(r.rolls.some(roll => roll.id === 'teammate'));
});

test('只有房主能释放队员席位，英雄和配装留在小队', () => {
  const r = room();
  r.squad = { phase: 'battle', hostSeat: 1, stock: { loadouts: { h0: { titanId: 't' } } } };
  r.secrets = { players: ['member', null] };
  r.heroes[0].player = '队员';
  const release = { type: 'squad-remove-player', seat: 0 };
  assert.throws(() => applySquad(r, player, release, random), /只有房主/);
  assert.throws(() => applySquad(r, host, { ...release, seat: 1 }, random), /没有可移除/);
  applySquad(r, host, release, random);
  assert.deepEqual(r.secrets.players, [null, null]);
  assert.equal(r.heroes[0].player, '');
  assert.equal(r.heroes[0].id, 'h0');
  assert.deepEqual(r.squad.stock.loadouts.h0, { titanId: 't' });
});

test('一键回正本英雄横置的装备、旧忆和样式，弃除牌保留', () => {
  const r = room();
  r.heroes[0].gear = [{ id: 'gear', count: 4, used: 2 }];
  r.heroes[0].mnemos = [{ id: 'memory', state: 'exhausted' }, { id: 'used', state: 'discarded' }];
  r.heroes[0].titan.patternIds = ['pattern', 'used-pattern'];
  reducer.apply(r, player, { type: 'pattern-card', seat: 0, key: 'pattern', value: 'exhausted' });
  reducer.apply(r, player, { type: 'pattern-card', seat: 0, key: 'used-pattern', value: 'discarded' });
  r.heroes[1].gear = [{ id: 'other', count: 1, used: 1 }];
  reducer.apply(r, player, { type: 'gear-card', seat: 0, key: 'gear', slot: 0, value: 'discarded' });
  reducer.apply(r, player, { type: 'gear-card', seat: 0, key: 'gear', slot: 2, value: 'exhausted' });
  assert.throws(() => reducer.apply(r, player, { type: 'gear-ready-all', seat: 1 }), /只能操作自己的英雄/);
  reducer.apply(r, player, { type: 'gear-ready-all', seat: 0 });
  reducer.apply(r, player, { type: 'gear-ready-all', seat: 0 });
  assert.deepEqual(r.heroes[0].gear[0], { id: 'gear', count: 4, used: 1, legacyUsed: 2, cards: { 0: 'discarded', 1: 'ready' } });
  assert.equal(r.heroes[0].mnemos[0].state, 'ready');
  assert.equal(r.heroes[0].mnemos[1].state, 'discarded');
  assert.deepEqual(r.heroes[0].patternCards, { 'used-pattern': 'discarded' });
  assert.equal(r.heroes[1].gear[0].used, 1);
});

test('战斗回顾按真实损伤与表态发称号，保留被旧记录压缩的投掷数量', () => {
  const r = room();
  r.squad = { phase: 'battle', battleNumber: 1, hostSeat: 0 };
  const action = (actor, body) => reducer.apply(r, actor, { battleNumber: 1, ...body });
  const teammate = { role: 'player', seat: 1 };
  action(teammate, { type: 'roll', id: 'teammate', seat: 1, mode: 'attack', counts: { d10: 1 } });
  action(host, { type: 'roll-reaction', roll: 'teammate', value: 'down' });
  action(host, { type: 'roll-reaction', roll: 'teammate', value: 'up' });
  for (let i = 0; i < 33; i++) {
    action(host, { type: 'roll', id: 'host-' + i, seat: 0, mode: 'attack', counts: { d10: 1 } });
  }
  action(host, { type: 'end', damage: [4, null] });
  const { recap } = r.squad;
  assert.equal(recap.mvp, 'h0');
  assert.equal(recap.heroes[0].title, '骇物破壁者');
  assert.equal(recap.heroes[0].rolls, 33);
  assert.equal(recap.heroes[1].title, '全船掌声');
  assert.equal(recap.heroes[1].likes, 1);
  assert.equal(recap.heroes[1].feedback, 1);
});

test('骇物各段共用速度上限，撤回会返还步数，结束保留轨迹', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HEKATON', level: 1 }, 2);
  const pieces = r.board.map.pieces;
  pieces.apostle = { column: 10.5, row: 8.5, facing: 0 };
  const move = (id, column, row, extra) => reducer.apply(r, host, {
    type: 'board-apostle-move', id, from: { ...pieces.apostle }, point: { column, row }, ...extra,
  });
  assert.throws(() => move('over', 17.5, 8.5), /超出骇物剩余步数/);
  move('first', 12.5, 8.5, { speed: 4, move: null });
  assert.equal(r.board.apostleMovement.remaining, 2);
  assert.throws(() => move('over', 12.5, 5.5, { speed: 20, move: 'first' }), /超出骇物剩余步数/);
  move('second', 12.5, 6.5, { move: 'first' });
  assert.equal(r.board.apostleMovement.remaining, 0);
  reducer.apply(r, host, { type: 'board-apostle-undo', move: 'second' });
  assert.equal(r.board.apostleMovement.remaining, 2);
  assert.deepEqual(pieces.apostle, { column: 12.5, row: 8.5, facing: 0 });
  reducer.apply(r, host, { type: 'board-apostle-end', move: 'first' });
  assert.equal(r.board.apostleMovement, undefined);
  assert.equal(r.board.lastApostleMove.route.length, 3);
});

test('只统计玩家为威力投掷选择的伤口，改判不会重复累加', () => {
  const r = room();
  r.squad = { phase: 'battle', battleNumber: 1, hostSeat: 1 };
  const action = (actor, body) => reducer.apply(r, actor, { battleNumber: 1, ...body });
  const power = id => action(player, { type: 'roll', id, seat: 0, mode: 'power', counts: { red: 1 } });
  power('unselected');
  power('selected');
  const wound = value => ({ type: 'roll-wounds', seat: 0, roll: 'selected', value });
  assert.throws(() => action({ role: 'player', seat: 1 }, wound(2)), /只能操作自己的英雄/);
  action(player, wound(1));
  action(player, wound(2));
  action(player, wound(2));
  for (let i = 0; i < 33; i++) power('next-' + i);
  action(host, { type: 'end' });
  assert.equal(r.squad.recap.heroes[0].damage, 2);
  assert.equal(r.squad.recap.heroes[1].damage, 0);
});

test('回合由首个主动行动认领，其他队员的操作不会抢走回合', () => {
  const r = room();
  const teammate = { role: 'player', seat: 1 };
  const reader = { role: 'viewer' };
  const turn = (actor, type, fields = {}) => reducer.apply(r, actor, { type, round: r.round, phase: r.turn?.phase ?? null, ...fields });
  turn(host, 'turn-phase', { value: 'apostle' });
  assert.throws(() => turn(player, 'turn-phase', { value: 'titans' }), /房主/);
  assert.throws(() => turn(player, 'turn-take', { seat: 0 }), /骇物轮次/);
  turn(host, 'turn-phase', { value: 'titans' });
  reducer.apply(r, player, { type: 'roll', id: 'dodge', seat: 0, mode: 'dodge', counts: { d10: 1 } });
  assert.equal(r.turn.seat, null);
  reducer.apply(r, teammate, { type: 'roll', id: 'attack', seat: 1, mode: 'attack', counts: { d10: 1 } });
  assert.equal(r.turn.seat, 1);
  assert.throws(() => turn(player, 'turn-take', { seat: 0 }), /已被认领/);
  assert.throws(() => turn(reader, 'turn-finish', { seat: 1 }), /只能查看/);
  assert.throws(() => turn(host, 'round'), /尚未结束/);
  turn(teammate, 'turn-finish', { seat: 1 });
  assert.throws(() => turn(teammate, 'turn-take', { seat: 1 }), /已经结束/);
  turn(player, 'turn-take', { seat: 0 });
  turn(player, 'turn-finish', { seat: 0 });
  turn(host, 'round');
  assert.equal(r.round, 2);
  assert.deepEqual(r.turn, { phase: 'apostle', seat: null, finished: [] });
});

test('普通攻击及威力检查回合，额外攻击威力继承来源且不会认领回合', () => {
  const r = room();
  r.turn = { phase: 'titans', seat: 0, finished: [] };
  const teammate = { role: 'player', seat: 1 };
  const roll = (seat, id, mode, counts, extra = {}) => reducer.apply(r, seat ? teammate : player,
    { type: 'roll', id, mode, seat, counts, ...extra });
  assert.throws(() => roll(1, 'blocked', 'attack', { d10: 1 }), /该泰坦可行动/);
  assert.throws(() => roll(1, 'blocked-power', 'power', { red: 1 }), /该泰坦可行动/);
  assert.throws(() => roll(1, 'fake-power', 'power', { red: 1 }, { extraAttack: true }), /请先声明/);
  assert.equal(r.rolls.length, 0);
  roll(0, 'ordinary', 'attack', { d10: 1 });
  roll(0, 'ordinary-power', 'power', { red: 1 }, { parentRoll: 'ordinary' });
  roll(1, 'dodge', 'dodge', { d10: 1 });
  roll(1, 'armor', 'defense', { red: 1 }, { parentRoll: 'dodge' });
  assert.equal(r.turn.seat, 0);
  roll(1, 'extra', 'attack', { d10: 1 }, { extraAttack: true });
  roll(1, 'extra-power', 'power', { red: 1 }, { parentRoll: 'extra' });
  assert.equal(r.rolls[0].extraAttack, true);
  assert.equal(r.turn.seat, 0);
  r.turn.finished.push(0);
  r.turn.seat = null;
  assert.throws(() => roll(0, 'finished-power', 'power', { red: 1 }, { parentRoll: 'ordinary' }), /该泰坦可行动/);
  const ordinary = r.rolls.find(entry => entry.id === 'ordinary');
  assert.throws(() => reducer.apply(r, player, { type: 'reroll', seat: 0, roll: ordinary.id,
    ids: [ordinary.dice[0].id] }), /无法调整/);
  r.turn.phase = 'apostle';
  assert.throws(() => roll(1, 'boss-turn', 'attack', { d10: 1 }), /该泰坦可行动/);
  roll(1, 'boss-turn-extra', 'attack', { d10: 1 }, { extraAttack: true });
  assert.equal(r.turn.seat, null);
});

test('泰坦回合可插入招牌技并结算移动，保留现有行动席位和移动进度', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HERMESIAN_PURSUER', level: 1 }, 2);
  r.turn = { phase: 'titans', seat: 0, finished: [1] };
  r.projection = { signature: 'ps/HERMESIAN_PURSUER/SIGNATURE.jpg', aiPending: false };
  r.board.map.pieces.apostle = { column: 2.5, row: 2.5, facing: 0 };
  r.board.map.pieces.titans = [{ column: 7, row: 4 }, { column: 4, row: 2 }];
  const titanMoves = { 0: { id: 'active-titan' } };
  r.board.titanMoves = titanMoves;
  const act = (actor, value, fields = {}) => reducer.apply(r, actor,
    { type: 'ai-guide', round: 1, phase: 'titans', value, ...fields });
  const move = (fields) => reducer.apply(r, host, fields);
  const originalTurn = structuredClone(r.turn);
  assert.throws(() => act(player, 'signature-begin', { id: 'player-signature' }), /房主/);
  act(host, 'signature-begin', { id: 'signature-a' });
  assert.equal(r.turn.aiGuide, 'signature-target');
  assert.throws(() => act(host, 'signature-begin', { id: 'duplicate' }), /已变化/);
  assert.throws(() => act(host, 'signature-target', { signatureId: 'expired', target: 0 }), /已变化/);
  act(host, 'signature-target', { signatureId: 'signature-a', target: 0 });
  assert.equal(r.turn.seat, 0);
  assert.deepEqual(r.turn.finished, [1]);
  const route = guide.apostleRoutes(r, 1, terrain, los).find(path => path.id === 'horizontal-first');
  move({ type: 'board-ai-route', id: 'signature-move', reach: 1, route: route.id, stamp: guide.routeStamp(r, route) });
  assert.equal(r.turn.aiMovement.pending, true);
  assert.throws(() => act(host, 'signature-resolve', { signatureId: 'signature-a' }), /先处理并确认/);
  move({ type: 'board-ai-trample-confirm', move: 'signature-move' });
  act(host, 'signature-resolve', { signatureId: 'signature-a' });
  assert.deepEqual(r.turn, originalTurn);
  assert.strictEqual(r.board.titanMoves, titanMoves);
  assert.equal(r.board.lastApostleMove.id, 'signature-move');
  act(host, 'signature-begin', { id: 'signature-b' });
  act(host, 'signature-target', { signatureId: 'signature-b', target: null });
  act(host, 'signature-resolve', { signatureId: 'signature-b' });
  assert.deepEqual(r.turn, originalTurn);
});

test('骇物轮次的非主动移动可经过其他泰坦，单独记步且不认领回合', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HEKATON', level: 1 }, 2);
  const pieces = r.board.map.pieces;
  pieces.titans = [{ column: 2, row: 2 }, { column: 3, row: 2 }];
  reducer.apply(r, host, { type: 'turn-phase', phase: null, round: 1, value: 'apostle' });
  reducer.apply(r, player, { type: 'board-move', id: 'push', seat: 0, from: { column: 2, row: 2 },
    point: { column: 4, row: 2 }, speed: 2 });
  assert.equal(r.turn.seat, null);
  assert.equal(r.board.titanMoves, undefined);
  assert.deepEqual(r.board.forcedTitanMoves[0].route, [2, 3, 4].map(column => ({ column, row: 2 })));
  reducer.apply(r, player, { type: 'board-undo-move', seat: 0, move: 'push' });
  assert.deepEqual(pieces.titans[0], { column: 2, row: 2 });
  reducer.apply(r, host, { type: 'turn-phase', phase: 'apostle', round: 1, value: 'titans' });
  reducer.apply(r, player, { type: 'board-move', id: 'active', seat: 0, from: { column: 2, row: 2 },
    point: { column: 2, row: 3 }, speed: 2 });
  assert.equal(r.turn.seat, 0);
  assert.equal(r.board.titanMoves[0].remaining, 1);
});

test('推荐移动执行所选逐格路线，冲撞待确认时保留标记并阻止推进', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HERMESIAN_PURSUER', level: 1 }, 2);
  r.turn = { phase: 'apostle', seat: null, finished: [], aiGuide: 'resolve', aiTarget: 0 };
  const pieces = r.board.map.pieces;
  const origin = { column: 2.5, row: 2.5, facing: 270 };
  pieces.apostle = { ...origin };
  pieces.titans = [{ column: 7, row: 4 }, { column: 4, row: 2 }];

  const [safe, collision] = guide.apostleRoutes(r, 1, terrain, los);
  assert.equal(safe.id, 'vertical-first');
  assert.deepEqual(safe.crossedSeats, []);
  assert.equal(collision.id, 'horizontal-first');
  assert.deepEqual(collision.crossedSeats, [1]);
  assert.deepEqual(collision.endSeats, []);
  const action = { type: 'board-ai-route', id: 'guided', reach: 1, route: collision.id, stamp: guide.routeStamp(r, collision) };
  assert.throws(() => reducer.apply(r, player, action), /房主/);
  assert.throws(() => reducer.apply(r, host, { ...action, stamp: 'stale' }), /路线已更新/);
  assert.deepEqual(pieces.apostle, origin);

  reducer.apply(r, host, action);
  assert.deepEqual(r.board.lastApostleMove.route, collision.centers);
  assert.deepEqual(pieces.apostle, { ...collision.finalCenter, facing: collision.facing });
  assert.equal(r.turn.aiMovement.pending, true);
  assert.deepEqual(r.turn.aiMovement.crossedSeats, [1]);
  assert.equal(r.heroes[1].condition, 'standing');
  assert.equal(r.heroes[1].stats.danger, 0);
  assert.throws(() => reducer.apply(r, host, action), /已经执行过/);

  reducer.apply(r, host, { type: 'board-apostle-undo', move: action.id });
  assert.deepEqual(pieces.apostle, origin);
  assert.equal(r.turn.aiMovement, undefined);
  reducer.apply(r, host, { ...action, id: 'retried', stamp: guide.routeStamp(r, collision) });
  const finish = { type: 'ai-guide', round: 1, phase: 'apostle', value: 'resolve' };
  assert.throws(() => reducer.apply(r, host, finish), /先处理并确认/);
  assert.throws(() => reducer.apply(r, host, { type: 'board-ai-trample-confirm', move: 'guided' }), /已更新/);
  reducer.apply(r, host, { type: 'board-ai-trample-confirm', move: 'retried' });
  assert.equal(r.turn.aiMovement.pending, false);
  reducer.apply(r, host, finish);
  assert.equal(r.turn.aiGuide, 'other');
  assert.equal(r.turn.aiMovement, undefined);
  assert.equal(r.board.apostleMovement, undefined);
  assert.deepEqual(r.board.lastApostleMove.route, collision.centers);
});

test('截图版图的常规路线只有横向和纵向起步，地形不改变最短路线', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HERMESIAN_PURSUER', level: 1 }, 2);
  r.turn = { phase: 'apostle', aiGuide: 'resolve', aiTarget: 1 };
  r.board.map.pieces.apostle = { column: 8.5, row: 6.5, facing: 180 };
  r.board.map.pieces.titans = [{ column: 8, row: 5 }, { column: 13, row: 5 }];
  const withTerrain = guide.apostleRoutes(r, 1, terrain, los);
  assert.deepEqual(withTerrain.map(path => [path.id, path.steps, path.crossedSeats]), [
    ['horizontal-first', 4, []], ['vertical-first', 4, [0]],
  ]);
  const coords = centers => centers.map(({ column, row }) => [column, row]);
  assert.deepEqual(coords(withTerrain[0].centers), [[8.5, 6.5], [9.5, 6.5], [9.5, 5.5], [10.5, 5.5], [11.5, 5.5]]);
  assert.deepEqual(coords(withTerrain[1].centers), [[8.5, 6.5], [8.5, 5.5], [9.5, 5.5], [10.5, 5.5], [11.5, 5.5]]);
  assert(r.board.map.terrain.length > 0);
  r.board.map.terrain = [];
  assert.deepEqual(guide.apostleRoutes(r, 1, terrain, los), withTerrain);
});

test('推荐移动从已走路线接续换轴，拒绝未对齐时连续同轴的前缀', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HERMESIAN_PURSUER', level: 1 }, 2);
  r.turn = { phase: 'apostle', seat: null, finished: [], aiGuide: 'resolve', aiTarget: 0 };
  const start = { column: 2.5, row: 2.5 };
  const right = { column: 3.5, row: 2.5 };
  const again = { column: 4.5, row: 2.5 };
  r.board.map.pieces.apostle = { ...start, facing: 90 };
  r.board.map.pieces.titans = [{ column: 9, row: 6 }, { column: 19, row: 9 }];

  const shortest = guide.apostleRoutes(r, 1, terrain, los).find(path => path.id === 'horizontal-first');
  reducer.apply(r, host, { type: 'board-apostle-move', id: 'right', from: start, point: right, speed: 6 });
  const [continuation] = guide.apostleRoutes(r, 1, terrain, los);
  assert.equal(guide.apostleRoutes(r, 1, terrain, los).length, 1);
  assert.equal(continuation.firstFacing, 0);
  assert.deepEqual(continuation.centers, shortest.centers.slice(1, 7));
  assert.equal(continuation.stopReason, 'speed-limit');
  reducer.apply(r, host, { type: 'board-apostle-move', id: 'again', from: right, point: again, move: 'right' });
  assert.deepEqual(guide.apostleRoutes(r, 1, terrain, los), []);
  reducer.apply(r, host, { type: 'board-apostle-undo', move: 'again' });
  const [valid] = guide.apostleRoutes(r, 1, terrain, los);
  reducer.apply(r, host, { type: 'board-ai-route', id: 'continue', reach: 1, route: valid.id, stamp: guide.routeStamp(r, valid) });
  assert.deepEqual(r.board.lastApostleMove.route, shortest.centers.slice(0, 7));
  assert.equal(r.board.apostleMovement.remaining, 0);
});

test('手动结束骇物移动后，本次指令技不重新推荐或补发速度', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HERMESIAN_PURSUER', level: 1 }, 2);
  r.turn = { phase: 'apostle', seat: null, finished: [], aiGuide: 'resolve', aiTarget: 0 };
  const start = { column: 2.5, row: 2.5 };
  r.board.map.pieces.apostle = { ...start, facing: 90 };
  r.board.map.pieces.titans = [{ column: 9, row: 6 }, { column: 19, row: 9 }];
  reducer.apply(r, host, { type: 'board-apostle-move', id: 'manual', from: start, point: { column: 3.5, row: 2.5 }, speed: 1 });
  reducer.apply(r, host, { type: 'board-apostle-end', move: 'manual' });
  assert.equal(r.turn.aiManualMovementEnded, true);
  assert.deepEqual(guide.apostleRoutes(r, 1, terrain, los), []);
  reducer.apply(r, host, { type: 'ai-guide', phase: 'apostle', round: 1, value: 'resolve' });
  assert.equal(r.turn.aiManualMovementEnded, undefined);
  assert.equal(r.board.lastApostleMove.id, 'manual');
});

test('目标已在远程攻击范围内时只调整朝向，招牌技也可使用推荐移动', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HERMESIAN_PURSUER', level: 1 }, 2);
  r.turn = { phase: 'apostle', seat: null, finished: [], aiGuide: 'hope-resolve', aiTarget: 0 };
  r.board.map.pieces.apostle = { column: 2.5, row: 2.5, facing: 270 };
  r.board.map.pieces.titans = [{ column: 4, row: 4 }, { column: 9, row: 9 }];
  const [route] = guide.apostleRoutes(r, 2, terrain, los);
  assert.equal(route.steps, 0);
  assert.equal(route.facing, 90);
  reducer.apply(r, host, { type: 'board-ai-route', id: 'turn-only', reach: 2, route: route.id, stamp: guide.routeStamp(r, route) });
  assert.deepEqual(r.board.map.pieces.apostle, { column: 2.5, row: 2.5, facing: 90 });
  assert.equal(r.turn.aiMovement.pending, false);
  assert.equal(r.board.apostleMovement, undefined);
});

test('版图点位由房主或队员标记，经校验且不改变棋子、移动或回合', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HEKATON', level: 1 }, 2);
  r.turn = { phase: 'titans', seat: null, finished: [] };
  r.heroes[0].player = '点位测试';
  const board = structuredClone(r.board);
  const mark = { type: 'board-ping', id: 'first', point: { column: 20, row: 1 }, by: '伪造姓名' };
  assert.throws(() => reducer.apply(r, { role: 'viewer' }, mark), /只能查看/);
  assert.throws(() => reducer.apply(r, player, { ...mark, point: { column: 20, row: 0 } }), /有效/);
  const now = Date.now();
  reducer.apply(r, player, mark);
  assert.equal(r.boardPing.by, '点位测试');
  assert.ok(r.boardPing.expiresAt >= now + 12000);
  assert.deepEqual(r.board, board);
  assert.equal(r.turn.seat, null);
  reducer.apply(r, host, { ...mark, id: 'second', point: { column: 1, row: 14 } });
  assert.equal(r.boardPing.id, 'second');
  assert.equal(r.boardPing.by, '房主');
  const replacement = { type: 'board-layout', map: r.board.map, layoutRevision: r.board.layoutRevision };
  reducer.apply(r, host, replacement);
  assert.equal(r.boardPing, undefined);
});

test('绝望和神浆独立计数，可从旧状态直接增加，队员不能修改其他英雄', () => {
  const r = room();
  const change = (actor, key, delta, seat = 0) => reducer.apply(r, actor, { type: 'titan-marker', key, delta, seat });
  const original = structuredClone(r.heroes[0].stats);
  change(player, 'despair', 1);
  change(host, 'ambrosia', 1);
  change(player, 'despair', -1);
  assert.throws(() => change(player, 'despair', -1), /范围|上限|下限/);
  assert.throws(() => change(player, 'ambrosia', 1, 1), /自己的英雄/);
  assert.throws(() => change(host, 'danger', 1), /未知/);
  assert.deepEqual(r.heroes[0].markers, { despair: 0, ambrosia: 1 });
  assert.deepEqual(r.heroes[0].stats, original);
  assert.equal(r.heroes[1].markers, undefined);
});

test('武器基础攻击骰与每次命中／单次奖励威力分别读取', () => {
  const [count, perHit, bonus] = gearRolls.weapons.AJ0247;
  assert.equal(count, 2);
  assert.deepEqual(gearRolls.power(perHit, bonus, 2), { red: 3, black: 0, white: 0, raw: 0 });
  assert.deepEqual(gearRolls.power('b', 'r+', 2), { red: 1, black: 2, white: 0, raw: 1 });
  assert.deepEqual(gearRolls.power(perHit, bonus, 0), { red: 0, black: 0, white: 0, raw: 0 });
  assert.equal(gearRolls.weapons.BJ0900[1], undefined);
  assert.deepEqual(gearRolls.defenseKeywords.AJ0211, ['格挡 1']);
});

test('攻击保存当前英雄的武器，护甲可接在无预填防御骰的闪避之后', () => {
  const r = room();
  r.heroes[0].gear.push({ id: 'AJ0247', count: 1, used: 0 });
  const roll = (id, mode, counts, extra = {}) => reducer.apply(r, player, { type: 'roll', id, seat: 0, mode, counts, ...extra });
  assert.throws(() => roll('bad-weapon', 'attack', { d10: 2 }, { weapon: 'AJ0181' }), /装备的武器/);
  roll('weapon-attack', 'attack', { d10: 2 }, { weapon: 'AJ0247' });
  assert.equal(r.rolls[0].weapon, 'AJ0247');
  roll('weapon-power', 'power', { red: 3 }, { parentRoll: 'weapon-attack' });
  assert.equal(r.rolls[0].parentRoll, 'weapon-attack');
  roll('evade', 'dodge', { d10: 2 });
  roll('armor', 'defense', { red: 1, black: 1, white: 1 }, { parentRoll: 'evade' });
  assert.deepEqual(r.rolls[0].dice.map(die => die.kind), ['red', 'black', 'white']);
  const total = r.rolls[0].dice.reduce((sum, die) => sum + dice.naturalFace(die)[1], 0);
  assert.equal(dice.rollSummary(r.rolls[0]), total + ' 潜力 · 减免 ' + total + ' 凶险');
  assert.equal(dice.rollSummary({ mode: 'defense', dice: [{ kind: 'red', face: 3 }] }), '0 潜力 · 减免 0 凶险');
  assert.equal(dice.rollSummary({ mode: 'defense', dice: [{ kind: 'red', face: 2 }] }), '1 潜力 · 减免 1 凶险');
  assert.throws(() => roll('duplicate', 'defense', { red: 1 }, { parentRoll: 'evade' }), /已结算/);
  assert.throws(() => reducer.apply(r, player, { type: 'reroll', seat: 0, roll: 'armor',
    ids: [r.rolls[0].dice[0].id] }), /护甲投掷不能重掷/);
  assert.throws(() => reducer.apply(r, player, { type: 'convert', seat: 0, roll: 'armor',
    die: r.rolls[0].dice[0].id, symbol: 'potential' }), /只计潜力/);
  for (let i = 0; i < 31; i++) {
    reducer.apply(r, { role: 'player', seat: 1 }, { type: 'roll', id: 'teammate-' + i, seat: 1, mode: 'check', counts: { d10: 1 } });
  }
  assert.equal(r.rolls.find(entry => entry.id === 'armor').parentRoll, 'evade');
  assert.equal(r.rolls.find(entry => entry.id === 'evade').defenseRoll, 'armor');
});

test('only a white ten in an attack or dodge earns the matching critical badge', () => {
  const whiteTen = { kind: 'crit', value: 10 };
  assert.equal(dice.criticalLabel('attack', whiteTen), '关键命中');
  assert.equal(dice.criticalLabel('dodge', whiteTen), '关键闪避');
  assert.equal(dice.criticalLabel('check', whiteTen), '');
  assert.equal(dice.criticalLabel('attack', { kind: 'd10', value: 10 }), '');
  assert.equal(dice.criticalLabel('dodge', { kind: 'crit', value: 9 }), '');
  assert.equal(dice.criticalLabel('dodge', { ...whiteTen, rerolled: true }), '关键闪避');
});

test('ordinary d6 uses standard pip locations for every face', () => {
  const expected = ['2/2', '1/1 3/3', '1/1 2/2 3/3', '1/1 1/3 3/1 3/3',
    '1/1 1/3 2/2 3/1 3/3', '1/1 1/3 2/1 2/3 3/1 3/3'];
  for (const [index, positions] of expected.entries()) {
    const value = index + 1;
    const markup = dice.faceMarkup({ kind: 'armor', value }, '');
    assert.match(markup, new RegExp('aria-label="普通 d6 ' + value + '"'));
    assert.equal([...markup.matchAll(/grid-area:([^"]+)/g)].map(match => match[1]).join(' '), positions);
  }
  assert.equal(dice.faceMarkup({ kind: 'armor', value: 7 }, ''), '');
});

test('循环一逐步结算由房主确认，核对牌面并洗回空的指令技牌堆', () => {
  for (const apostle of ['HEKATON', 'LABYRINTHAUROS', 'HERMESIAN_PURSUER', 'ALPHA_TEMENOS']) {
    const r = room();
    r.board = api.setupRoomBoard({ apostle, level: 1 }, 2);
    const src = 'ps/' + apostle + '/' + apostle + '_AI_I_001.jpg';
    const card = { fileName: src.split('/').at(-1), level: 'I', _room: { face: { src, label: 'AI I 001' } } };
    const pile = deck => ({ deck, discard: [], removed: [], supply: {} });
    r.battleDeck = api.prepareRoomDeck({ apostle, AI: pile([card]), BP: pile([]), lastRevealed: {}, tokens: [] }, apostle);
    const apply = (actor, type, fields = {}) => reducer.apply(r, actor, {
      id: crypto.randomUUID(), type, round: r.round, phase: r.turn?.phase ?? null, ...fields,
    });
    const confirm = value => apply(host, 'ai-guide', { value });
    apply(host, 'turn-phase', { value: 'apostle' });
    assert.throws(() => apply(player, 'ai-guide', { value: 'begin' }), /房主/);
    confirm('begin');
    assert.throws(() => confirm('target'), /步骤/);
    assert.throws(() => apply(host, 'turn-phase', { value: 'titans' }), /逐步结算/);
    for (let pass = 0; pass < 2; pass++) {
      apply(host, 'ai-request');
      assert.equal(r.turn.aiGuide, 'target');
      assert.equal(r.projection.aiPending, true);
      assert.throws(() => apply(host, 'ai-guide-discard', { card: src }), /无法弃置/);
      assert.throws(() => confirm('target'), /目标/);
      apply(host, 'ai-guide', { value: 'target', target: 1 });
      assert.equal(r.turn.aiGuide, 'resolve');
      assert.equal(r.turn.aiTarget, 1);
      assert.throws(() => apply(host, 'ai-guide-discard', { card: src.replace('001', '002') }), /指令技已更新/);
      apply(host, 'ai-guide-discard', { card: src });
      assert.equal(r.turn.aiGuide, 'other');
      assert.equal(r.projection.aiPending, false);
      assert.equal(r.projection.aiDeck.count, 1);
      if (pass === 0) confirm('extra');
    }
    if (apostle === 'HERMESIAN_PURSUER') {
      r.projection.hopeEnds = true;
      r.projection.signature = 'ps/HERMESIAN_PURSUER/HERMESIAN_PURSUER_SIGNATURE_X_001.jpg';
      assert.throws(() => apply(host, 'turn-phase', { value: 'titans' }), /逐步结算/);
      confirm('hope');
      assert.equal(r.turn.aiGuide, 'hope-target');
      apply(host, 'ai-guide', { value: 'hope-target', target: 0 });
      assert.equal(r.turn.aiGuide, 'hope-resolve');
      confirm('hope-resolve');
      assert.equal(r.turn.aiGuide, 'ready');
      assert.equal(r.battleDeck.data.AI.deck.length, 1, '招牌技不进入指令技牌堆');
    }
    apply(host, 'turn-phase', { value: 'titans' });
    assert.equal(r.turn.phase, 'titans');
    assert.equal(r.turn.aiGuide, undefined);
  }
});


test('轮次上一步恢复目标、位置和牌堆，其他行动或旧版本提交不能回滚', () => {
  const { captureTurnUndo, canUndoTurn, undoTurn } = api;
  const host = { role: 'host' };
  const room = { revision: 7, turn: { phase: 'apostle', aiGuide: 'target' },
    board: { layoutRevision: 2, map: { column: 4 } },
    battleDeck: { revision: 3, operation: 'draw', data: ['A', 'B'] },
    projection: { aiPending: true } };
  const saved = captureTurnUndo(room, host, { type: 'ai-guide-discard' });
  assert.equal(captureTurnUndo(room, host, { type: 'roll' }), null);
  assert.equal(captureTurnUndo(room, { role: 'player' }, { type: 'turn-finish' }), null);
  room.turnUndo = saved;
  room.revision = 8;
  room.turn.aiGuide = 'other';
  room.board.layoutRevision = 3;
  room.board.map.column = 8;
  room.battleDeck.revision = 4;
  room.battleDeck.data.shift();
  room.projection.aiPending = false;
  assert.equal(canUndoTurn(room), true);
  assert.throws(() => undoTurn(room, { role: 'player' }, { revision: 8 }), { status: 403 });
  assert.throws(() => undoTurn(room, host, { revision: 7 }), { status: 409 });
  undoTurn(room, host, { id: 'undo', revision: 8 });
  assert.equal(room.turn.aiGuide, 'target');
  assert.deepEqual(room.board, { layoutRevision: 4, map: { column: 4 } });
  assert.deepEqual(room.battleDeck, { revision: 5, operation: 'undo', data: ['A', 'B'] });
  assert.equal(room.projection.aiPending, true);
  room.revision++;
  assert.equal(canUndoTurn(room), false);
});
