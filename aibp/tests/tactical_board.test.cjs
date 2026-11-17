const test = require("node:test");
const assert = require("node:assert/strict");
const los = require("../battle_los.js");
const terrain = require("../../ss/terrain-data.js");

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
  assert.deepEqual(near.weaponTarget, { distance: 3, inRange: true, visible: true });
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
