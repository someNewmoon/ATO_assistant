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
    export { applySquad } from './worker/room-squad.js';`, resolveDir: import.meta.dirname },
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
