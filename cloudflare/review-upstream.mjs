// Read-only compatibility/fault-injection probe of the fetched upstream commit.
// Run from this directory: node review-upstream.mjs [upstream-commit]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const moon = require('../technology/gear-inventory.js');
const revision = process.argv[2] || 'd591315';
const read = file => execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8', maxBuffer: 8e6 });
const source = read('technology/index.html');
const box = { module: { exports: {} } };
vm.runInNewContext(read('technology/gear-inventory.js'), box);
const upstream = box.module.exports;
assert.equal(upstream.gearKey('AJ0160@c2'), 'AJ0160@c2');
assert.equal(moon.gearKey('AJ0160@c2'), 'AJ0160@c2');
console.log('FIXED: Moon now preserves upstream ascended IDs.');

const stock = { arsenal: { AJ0160: { quantity: 1, manufactured: 1 } } };
const probe = {
  console, coreBalance: 3, committedAscensions: 0, loseResponse: true,
  gearRecordState: stock, gearRecordError: null, gearMutationInFlight: false,
  campaignSession: { changed: false, accountId: 'test' }, activeAccountId: 'default',
  gearAscensionOperations: new Map(), arsenalMessage: '', arsenalMessageError: false,
  window: { crypto, ATO_GEAR_INVENTORY: upstream, ATO_ARSENAL_LOADOUT: {
    normalize: () => ({ slots: [] }), equipmentCounts: () => new Map(),
  }, ATO_ASCENSION_CORE: { name: () => '测试核心' } },
  readLatestRecordState: async () => ({ state: stock }), renderGearInventoryView() {},
};
probe.changeAscensionCore = async (cycle, delta) => {
  probe.coreBalance += delta;
  if (probe.loseResponse) { probe.loseResponse = false; throw new Error('response lost AFTER theatre commit'); }
};
probe.mutateCampaignRecordState = async (mutate, operation) => {
  mutate(stock); stock._gearCraftReceipts = { [operation.id]: true }; probe.committedAscensions++;
};
vm.createContext(probe);
vm.runInContext(source.slice(source.indexOf('async function ascendArsenalGear('), source.indexOf('\nfunction arsenalGearNames(')), probe);
const item = { gearId: 'AJ0160', originCycle: 'c1', name: '测试装备' };
await assert.rejects(probe.ascendArsenalGear(item, 'c2', 'test-key'), /response lost/);
await probe.ascendArsenalGear(item, 'c2', 'test-key');
assert.equal(probe.committedAscensions, 1);
assert.equal(probe.coreBalance, 1);
console.log('CONFIRMED: lost core-write response + retry consumes 2 cores for 1 ascension (3 → 1).');
