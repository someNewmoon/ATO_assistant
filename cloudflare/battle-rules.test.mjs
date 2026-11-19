import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Exercise the real Worker reducers; only the Cloudflare base class is replaced.
// Run: cd cloudflare && node --test battle-rules.test.mjs
const bundled = await build({
  stdin: { contents: `export { BattleRoom } from './worker/battle-room.js';
    export { createTrauma, applyTrauma, traumaView } from './worker/room-trauma.js';
    export { applySquad, syncCampaignStock } from './worker/room-squad.js';
    export { setupRoomBoard } from './worker/board.js';`, resolveDir: import.meta.dirname },
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

test('投掷者能请求揭示 BP，只有房主领取一次，推出的牌更新同步状态', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HEKATON', level: 1 }, 2);
  r.turn = { phase: 'apostle', seat: null, finished: [] };
  const action = { type: 'bp-request', round: 1, id: 'request' };
  assert.throws(() => reducer.apply(r, player, action), /泰坦回合/);
  r.turn.phase = 'titans';
  reducer.apply(r, player, action);
  assert.equal(r.turn.seat, 0);
  const claim = { type: 'bp-claim', request: 'request', id: 'claim' };
  assert.throws(() => reducer.apply(r, player, claim), /房主/);
  reducer.apply(r, host, claim);
  assert.throws(() => reducer.apply(r, host, { ...claim, id: 'another' }), /正在处理/);
  reducer.apply(r, host, { type: 'bp-result', request: 'request', claim: 'claim',
    projection: { apostle: 'HEKATON', bpPending: true, bp: { src: 'ps/HEKATON/HEKATON_BP_I_001.jpg' } } });
  assert.equal(r.projection.bpPending, true);
  assert.equal(r.bpRequest, undefined);
});

test('部位牌的三个结果只结算当前威力投掷，开启第二能力时段并保留克拉托斯标记', () => {
  for (const [outcome, damage] of [[0, 0], [1, 1], [2, 2], [2, 1]]) {
    const r = room();
    r.board = api.setupRoomBoard({ apostle: 'HEKATON', level: 1 }, 2);
    r.turn = { phase: 'titans', seat: 0, finished: [] };
    r.pool = { opening: 3 };
    r.rolls = [{ id: 'power', mode: 'power', seat: 0, round: 1 }];
    const card = 'ps/HEKATON/HEKATON_BP_I_001.jpg';
    const signature = 'ps/HEKATON/HEKATON_SIGNATURE_X_001.jpg';
    const projection = { apostle: 'HEKATON', bp: { src: card }, bpPending: true, signature, damage: { total: 1 } };
    reducer.apply(r, host, { type: 'room-projection', projection });
    const settle = { type: 'bp-settle', id: 'settle', round: 1, card, roll: 'power', value: outcome };
    assert.throws(() => reducer.apply(r, player, { ...settle, roll: 'stale' }), /最新/);
    assert.throws(() => reducer.apply(r, player, { ...settle, card: 'another-card' }), /核对/);
    assert.throws(() => reducer.apply(r, { role: 'player', seat: 1 }, settle), /自己的泰坦回合/);
    reducer.apply(r, player, settle);
    reducer.apply(r, host, { type: 'bp-claim', request: settle.id, id: 'claim' });
    reducer.apply(r, host, { type: 'bp-result', request: settle.id, claim: 'claim',
      projection: { ...projection, bpPending: false, damage: { total: 1 + damage } } });
    assert.equal(r.projection.bp.src, card);
    assert.equal(r.projection.bpPending, false);
    assert.equal(r.projection.signature, signature);
    assert.equal(r.rolls[0].bpOutcome, outcome);
    assert.equal(r.rolls[0].wounds, damage);
    assert.equal(r.battleStats[0].damage, damage);
    assert.equal(r.pool.opening, 3);
    assert.deepEqual(r.secondAbility, { id: 'settle', roll: 'power', seat: 0, round: 1 });
    assert.throws(() => reducer.apply(r, player, { type: 'roll-wounds', roll: 'power', value: 2, seat: 0 }), /已结算/);
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

test('一键回正只改变本英雄横置的装备，兼容旧存档的已用数量', () => {
  const r = room();
  r.heroes[0].gear = [{ id: 'gear', count: 4, used: 2 }];
  r.heroes[0].mnemos = [{ id: 'memory', state: 'exhausted' }];
  r.heroes[1].gear = [{ id: 'other', count: 1, used: 1 }];
  reducer.apply(r, player, { type: 'gear-card', seat: 0, key: 'gear', slot: 0, value: 'discarded' });
  reducer.apply(r, player, { type: 'gear-card', seat: 0, key: 'gear', slot: 2, value: 'exhausted' });
  assert.throws(() => reducer.apply(r, player, { type: 'gear-ready-all', seat: 1 }), /只能操作自己的英雄/);
  reducer.apply(r, player, { type: 'gear-ready-all', seat: 0 });
  reducer.apply(r, player, { type: 'gear-ready-all', seat: 0 });
  assert.deepEqual(r.heroes[0].gear[0], { id: 'gear', count: 4, used: 1, legacyUsed: 2, cards: { 0: 'discarded', 1: 'ready' } });
  assert.equal(r.heroes[0].mnemos[0].state, 'exhausted');
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
