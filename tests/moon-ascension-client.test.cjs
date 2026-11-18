const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const inventory = require('../technology/gear-inventory.js');
const html = fs.readFileSync(path.join(__dirname, '../technology/index.html'), 'utf8');
const source = html.slice(html.indexOf('async function ascendArsenalGear('), html.indexOf('\nfunction renderArsenalPage('));

test('响应丢失并刷新页面后继续使用持久化操作ID，不重复登升或扣费', async () => {
  const saved = new Map(), receipts = new Set(), requests = [];
  let cores = 3, loseResponse = true;
  const localStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const fetch = async (_, options) => {
    const body = JSON.parse(options.body); requests.push(body.operationId);
    const replayed = receipts.has(body.operationId);
    if (!replayed) { receipts.add(body.operationId); cores--; }
    if (loseResponse) { loseResponse = false; throw new Error('network response lost'); }
    return { ok: true, json: async () => ({ ok: true, replayed }) };
  };
  const page = () => {
    const context = vm.createContext({ localStorage, fetch, crypto: globalThis.crypto,
      gearMutationInFlight: false, campaignSession: { accountId: 'test', changed: false, accept: x => x },
      gearRecordState: {}, activeAccountId: 'default', CAMPAIGN_STORAGE_URL: '/api/campaign-state.php',
      arsenalMessage: '', arsenalMessageError: false, loadGearRecordState: async () => {}, renderGearInventoryView() {},
    });
    vm.runInContext(source, context); return context;
  };
  await page().ascendArsenalGear('AJ0160');
  assert.equal(saved.size, 1); assert.equal(cores, 2);
  const reloaded = page(); await reloaded.ascendArsenalGear('AJ0160');
  assert.equal(requests[0], requests[1]); assert.equal(cores, 2); assert.equal(saved.size, 0);
  assert.match(reloaded.arsenalMessage, /未重复扣费/);
});
test('持久化失败时不发起登升请求', async () => {
  let sent = false;
  const context = vm.createContext({ localStorage: { getItem: () => null, setItem: () => { throw new Error('storage unavailable'); } },
    fetch: async () => { sent = true; }, crypto: globalThis.crypto,
    gearMutationInFlight: false, campaignSession: { accountId: 'test', changed: false }, gearRecordState: {}, activeAccountId: 'default',
    arsenalMessage: '', arsenalMessageError: false, renderGearInventoryView() {},
  });
  vm.runInContext(source, context); await context.ascendArsenalGear('AJ0160');
  assert.equal(sent, false); assert.equal(context.gearMutationInFlight, false);
});
test('战斗室登升卡图与缩略图按基础ID回退，仍优先采用独立卡图', () => {
  const image = { addEventListener() {}, removeAttribute() {} }, error = {};
  const box = { querySelector: selector => selector === 'img' ? image : error, addEventListener() {} };
  const context = vm.createContext({ URL, location: { href: 'https://example.test/aibp/room' },
    window: { ATO_GEAR_INVENTORY: inventory, ATO_ROOM_ART: { equipment: { AJ0160: 'base.webp', 'AJ0160@c3': 'own.webp' }, thumbs: { AJ0160: 'thumb.webp' } } },
    document: { getElementById: () => box },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../aibp/room-assets.js'), 'utf8'), context);
  const assets = context.window.ATO_BATTLE_ASSETS;
  assert.equal(assets.gearSrc('AJ0160@c2'), 'https://example.test/base.webp');
  assert.equal(assets.gearSrc('AJ0160@c3'), 'https://example.test/own.webp');
  assert.equal(assets.thumbSrc('AJ0160@c2'), 'https://example.test/thumb.webp');
  assert.equal(assets.gearSrc('constructor'), '');
});
