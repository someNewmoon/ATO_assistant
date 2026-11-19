(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ATO_GEAR_INVENTORY = api;
})(typeof window === 'object' ? window : this, function () {
  'use strict';

  // 梦行者 follows the Chinese rulebook. Named scans keep the names printed on their panels.
  const TITAN_MODELS = [
    ['tt_earthshaker', '撼地者', 'Earthshaker'],
    ['tt_mazerunner', '迷宫穿梭者', 'Mazerunner', '迷宫疾行者', '迷宫行者', '迷阵穿梭者'],
    ['tt_plogicbreaker', '', 'Prototype Logicbreaker', '破逻辑者'],
    ['tt_warkeeper', '历战者', 'Warkeeper', '守战者'],
    ['tt_firestarter', '纵火者', 'Firestarter', '燃火者'],
    ['tt_pabysswatcher', '深渊凝望者', 'Prototype Abysswatcher'],
    ['tt_returner', '归来者', 'Returner'],
    ['tt_ascender', '升腾者', 'Ascender'],
    ['tt_pdawnburner', '黎明燃烧者', 'Prototype Dawnburner', 'Dawnburner'],
    ['tt_cloudsoarer', '翔云者', 'Cloudsoarer'],
    ['tt_wishender', '终愿者', 'Wishender'],
    ['tt_plunarlander', '登月者', 'Prototype Lunarlander'],
    ['tt_shadowdancer', '影舞者', 'Shadowdancer'],
    ['tt_fatebound', '', 'Fatebound', '命运束缚者'],
    ['tt_chronoking', '', 'Chronoking', '时光之王'],
    ['tt_helldiver', '', 'Helldiver', '潜渊者'],
    ['tt_trespasser', '', 'Trespasser', '越界者'],
    ['tt_executioner', '', 'Executioner', '行刑者'],
    ['tt_feareater', '', 'Feareater', '无惧者'],
    ['tt_lunarlander', '', 'Lunarlander', '原型登月者'],
    ['tt_messianic', '', 'Messianic', '弥赛亚'],
  ];
  const TITAN_NAMES_ZH = Object.fromEntries(TITAN_MODELS.filter(([, zh]) => zh));
  const TITAN_TYPES = [
    { id: 'dreamwalker', name: '梦行者', aliases: ['睡梦行者', 'Dreamwalker'] },
    { id: 'spartan-dreamwalker', name: '斯巴达梦行者', aliases: ['Spartan Dreamwalker'], scan: '斯巴达梦行者' },
    { id: 'gamechanger', name: '回天者', aliases: ['Gamechanger'], scan: '回天者' },
    { id: 'logicbreaker', name: '逻辑破坏者', aliases: ['Logicbreaker'], scan: '逻辑破坏者' },
    ...TITAN_MODELS.map(([id, zh, en, ...aliases]) => ({
      id, name: zh || en, aliases: [id.slice(3), en, ...aliases], portrait: id,
    })),
  ];
  const listedPortraits = new Set([
    'tt_earthshaker', 'tt_mazerunner', 'tt_plogicbreaker', 'tt_warkeeper', 'tt_firestarter',
    'tt_pabysswatcher', 'tt_cloudsoarer', 'tt_wishender', 'tt_plunarlander', 'tt_shadowdancer',
    'tt_helldiver', 'tt_trespasser', 'tt_executioner', 'tt_feareater',
    'tt_returner', 'tt_ascender', 'tt_pdawnburner',
  ]);
  const titanTypes = new Map(TITAN_TYPES.map(type => [type.id, type]));
  const titanAliases = new Map(TITAN_TYPES.flatMap(type =>
    [type.id, type.name, ...type.aliases].map(alias => [alias.toLowerCase(), type])));
  const titanScans = new Map([
    ['tt_earthshaker', '撼地者'], ['tt_mazerunner', '迷宫穿梭者'],
  ]);
  const DREAMWALKER_PANELS = [
    { id: 'herodotus', name: '希罗多德', sprite: 't1' },
    { id: 'ulyssia', name: '尤利西娅', sprite: 't2' },
    { id: 'solon', name: '梭伦', sprite: 't3' },
    { id: 'philoctetra', name: '费洛克泰拉', sprite: 't4' },
  ];

  function dreamwalkerPanel(titan, choice) {
    const type = titanType(titan);
    if (!titan || (type && type.id !== 'dreamwalker')) return null;
    return DREAMWALKER_PANELS.find(panel => panel.id === choice)
      || DREAMWALKER_PANELS.find(panel => panel.id === titan.panelId)
      || DREAMWALKER_PANELS.find(panel => panel.name === titan.name) || null;
  }

  function loadoutTitan(titan, choice) {
    const panel = dreamwalkerPanel(titan, choice);
    return panel ? { ...titan, typeId: 'dreamwalker', panelId: panel.id } : titan;
  }

  function titanType(titan) {
    return titanTypes.get(titan?.typeId)
      || titanAliases.get(String(titan?.type || '').trim().toLowerCase()) || null;
  }

  function titanTypeFields(titan) {
    const entry = titanType(titan);
    return { typeId: entry?.id || '', type: entry?.name || String(titan?.type || '').trim().slice(0, 80) };
  }

  const TRAUMA_DECKS = { light: '轻微创伤', heavy: '严重创伤', lethal: '致命创伤', obol: '生死关头' };
  const ranges = (light, heavy, lethal) => Array.from({ length: 9 }, (_, i) =>
    i < light ? 'light' : i < heavy ? 'heavy' : i < lethal ? 'lethal' : 'obol');
  const standard = ranges(3, 6, 9);
  const defaultTraumaTracks = {
    dreamwalker: standard, tt_earthshaker: standard,
    gamechanger: ranges(4, 8, 9), tt_mazerunner: ranges(2, 5, 8),
    logicbreaker: ['obol', ...ranges(3, 6, 8).slice(0, 8)],
  };

  function traumaTrack(value) {
    return Array.isArray(value) && value.length === 9 && Array.from(value).every(deck => Object.hasOwn(TRAUMA_DECKS, deck))
      ? value.slice() : null;
  }

  function defaultTraumaTrack(titan) {
    return defaultTraumaTracks[titanType(titan)?.id]?.slice() || null;
  }

  function loadoutTraumaTrack(titan, kit) {
    return titan ? traumaTrack(kit?.traumaTrack) || traumaTrack(titan.traumaTrack) : null;
  }

  function titanLabel(titan) {
    const panel = dreamwalkerPanel(titan);
    const name = panel?.name || titan?.name || '泰坦';
    const { type } = titanTypeFields(panel ? loadoutTitan(titan) : titan);
    return [name, type !== name && type, titan?.crippled ? '残废' : ''].filter(Boolean).join(' · ');
  }

  function titanArtwork(titan, manifest) {
    if (!titan) return null;
    const entry = titanType(titan);
    const scan = dreamwalkerPanel(titan)?.name
      || entry?.scan || (entry && titanScans.get(entry.id));
    if (scan) {
      const path = manifest ? manifest.titanScans?.[scan] : 'aibp/images/titan-cards/' + scan + '.webp';
      if (path) return { path, name: scan, label: '查看泰坦卡图' };
    }
    if (!entry?.portrait || (!manifest && !listedPortraits.has(entry.portrait))) return null;
    const path = 'technology/images/titans/' + entry.portrait + '.png';
    if (manifest && !manifest.titans?.includes(path)) return null;
    return { path, name: entry.name, label: '查看泰坦插图' };
  }

  // Shared by the arsenal UI and Moon Worker. Enable when the group unlocks ascension.
  const ascensionEnabled = false;
  const CYCLES = ['c1', 'c2', 'c3', 'c4', 'c5'];

  function gearKey(value) {
    const id = String(value || '').trim().replace(/^1x/i, '');
    const gear = /^([A-Z]J\d+)(?:@(c[2-5]))?$/i.exec(id);
    if (gear) return gear[1].toUpperCase() + (gear[2] ? '@' + gear[2].toLowerCase() : '');
    if (/^T:tt_[a-z0-9_]+$/i.test(id)) return 'T:' + id.slice(2).toLowerCase();
    return '';
  }

  function baseGearId(id) {
    return String(id || '').split('@', 1)[0];
  }

  function ascendedCycle(id) {
    return gearKey(id).split('@')[1] || '';
  }

  function nextCycle(cycle) {
    const index = CYCLES.indexOf(cycle);
    return index < 0 ? '' : CYCLES[index + 1] || '';
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

  function ascend(value, gearId, originCycle, reserved = 0) {
    const id = gearKey(gearId);
    const target = nextCycle(ascendedCycle(id) || originCycle);
    const inventory = normalize(value);
    if (!id || id.startsWith('T:') || !target) throw new Error('这件装备无法再登升。');
    const source = inventory[id];
    if (!source?.quantity) throw new Error('这件装备没有库存。');
    if (source.quantity <= reserved) throw new Error('库存已分配给主要配装，请先卸下一件。');
    const destination = baseGearId(id) + '@' + target;
    const next = adjust(inventory, destination, 1);
    next[id].quantity -= 1;
    return next;
  }

  // Upstream four-slot loadouts are templates, never a second stock reservation.
  function loadoutTemplates(record) {
    const source = record?.arsenalLoadouts;
    const list = [];
    const add = (value, id, name) => {
      if (!value || typeof value !== 'object') return;
      const gear = Object.fromEntries([...new Set((Array.isArray(value.equipment) ? value.equipment : []).map(gearKey).filter(id => id && !id.startsWith('T:')))].map(id => [id, 1]));
      const kit = normalizeLoadout({ titanId: value.titanId, gear });
      if (kit.titanId || Object.keys(gear).length) list.push({ id, name, kit });
    };
    (Array.isArray(source?.slots) ? source.slots : []).slice(0, 4).forEach((slot, index) => {
      add(slot, 'slot:' + index, '配装 ' + (index + 1));
      (Array.isArray(slot?.sides) ? slot.sides : []).forEach((side, i) =>
        add({ ...side, titanId: slot.titanId }, 'side:' + index + ':' + i, '配装 ' + (index + 1) + ' · ' + (side.name || '针对配装')));
    });
    (Array.isArray(source?.presets) ? source.presets : []).forEach((preset, index) => add(preset, 'preset:' + index, preset.name || '方案'));
    return list;
  }

  function normalizeLoadout(value) {
    const gear = {};
    for (const [rawId, quantity] of Object.entries(value?.gear || {}).sort()) {
      const id = gearKey(rawId);
      const amount = count(quantity);
      if (id && !id.startsWith('T:') && amount) gear[id] = amount;
    }
    const track = value?.titanId && traumaTrack(value.traumaTrack);
    return {
      player: String(value?.player || '').trim().slice(0, 60),
      titanId: String(value?.titanId || ''),
      ...(DREAMWALKER_PANELS.some(panel => panel.id === value?.titanPanelId) && { titanPanelId: value.titanPanelId }),
      ...(track && { traumaTrack: track }),
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

  function gearReservations(record, heroes) {
    const byGear = new Map();
    const roster = new Map(heroes.map(hero => [hero.id, hero]));
    for (const [id, raw] of assignedLoadouts(record, heroes)) {
      for (const [gear, count] of Object.entries(normalizeLoadout(raw).gear)) {
        const holders = byGear.get(gear) || [];
        holders.push({ ...roster.get(id), count });
        byGear.set(gear, holders);
      }
    }
    return byGear;
  }

  function saveLoadout(record, heroes, heroId, base, draft, migration) {
    if (!heroId || /^[1-4]$/.test(heroId) || !heroes.some(hero => hero.id === heroId)) {
      throw new Error('该英雄已不在当前战役，请重新打开配装');
    }
    const saved = normalizeLoadout(record.loadouts?.[heroId]);
    const next = normalizeLoadout(draft);
    next.titanId = titanIdFor(record, next.titanId);
    const assignedTitan = loadoutTitans(record).find(titan => String(titan.id) === next.titanId);
    if (next.titanPanelId && titanType(assignedTitan)?.id !== 'dreamwalker') delete next.titanPanelId;
    if (!assignedTitan) delete next.traumaTrack;
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

  return {
    ascensionEnabled, baseGearId, ascendedCycle, nextCycle, ascend, loadoutTemplates,
    TITAN_NAMES_ZH, TITAN_TYPES, DREAMWALKER_PANELS, TRAUMA_DECKS, traumaTrack, defaultTraumaTrack, loadoutTraumaTrack,
    dreamwalkerPanel, loadoutTitan, titanType, titanTypeFields, titanLabel, titanArtwork,
    gearKey, normalize, adjust, normalizeLoadout, loadoutTitans, titanIdFor, assignedLoadouts, gearReservations, saveLoadout,
  };
});
