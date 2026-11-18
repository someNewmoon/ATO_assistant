const test = require('node:test');
const assert = require('node:assert/strict');
const inventory = require('../technology/gear-inventory.js');
test('登升装备编号在库存与英雄配装中无损往返，原始装备与登升装备独立计数', () => {
  const stock = { AJ0160: { quantity: 2, manufactured: 2 }, 'AJ0160@c2': { quantity: 1, manufactured: 0 } };
  assert.deepEqual(inventory.normalize(stock), stock);
  assert.deepEqual(inventory.normalizeLoadout({ gear: { 'AJ0160@c2': 1 } }).gear, { 'AJ0160@c2': 1 });
  const next = inventory.ascend(stock, 'AJ0160', 'c1');
  assert.equal(next.AJ0160.quantity, 1); assert.equal(next['AJ0160@c2'].quantity, 2);
  assert.equal(stock.AJ0160.quantity, 2);
});
test('上游主配装、针对配装与方案作为模板导入，不自动预占或改写英雄配装', () => {
  const record = { titans: [{ id: 't1', count: 1 }], arsenal: { 'AJ0160@c2': { quantity: 1 } },
    arsenalLoadouts: { slots: [{ titanId: 't1', equipment: ['AJ0160@c2'], sides: [{ name: '替换', equipment: ['AJ0160'] }] }],
      presets: [{ id: 'p', name: '方案', titanId: 't1', equipment: ['AJ0160@c2'] }] } };
  const before = structuredClone(record), templates = inventory.loadoutTemplates(record);
  assert.equal(templates.length, 3); assert.deepEqual(record, before);
  const heroes = [{ id: 'hero-a' }, { id: 'hero-b' }];
  const saved = inventory.saveLoadout(record, heroes, 'hero-a', null, templates[0].kit);
  assert.deepEqual(saved.loadouts['hero-a'].gear, { 'AJ0160@c2': 1 });
  assert.deepEqual(saved.arsenalLoadouts, before.arsenalLoadouts);
  assert.throws(() => inventory.saveLoadout(saved, heroes, 'hero-b', null, templates[0].kit), /数量|库存/);
});
test('已配装装备不能登升，最高故事集不能继续登升', () => {
  assert.throws(() => inventory.ascend({ AJ0160: { quantity: 1 } }, 'AJ0160', 'c1', 1), /卸下/);
  assert.throws(() => inventory.ascend({ 'AJ0160@c5': { quantity: 1 } }, 'AJ0160@c5', 'c5'), /无法/);
});
