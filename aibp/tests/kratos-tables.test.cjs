const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const inventory = require("../../technology/gear-inventory.js");

const window = { ATO_GEAR_INVENTORY: inventory };
vm.runInNewContext(fs.readFileSync(require.resolve("../kratos-tables.js"), "utf8"), { window });
const kratos = window.ATO_KRATOS_TABLES;
const mazerunner = { typeId: "tt_mazerunner", name: "迷宫穿梭者" };

test("the explicit Kratos slot replaces the base table without counting a trauma strain", () => {
  const base = kratos.forTitan({ ...mazerunner, traumaPatternId: "AW0285" });
  assert.equal(base.source, "泰坦底表");
  assert.match(kratos.preview(base, 2), /已解锁.*腾跃/);
  const upgraded = kratos.forTitan({ ...mazerunner, kratosPatternId: "AW0286", traumaPatternId: "AW0285" });
  assert.equal(upgraded.source, "样式");
  assert.equal(upgraded.name, "迷阵行者");
  assert.match(kratos.preview(upgraded, 2), /怒气 2 · 威力重掷 1 或 走位 1/);
  assert.doesNotMatch(kratos.preview(upgraded, 2), /腾跃/);
  assert.equal(kratos.forTitan({ ...mazerunner, kratosPatternId: "" }, { kratosPatternId: "AW0286" }).source, "泰坦底表");
});

test("battle snapshots preserve legacy ordering and fall back after discarding the active style", () => {
  const titan = { ...mazerunner, patternIds: ["AW0287", "AW0285", "AW0286"] };
  assert.equal(kratos.forHero({ titan }).name, "迷阵行者");
  assert.equal(kratos.forHero({ titan, patternCards: { AW0286: "discarded" } }).name, "梦行者II");
  assert.equal(kratos.forHero({ titan, patternCards: { AW0287: "discarded", AW0286: "discarded" } }).source, "泰坦底表");
  assert.equal(kratos.forTitan({ typeId: "tt_firestarter" }), null);
  assert.match(kratos.preview(null), /尚无录入/);
});
