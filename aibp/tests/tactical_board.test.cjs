const test = require("node:test");
const assert = require("node:assert/strict");
const los = require("../battle_los.js");
const terrain = require("../../ss/terrain-data.js");
const gear = require("../gear-roll-profiles.js");

function pursuitBoard() {
  return {
    ...terrain.createBattleMap("HERMESIAN_PURSUER", 1),
    terrain: [],
    pieces: {
      apostle: { column: 13.5, row: 8.5, facing: 0 },
      titans: [{ column: 4, row: 3 }, { column: 10, row: 8 }, { column: 3, row: 3 }],
    },
  };
}

function build(map, state) {
  return los.buildLosOverlay(map, { active: true, ...state }, terrain, "HERMESIAN_PURSUER", { level: 1 });
}

test("a selected Titan sees a Primordial outside weapon range; switching Titans moves the origin", () => {
  const map = pursuitBoard();
  const weapon = { kind: "reach", max: 3 };
  const distant = build(map, { mode: "titan-attack", selectedTitan: 0, weapon });
  assert.deepEqual(distant.source, [{ c: 4, r: 3 }]);
  assert.equal(distant.weaponTarget.visible, true);
  assert.equal(distant.weaponTarget.inRange, false);
  const near = build(map, { mode: "titan-attack", selectedTitan: 1, weapon });
  assert.deepEqual(near.source, [{ c: 10, r: 8 }]);
  assert.deepEqual(near.weaponTarget, { distance: 3, inRange: true, visible: true, legal: true });
});

test("a multi-square target uses the closest occupied square for ranged weapons", () => {
  const cells = [{ c: 9, r: 9 }, { c: 10, r: 9 }];
  const occ = { red: new Set() };
  const src = [{ c: 8, r: 9 }];
  assert.deepEqual(los.computeTitanWeapon(src, cells, { kind: "ranged", min: 2, max: 4 }, occ).target,
    { distance: 1, inRange: false });
  assert.deepEqual(los.computeTitanWeapon(src, cells, { kind: "melee" }, occ).target,
    { distance: 1, inRange: true });
  assert.deepEqual(los.computeTitanWeapon(src, cells, { kind: "melee" }, { red: new Set(["8,8|8,9"]) }).target,
    { distance: 1, inRange: false });
});

test("printed weapon ranges cover melee, reach and ranged on both ends of the printed interval", () => {
  assert.deepEqual(gear.range("AJ0224"), { kind: "melee", min: 1, max: 1 });
  assert.deepEqual(gear.range("AJ0247"), { kind: "reach", min: 1, max: 2 });
  assert.deepEqual(gear.range("EJ2809"), { kind: "ranged", min: 3, max: 3 });
  const source = [{ c: 8, r: 9 }];
  const adjacent = [{ c: 9, r: 9 }];
  const open = { red: new Set() };
  assert.equal(los.computeTitanWeapon(source, adjacent, gear.range("EJ2858"), open).target.inRange, true);
  assert.equal(los.computeTitanWeapon(source, adjacent, gear.range("EJ2809"), open).target.inRange, false);
  assert.equal(los.computeTitanWeapon(source, adjacent, gear.range("BJ0864"), open).target.inRange, true);
  const wall = { red: new Set(["8,8|8,9"]) };
  assert.equal(los.computeTitanWeapon(source, [...adjacent, { c: 10, r: 9 }], gear.range("BJ0864"), wall).target.inRange, false);
});

test("legacy Reach labels are imported as reach, including Nail Spear", () => {
  const reach = { kind: "reach", min: 1, max: 2 };
  for (const id of ["AJ0273", "BJ0859", "BJ0939", "BJ0945", "BJ0971"]) {
    assert.deepEqual(gear.range(id), reach);
  }

  const map = pursuitBoard();
  const weapon = gear.range("AJ0273");
  const state = { mode: "titan-attack", selectedTitan: 1, weapon };
  assert.equal(build(map, state).weaponTarget.inRange, false);
  map.pieces.titans[1].column += 1;
  assert.deepEqual(build(map, state).weaponTarget, { distance: 2, inRange: true, visible: true, legal: true });
});

test("range entry accepts printed conditional changes and unverified faces", () => {
  const extended = { kind: "ranged", min: 2, max: 6 };
  assert.deepEqual(gear.range("CJ1399", extended), extended);
  assert.deepEqual(gear.range("CJ1399", { ...extended, max: 8 }), { ...extended, max: 5 });
  assert.deepEqual(gear.range("AJ0249", extended), { ...extended, max: 4 });
  assert.equal(gear.range("AJ0249@c2"), null);
  assert.deepEqual(gear.range("AJ0249@c2", extended), extended);
});

test("Titan movement is orthogonal and skips occupied squares; moving the piece changes the source", () => {
  const map = pursuitBoard();
  const first = build(map, { mode: "titan-move", selectedTitan: 0, moveSpeed: 2 });
  assert.equal(first.moveCells.some(cell => cell.c === 3 && cell.r === 3), false);
  assert.ok(first.moveCells.some(cell => cell.c === 5 && cell.r === 4 && cell.steps === 2));
  map.pieces.titans[0] = { column: 5, row: 4 };
  const moved = build(map, { mode: "titan-attack", selectedTitan: 0 });
  assert.deepEqual(moved.source, [{ c: 5, r: 4 }]);
});

test("a current Primordial footprint and facing survive normalization and rotate the blindspot", () => {
  const map = pursuitBoard();
  const before = build(map, { mode: "apostle-sight" });
  assert.ok(before.blindspots.size);
  map.pieces.apostle = { column: 6.5, row: 9.5, facing: 90 };
  const projected = JSON.parse(JSON.stringify(terrain.normalizeBattleMap(map, "HERMESIAN_PURSUER", 1)));
  const after = build(projected, { mode: "apostle-sight" });
  assert.deepEqual(after.source, [{ c: 6, r: 9 }, { c: 6, r: 10 }, { c: 7, r: 9 }, { c: 7, r: 10 }]);
  assert.equal(after.facing, 90);
  assert.ok(after.blindspots.has("5,9"));
  assert.notDeepEqual(before.blindspots, after.blindspots);
});

test('boss movement uses whole upper-left grid squares for even and odd footprints', () => {
  for (const size of [1, 2, 3, 4]) {
    const half = (size - 1) / 2;
    const move = { c: 4 + half, r: 9 - half };
    const overlay = { profile: { size } };
    assert.deepEqual(los.apostleMoveDestination(overlay, { column: 4, row: 9 }), move);
    assert.deepEqual(los.apostleMoveDestination(overlay, { column: 5, row: 9 }), { ...move, c: move.c + 1 });
    assert.equal(los.apostleMoveDestination(overlay, { column: 22 - size, row: 9 }), null);
    const cells = los.losSourceCells({ column: move.c, row: move.r }, size);
    assert.equal(cells.length, size * size);
    assert.ok(cells.every(({ c, r }) => Number.isInteger(c) && Number.isInteger(r)));
    assert.equal(Math.min(...cells.map(cell => cell.c)), 4);
    assert.equal(Math.max(...cells.map(cell => cell.r)), 9);
  }
});

test('boss trails use unit orthogonal steps without consulting terrain', () => {
  const from = { column: 3.5, row: 8.5 }, to = { column: 7.5, row: 5.5 };
  const route = los.apostleMoveRoute(from, to);
  assert.deepEqual(route[0], from);
  assert.deepEqual(route.at(-1), to);
  assert.equal(route.length, 8);
  for (let i = 1; i < route.length; i++) assert.equal(Math.abs(route[i].column-route[i-1].column)+Math.abs(route[i].row-route[i-1].row), 1);
  assert.deepEqual(los.apostleMoveRoute(from, {column:4,row:5}), []);
});

test("single-target priority sight uses the Primordial footprint and current blindspot", () => {
  const map = pursuitBoard();
  const state = { active: true, mode: "apostle-sight" };
  const targetCell = { c: 5, r: 9 };
  map.pieces.apostle = { column: 6.5, row: 9.5, facing: 90 };
  const sight = () => los.buildLosOverlay(map, state, terrain, "HERMESIAN_PURSUER", { level: 1, targetCell }).targetVisible;
  assert.equal(sight(), false);
  map.pieces.apostle.facing = 270;
  assert.equal(sight(), true);
});
