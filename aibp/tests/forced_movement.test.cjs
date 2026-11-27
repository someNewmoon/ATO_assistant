const test = require("node:test");
const assert = require("node:assert/strict");
require("../boss-levels-data.js");
const forced = require("../forced-movement.js");
const los = require("../battle_los.js");
const terrain = require("../../ss/terrain-data.js");

const point = (column, row) => ({ column, row });
const tile = (name, column, row, rotation = 0) => ({ name, column, row, rotation, flipped: false });
const room = (boss, titans, tiles = []) => ({
  board: { apostle: "HERMESIAN_PURSUER", level: 1, layoutRevision: 0, map: {
    pieces: { apostle: { ...boss, facing: 180 }, titans },
    terrain: tiles,
  } },
  heroes: titans.map(() => ({ condition: "standing" })),
});
const move = (state, kind, amount, input = {}) =>
  forced.plan(state, { kind, amount, source: "apostle", target: 0, ...input }, terrain, los);

test("large moth wings knockback uses the final two spaces along the east edge", () => {
  const state = room(point(10.5, 7.5), [point(12, 7)]);
  const plan = move(state, "knockback", 10, { trigger: "bp" });
  assert.equal(plan.used, 10);
  assert.deepEqual(plan.targetPath.slice(-3), [point(20, 7), point(20, 6), point(20, 5)]);
  assert.equal(plan.sourcePath.length, 1);
  assert.equal(plan.positions.apostle.facing, 180);
});

test("diagonal knockback accepts either displayed direction and retains the alternatives", () => {
  const state = room(point(10.5, 7.5), [point(13, 5)]);
  const initial = move(state, "knockback", 4);
  assert.deepEqual(initial.pending.options.map(option => option.id), ["right", "down"]);
  for (const [choice, destination] of [["right", point(17, 5)], ["down", point(13, 1)]]) {
    const resolved = move(state, "knockback", 4, { choices: [choice] });
    assert.equal(resolved.pending, undefined);
    assert.deepEqual(resolved.decisions, [initial.pending]);
    assert.deepEqual(resolved.targetPath.at(-1), destination);
  }
});

test("a chosen knockback direction can be followed by a separate displacement choice", () => {
  const state = room(point(10.5, 7.5), [point(13, 5), point(13, 1)]);
  const landing = move(state, "knockback", 4, { choices: ["down"] });
  assert.equal(landing.decisions.length, 2);
  assert.equal(landing.pending.type, "移位");
  const resolved = move(state, "knockback", 4, { choices: ["down", "right"] });
  assert.equal(resolved.pending, undefined);
  assert.deepEqual(resolved.decisions, landing.decisions);
  assert.deepEqual(resolved.positions.titans, [point(13, 1), point(14, 1)]);
});

test("column stops knockback but push and pull break it and continue", () => {
  const obstacle = tile("Column", 7, 7);
  const pushing = room(point(4.5, 7.5), [point(6, 7)], [obstacle]);
  const kb = move(pushing, "knockback", 3);
  const push = move(pushing, "push", 3);
  const pull = move(room(point(9.5, 7.5), [point(6, 7)], [obstacle]), "pull", 3);
  for (const plan of [kb, push, pull]) {
    assert.deepEqual(plan.destroyed, [0]);
    assert.equal(plan.collisions.length, 1);
  }
  assert.deepEqual(kb.targetPath.at(-1), point(7, 7));
  assert.deepEqual(push.targetPath.at(-1), point(9, 7));
  assert.deepEqual(push.sourcePath.at(-1), point(7.5, 7.5));
  assert.equal(push.positions.apostle.facing, 90);
  assert.deepEqual(pull.targetPath.at(-1), point(9, 7));
  assert.deepEqual(pull.sourcePath.at(-1), point(10.5, 7.5));
});

test("knockback can pass through a fissure, whereas push and pull kill on entry", () => {
  const chasm = tile("Maze Fissure I", 7, 8.5, 90);
  const state = room(point(4.5, 7.5), [point(6, 7)], [chasm]);
  assert.deepEqual(move(state, "knockback", 2).deaths, []);
  assert.deepEqual(move(state, "knockback", 1).deaths, [0]);
  const push = move(state, "push", 3);
  assert.deepEqual(push.deaths, [0]);
  assert.deepEqual(push.targetPath.at(-1), point(7, 7));
  const pull = move(room(point(9.5, 7.5), [point(6, 7)], [chasm]), "pull", 2);
  assert.deepEqual(pull.deaths, [0]);
  assert.deepEqual(pull.targetPath.at(-1), point(7, 7));
});

test("push uses approach steps and the labyrinth only blocks its red edges", () => {
  const board = room(point(4.5, 7.5), [point(8, 7)], []);
  const approach = move(board, "push", 3);
  assert.deepEqual(approach.sourcePath.at(-1), point(7.5, 7.5));
  assert.deepEqual(approach.targetPath, [point(8, 7), point(9, 7)]);
  const tileOnBoard = tile("Labyrinth I", 8.5, 7);
  const crossing = room(point(4.5, 7.5), [point(6, 7)], [tileOnBoard]);
  assert.deepEqual(move(crossing, "push", 3).targetPath.at(-1), point(9, 7));
  const blocked = room(point(8.5, 4.5), [point(8, 6)], [tileOnBoard]);
  const route = move(blocked, "push", 1);
  assert.deepEqual(route.displaced, [{ model: 0, from: point(8, 6), to: point(7, 6) }]);
  assert.deepEqual(route.destroyed, []);
  blocked.board.map.terrain.push(tile("Column", 7, 6));
  const trapped = move(blocked, "push", 1);
  assert.deepEqual(trapped.deaths, [0]);
  assert.deepEqual(trapped.sourcePath.at(-1), point(8.5, 5.5));
});

test("diagonal apostle push chooses an opening axis once and consumes the approach budget", () => {
  const state = room(point(10.5, 7.5), [point(8, 10)], [tile("Labyrinth I", 10.5, 9)]);
  const unresolved = move(state, "push", 4);
  assert.deepEqual(unresolved.pending.options.map(option => option.label), ["横向优先", "纵向优先"]);
  const cases = [
    ["left", [point(10, 8), point(9, 8), point(9, 9), point(8, 9)], point(8, 11)],
    ["up", [point(10, 8), point(10, 9), point(9, 9), point(9, 10)], point(7, 10)],
  ];
  for (const [direction, footprint, destination] of cases) {
    const contact = move(state, "push", 3, { choices: [direction] });
    assert.equal(contact.pending, undefined);
    assert.equal(contact.used, 3);
    assert.equal(contact.approachSteps, 3);
    assert.deepEqual(contact.sourcePath.map(step => forced.upperLeft(step, 2)), footprint);
    assert.deepEqual(contact.targetPath, [point(8, 10)]);
    const pushed = move(state, "push", 4, { choices: [direction] });
    assert.equal(pushed.pending, undefined);
    assert.equal(pushed.approachSteps, 3);
    assert.equal(pushed.used, 4);
    assert.deepEqual(pushed.targetPath.at(-1), destination);
  }
});

test("diagonal pull asks only for the first direction and alternates along a shortest route", () => {
  const state = room(point(10.5, 8.5), [point(5, 4)]);
  const undecided = move(state, "pull", 9);
  assert.equal(undecided.pending.type, "选择拖拽起始方向");
  assert.deepEqual(undecided.pending.options.map(option => option.id), ["up", "right"]);
  const paths = {
    right: [point(6, 4), point(6, 5), point(7, 5), point(7, 6), point(8, 6), point(8, 7), point(9, 7), point(9, 8)],
    up: [point(5, 5), point(6, 5), point(6, 6), point(7, 6), point(7, 7), point(8, 7), point(8, 8), point(9, 8)],
  };
  for (const [direction, approach] of Object.entries(paths)) {
    const result = move(state, "pull", 9, { choices: [direction] });
    assert.equal(result.pending, undefined);
    assert.equal(result.decisions.length, 1);
    assert.equal(result.used, 9);
    assert.deepEqual(result.targetPath, [point(5, 4), ...approach, point(10, 8)]);
    assert.deepEqual(result.sourcePath.slice(1), [point(11.5, 8.5)]);
  }

  const occupied = room(point(10.5, 8.5), [point(5, 4), point(7, 5)]);
  const landing = move(occupied, "pull", 3, { choices: ["right"] });
  assert.equal(landing.pending.type, "移位");
  assert.equal(landing.pending.model, 1);
});

test("pull goes around a cliff and moves the source only after contact", () => {
  const state = room(point(9.5, 7.5), [point(6, 7)], [tile("Cliff O", 7.5, 7.5)]);
  const plan = move(state, "pull", 2);
  assert.equal(plan.pending, undefined);
  assert.equal(plan.collisions.length, 1);
  assert.deepEqual(plan.targetPath, [point(6, 7), point(6, 6), point(7, 6)]);
  const alreadyAdjacent = room(point(9.5, 7.5), [point(8, 7)]);
  assert.deepEqual(move(alreadyAdjacent, "pull", 2).sourcePath.slice(1), [point(10.5, 7.5), point(11.5, 7.5)]);
  const titanSource = room(point(16.5, 12.5), [point(7, 7), point(6, 7)], [tile("Column", 8, 7)]);
  assert.equal(move(titanSource, "pull", 2, { source: 0, target: 1 }).used, 0);
  titanSource.board.map.terrain = [];
  assert.deepEqual(move(titanSource, "pull", 2, { source: 0, target: 1 }).positions.titans,
    [point(9, 7), point(8, 7)]);
});

test("shared-space landing displaces the other Titan and down status does not block movement", () => {
  const state = room(point(4.5, 7.5), [point(6, 7), point(8, 7)]);
  state.heroes[0].condition = "down";
  const choice = move(state, "knockback", 2);
  assert.equal(choice.pending.model, 1);
  const resolved = move(state, "knockback", 2, { choices: ["up"] });
  assert.deepEqual(resolved.positions.titans, [point(8, 7), point(8, 8)]);
  assert.deepEqual(resolved.displaced, [{ model: 1, from: point(8, 7), to: point(8, 8) }]);
});

test("an active Titan moves the boss, keeping its facing and marking a boss landing overlap", () => {
  const state = room(point(7.5, 7.5), [point(6, 7), point(10, 7)]);
  const plan = move(state, "push", 2, { source: 0, target: "apostle" });
  assert.deepEqual(plan.sourcePath.at(-1), point(8, 7));
  assert.deepEqual(plan.targetPath.at(-1), point(9.5, 7.5));
  assert.equal(plan.positions.apostle.facing, 180);
  assert.deepEqual(plan.endSeats, [1]);
});

test("AI and body-part knockback use their own eligibility, and absolute is triggered only by overlap", () => {
  const state = room(point(4.5, 7.5), [point(7, 7)]);
  assert.match(move(state, "knockback", 2, { trigger: "bp" }).error, /相邻/);
  assert.match(move(state, "knockback", 2, { trigger: "ai", attackRange: 1 }).error, /有效范围/);
  assert.equal(move(state, "knockback", 2, { trigger: "ai", attackRange: 3, attackMin: 2 }).used, 2);
  assert.match(move(state, "absolute", 2).error, /落点/);
  const hekaton = room(point(4.5, 7.5), [point(5, 7)]);
  hekaton.board.apostle = "HEKATON";
  const speed = terrain.getApostleProfile("HEKATON", 1).speed;
  assert.match(move(hekaton, "absolute", speed - 1, { trigger: "collision" }).error, /不能减免/);
  const absolute = move(hekaton, "absolute", 1, { trigger: "collision", absoluteException: true });
  assert.ok(absolute.pending || absolute.used === 1);
});
