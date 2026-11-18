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
    export { applySquad } from './worker/room-squad.js';
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
const { BattleRoom, createTrauma, applyTrauma, traumaView, applySquad } = api;
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
  assert.equal(r.heroes[0].condition, 'standing'); assert.equal(r.heroes[0].stats.danger, 0);
  assert.equal(r.trauma.highestDanger, 0); assert.equal(r.trauma.drawn.length, 0);
  assert.deepEqual(r.heroes[0].storyStats, { danger: 2, rage: 3, fate: 4 });
});

test('骇物允许落到泰坦和地形所在格，路线只走正交步', () => {
  const r = room();
  r.board = api.setupRoomBoard({ apostle: 'HEKATON', level: 1 }, 2);
  const pieces = r.board.map.pieces;
  r.board.map.terrain = [{ id: 'obstacle', name: 'Column', column: 2, row: 2, rotation: 0 }];
  pieces.apostle = { column: 10.5, row: 8.5, facing: 90 };
  pieces.titans[0] = { column: 2, row: 2 };
  const point = { column: 2.5, row: 2.5 };
  reducer.apply(r, host, { type: 'board-apostle-move', from: pieces.apostle, point });
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
