(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ATO_GEAR_INVENTORY = api;
})(typeof window === 'object' ? window : this, function () {
  'use strict';

  function gearKey(value) {
    const id = String(value || '').trim().replace(/^1x/i, '');
    if (/^[A-Z]J\d+$/i.test(id)) return id.toUpperCase();
    if (/^T:tt_[a-z0-9_]+$/i.test(id)) return 'T:' + id.slice(2).toLowerCase();
    return '';
  }

  function count(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(number))) : 0;
  }

  function normalize(value) {
    const inventory = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return inventory;
    for (const [rawId, record] of Object.entries(value)) {
      const id = gearKey(rawId);
      if (!id || !record || typeof record !== 'object' || Array.isArray(record)) continue;
      const previous = inventory[id] || { quantity: 0, manufactured: 0 };
      inventory[id] = {
        quantity: count(previous.quantity + count(record.quantity)),
        manufactured: count(previous.manufactured + count(record.manufactured)),
      };
    }
    return inventory;
  }

  // Keep zero-quantity entries so equipment remains visible after it is used up.
  // Manual corrections only change stock; manufacturing also updates its total.
  function adjust(value, gearId, delta, manufactured = false) {
    const id = gearKey(gearId);
    if (!id || !Number.isSafeInteger(delta) || delta === 0 || (manufactured && delta < 0)) {
      throw new Error('装备或数量无效');
    }
    const inventory = normalize(value);
    const record = inventory[id] || { quantity: 0, manufactured: 0 };
    const quantity = record.quantity + delta;
    const total = record.manufactured + (manufactured ? delta : 0);
    if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(total)) throw new Error('装备数量过大');
    inventory[id] = { quantity: Math.max(0, quantity), manufactured: total };
    return inventory;
  }

  function normalizeLoadout(value) {
    const gear = {};
    for (const [rawId, quantity] of Object.entries(value?.gear || {}).sort()) {
      const id = gearKey(rawId);
      const amount = count(quantity);
      if (id && !id.startsWith('T:') && amount) gear[id] = amount;
    }
    return {
      player: String(value?.player || '').trim().slice(0, 60),
      titanId: String(value?.titanId || ''),
      gear,
    };
  }

  function loadoutTitans(record) {
    if (Array.isArray(record.titans)) return record.titans.filter(titan => titan?.id);
    const quantity = count(record.titan);
    return quantity ? [{ id: 'legacy-titan', name: '泰坦', count: quantity }] : [];
  }

  function titanIdFor(record, id) {
    const visited = new Set();
    const titans = loadoutTitans(record);
    while (id && !visited.has(id) && !titans.some(titan => String(titan.id) === id)
        && Object.prototype.hasOwnProperty.call(record.titanMergedIds || {}, id)) {
      visited.add(id);
      id = String(record.titanMergedIds[id] || '');
    }
    return id;
  }

  function assignedLoadouts(record, heroes) {
    const active = new Set(heroes.map(hero => hero.id));
    return Object.entries(record.loadouts || {}).filter(([id]) => active.has(id));
  }

  function saveLoadout(record, heroes, heroId, base, draft, migration) {
    if (!heroId || /^[1-4]$/.test(heroId) || !heroes.some(hero => hero.id === heroId)) {
      throw new Error('该英雄已不在当前战役，请重新打开配装');
    }
    const saved = normalizeLoadout(record.loadouts?.[heroId]);
    const next = normalizeLoadout(draft);
    next.titanId = titanIdFor(record, next.titanId);
    if (JSON.stringify(saved) === JSON.stringify(next) && (!migration || !record.loadouts?.[migration.slot])) return null;
    if (JSON.stringify(saved) !== JSON.stringify(normalizeLoadout(base))) {
      throw new Error('该英雄的配装已在另一设备修改，请重新打开配装');
    }
    const legacy = migration ? normalizeLoadout(record.loadouts?.[migration.slot]) : null;
    if (migration && (!/^[1-4]$/.test(migration.slot) || !record.loadouts?.[migration.slot]
        || JSON.stringify(legacy) !== JSON.stringify(migration.base))) {
      throw new Error('旧配装已更改，请重新打开配装');
    }
    const others = assignedLoadouts(record, heroes)
      .filter(([id]) => id !== heroId)
      .map(([, loadout]) => normalizeLoadout(loadout));
    const titanId = next.titanId;
    if (titanId && titanId !== titanIdFor(record, saved.titanId)) {
      const titan = loadoutTitans(record).find(item => String(item.id) === titanId);
      const used = others.filter(item => titanIdFor(record, item.titanId) === titanId).length;
      if (!titan || Math.max(1, count(titan.count)) <= used) throw new Error('这个泰坦条目已无可分配数量，请重新选择');
    }
    const stock = normalize(record.arsenal);
    for (const [id, quantity] of Object.entries(next.gear)) {
      const used = others.reduce((sum, item) => sum + (item.gear[id] || 0), 0);
      if (quantity > (saved.gear[id] || 0) && quantity + used > (stock[id]?.quantity || 0)) {
        throw new Error(`${id} 库存不足，可能已分配给其他英雄`);
      }
    }
    const loadouts = { ...record.loadouts, [heroId]: next };
    if (migration) delete loadouts[migration.slot];
    return { ...record, loadouts };
  }

  return { gearKey, normalize, adjust, normalizeLoadout, loadoutTitans, titanIdFor, assignedLoadouts, saveLoadout };
});
