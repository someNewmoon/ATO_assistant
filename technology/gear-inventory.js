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
    const selected = Object.hasOwn(titan, 'panelId') ? titan.panelId : choice;
    return DREAMWALKER_PANELS.find(panel => panel.id === selected)
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
  // Card IDs, art and thresholds come from the supplied Windows resources.
  // Chinese names follow the official storybooks.
  const shadeTrack = ['light', 'light', 'heavy', 'heavy', 'light', 'heavy', 'heavy', 'lethal', 'lethal'];
  const TITAN_PATTERNS = [
    ['AW0284', '伊阿珀托斯世系', standard],
    ['AW0285', '普罗米修斯世系', ['none', ...standard.slice(1)]],
    ['AW0286', '迷阵行者'],
    ['AW0287', '梦行者II'],
    ['AW0288', '严酷锻炼', standard],
    ['AW0289', '重装训练', standard],
    ['AW0290', '神盾种', standard],
    ['BW0974', '斯巴达梦行者', null, true, 'c2'],
    ['BW0976', '人形怪兽', null, true],
    ['BW0977', '运河疾步者', standard],
    ['BW0978', '本影世系', standard],
    ['BW0979', '禅道训练', standard],
    ['BW0980', '支援专精', standard],
    ['BW0981', '梦行者III', null, true],
    ['CW1550', '德尔斐梦行者', null, true, 'c3'],
    ['CW1551', '时光世系', null, true],
    ['CW1552', '灼伤锻炼', standard],
    ['CW1553', '北方乐土世系', shadeTrack],
    ['CW1554', '超时间流锻炼', standard],
    ['CW1555', '遮光训练', shadeTrack],
    ['CW1556', '西西弗斯世系', null, true],
  ].map(([id, name, track, hasBack, cycleOverlay]) => ({
    id, name, track, hasBack, cycleOverlay, art: 'aibp/images/patterns/' + id + '.webp',
  }));
  const patternsById = new Map(TITAN_PATTERNS.map(pattern => [pattern.id, pattern]));
  const PATTERN_FIELDS = { traumaPatternId: '创伤样式', kratosPatternId: '克拉托斯样式' };

  function loadoutPatterns(titan, kit, cycle) {
    if (!titan) return [];
    const type = titanType(titan)?.id;
    return Object.keys(PATTERN_FIELDS).map(field => patternsById.get(Object.hasOwn(titan, field) ? titan[field] : kit?.[field])).filter(pattern =>
      pattern && (!pattern.cycleOverlay || ((!cycle || cycle === pattern.cycleOverlay)
        && (type === 'dreamwalker' || (type === 'spartan-dreamwalker' && pattern.id === 'BW0974')))));
  }

  function titanPatternFields(titan) {
    const trauma = patternsById.get(titan?.traumaPatternId);
    const kratos = patternsById.get(titan?.kratosPatternId);
    return {
      ...(Object.hasOwn(titan || {}, 'traumaPatternId') && { traumaPatternId: trauma?.track ? trauma.id : '' }),
      ...(Object.hasOwn(titan || {}, 'kratosPatternId') && { kratosPatternId: kratos && !kratos.track ? kratos.id : '' }),
    };
  }

  function traumaDeckLabel(deck) {
    return deck === 'none' ? '不抽取' : TRAUMA_DECKS[deck] || '';
  }

  const defaultTraumaTracks = {
    dreamwalker: standard, tt_earthshaker: standard,
    gamechanger: ranges(4, 8, 9), tt_mazerunner: ranges(2, 5, 8),
    logicbreaker: ['obol', ...ranges(3, 6, 8).slice(0, 8)],
  };

  function traumaTrack(value) {
    return Array.isArray(value) && value.length === 9 && Array.from(value).every(deck => deck === 'none' || Object.hasOwn(TRAUMA_DECKS, deck))
      ? value.slice() : null;
  }

  function defaultTraumaTrack(titan) {
    return defaultTraumaTracks[titanType(titan)?.id]?.slice() || null;
  }

  function loadoutTraumaTrack(titan, kit) {
    if (!titan) return null;
    const pattern = loadoutPatterns(titan, kit).find(pattern => pattern.track);
    const legacy = Object.hasOwn(titan, 'traumaPatternId') ? null : traumaTrack(kit?.traumaTrack);
    return traumaTrack(pattern?.track) || legacy || traumaTrack(titan.traumaTrack);
  }

  function titanLabel(titan) {
    const panel = dreamwalkerPanel(titan);
    const name = titan?.name && titan.name !== '泰坦' && titan.name !== titanType(titan)?.name
      ? titan.name : panel?.name || titan?.name || '泰坦';
    const { type } = titanTypeFields(panel ? loadoutTitan(titan) : titan);
    return [name, panel?.name !== name && panel?.name, type !== name && type, titan?.crippled ? '残废' : ''].filter(Boolean).join(' · ');
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

  // TTS physical-card audit, checked against contiguous printed IDs, plus
  // explicit supply limits from the local user-supplied card catalog.
  const gearCopyLimits = Object.freeze({
    AJ0160: 3, AJ0163: 2, AJ0165: 2, AJ0167: 2, AJ0169: 2, AJ0171: 2,
    AJ0173: 2, AJ0175: 2, AJ0177: 2, AJ0179: 2, AJ0181: 2, AJ0183: 2,
    AJ0185: 2, AJ0187: 2, AJ0189: 2, AJ0191: 2, AJ0193: 2, AJ0195: 2,
    AJ0197: 2, AJ0199: 3, AJ0202: 2, AJ0204: 2, AJ0206: 3, AJ0209: 2,
    AJ0211: 2, AJ0213: 2, AJ0215: 2, AJ0217: 2, AJ0219: 1, AJ0220: 2,
    AJ0222: 2, AJ0224: 2, AJ0226: 2, AJ0228: 2, AJ0230: 1, AJ0231: 2,
    AJ0233: 2, AJ0235: 2, AJ0237: 2, AJ0239: 2, AJ0241: 2, AJ0243: 2,
    AJ0245: 2, AJ0247: 2, AJ0249: 2, AJ0251: 2, AJ0253: 1, AJ0254: 1,
    AJ0255: 1, AJ0256: 1, AJ0258: 1, AJ0261: 1, AJ0262: 2, AJ0264: 1,
    AJ0266: 2, AJ0268: 1, AJ0269: 1, AJ0270: 1, AJ0271: 2, AJ0273: 1,
    AJ0274: 1, AJ0275: 2, AJ0277: 2, AJ0279: 1, AJ0280: 1, AJ0281: 1,
    AJ0282: 1, AJ0283: 1,
    BJ0827: 2, BJ0829: 2, BJ0831: 4, BJ0835: 2, BJ0837: 2, BJ0839: 2,
    BJ0841: 3, BJ0844: 1, BJ0845: 2, BJ0847: 2, BJ0849: 2, BJ0851: 1,
    BJ0852: 2, BJ0854: 2, BJ0856: 2, BJ0858: 1, BJ0859: 1, BJ0860: 2,
    BJ0862: 2, BJ0866: 2, BJ0868: 1, BJ0869: 2, BJ0871: 2, BJ0873: 2,
    BJ0875: 2, BJ0877: 2, BJ0879: 2, BJ0881: 2, BJ0883: 2, BJ0885: 2,
    BJ0887: 2, BJ0889: 2, BJ0894: 2, BJ0898: 2, BJ0900: 1, BJ0901: 1,
    BJ0902: 1, BJ0903: 1, BJ0904: 1, BJ0905: 1, BJ0906: 1, BJ0907: 1,
    BJ0908: 1, BJ0909: 1, BJ0910: 1, BJ0911: 2, BJ0913: 2, BJ0915: 2,
    BJ0917: 2, BJ0919: 2, BJ0921: 2, BJ0923: 2, BJ0925: 2, BJ0927: 1,
    BJ0928: 2, BJ0930: 2, BJ0932: 2, BJ0934: 2, BJ0936: 1, BJ0937: 1,
    BJ0938: 1, BJ0946: 2, BJ0948: 2, BJ0950: 2, BJ0952: 2, BJ0965: 1,
    BJ0966: 1, BJ0967: 1, BJ0969: 1,
    CJ1389: 2, CJ1391: 2, CJ1393: 2, CJ1395: 2, CJ1397: 2, CJ1399: 2,
    CJ1405: 2, CJ1407: 2, CJ1409: 2, CJ1411: 2, CJ1413: 2, CJ1415: 2,
    CJ1417: 2, CJ1419: 2, CJ1421: 2, CJ1423: 2, CJ1425: 2, CJ1427: 2,
    CJ1429: 2, CJ1431: 2, CJ1433: 2, CJ1435: 2, CJ1437: 2, CJ1439: 2,
    CJ1441: 2, CJ1443: 2, CJ1445: 2, CJ1447: 1, CJ1448: 2, CJ1450: 2,
    CJ1452: 2, CJ1454: 2, CJ1456: 2, CJ1458: 2, CJ1460: 2, CJ1462: 2,
    CJ1464: 2, CJ1466: 2, CJ1468: 2, CJ1470: 2, CJ1472: 2, CJ1477: 1,
    CJ1478: 1, CJ1479: 1, CJ1480: 1, CJ1481: 1, CJ1482: 1, CJ1483: 1,
    CJ1484: 1, CJ1485: 1, CJ1486: 1, CJ1487: 1, CJ1490: 1, CJ1491: 1,
    CJ1492: 2, CJ1494: 2, CJ1496: 2, CJ1498: 2, CJ1500: 2, CJ1504: 1,
    CJ1505: 1, CJ1506: 2, CJ1510: 2, CJ1512: 2, CJ1514: 2, CJ1518: 1,
    CJ1519: 2, CJ1521: 2, CJ1523: 2, CJ1525: 2, CJ1536: 1, CJ1537: 1,
    CJ1538: 1, CJ1539: 1, CJ1540: 2, CJ1542: 2, CJ1544: 2,
  });

  function copyLimit(id, overrides) {
    const base = baseGearId(gearKey(id));
    const override = overrides && Object.hasOwn(overrides, base) ? overrides[base] : null;
    return Number.isSafeInteger(override) && override > 0 ? override : gearCopyLimits[base] ?? null;
  }

  function stockTotals(value) {
    const totals = {};
    for (const [id, item] of Object.entries(normalize(value))) {
      const base = baseGearId(id);
      totals[base] = (totals[base] || 0) + item.quantity;
    }
    return totals;
  }

  function assertCopyLimit(id, quantity, overrides) {
    const limit = copyLimit(id, overrides);
    if (limit === null || quantity <= limit) return;
    const error = new Error(baseGearId(id) + ' 的实物上限为 ' + limit + ' 件。');
    error.code = 'GEAR_COPY_LIMIT';
    throw error;
  }

  function checkStockGrowth(previous, next, overrides) {
    const before = stockTotals(previous);
    for (const [id, quantity] of Object.entries(stockTotals(next))) {
      if (quantity > (before[id] || 0)) assertCopyLimit(id, quantity, overrides);
    }
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
  function adjust(value, gearId, delta, manufactured = false, overrides) {
    const id = gearKey(gearId);
    if (!id || !Number.isSafeInteger(delta) || delta === 0 || (manufactured && delta < 0)) {
      throw new Error('装备或数量无效');
    }
    const inventory = normalize(value);
    const record = inventory[id] || { quantity: 0, manufactured: 0 };
    const quantity = record.quantity + delta;
    const total = record.manufactured + (manufactured ? delta : 0);
    if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(total)) throw new Error('装备数量过大');
    if (delta > 0) assertCopyLimit(id, (stockTotals(inventory)[baseGearId(id)] || 0) + delta, overrides);
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
    inventory[destination] ||= { quantity: 0, manufactured: 0 };
    if (!Number.isSafeInteger(inventory[destination].quantity + 1)) throw new Error('装备数量过大');
    source.quantity -= 1;
    inventory[destination].quantity += 1;
    return inventory;
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
      ...(value?.titanId && patternsById.get(value.traumaPatternId)?.track && { traumaPatternId: value.traumaPatternId }),
      ...(value?.titanId && patternsById.has(value.kratosPatternId) && !patternsById.get(value.kratosPatternId).track
        && { kratosPatternId: value.kratosPatternId }),
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
    if (next.titanPanelId && (Object.hasOwn(assignedTitan || {}, 'panelId') || titanType(assignedTitan)?.id !== 'dreamwalker')) delete next.titanPanelId;
    if (!assignedTitan) delete next.traumaTrack;
    const assignedPatterns = loadoutPatterns(assignedTitan, next, record.cycle);
    for (const field of Object.keys(PATTERN_FIELDS)) {
      if (Object.hasOwn(assignedTitan || {}, field) || !assignedPatterns.some(pattern => pattern.id === next[field])) delete next[field];
    }
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

  const gearGroups = { arm: '武器', armor: '防具', attachment: '附件', aid: '助具', other: '其他装备' };
  function groupGear(items, category) {
    return Object.entries(gearGroups).flatMap(([key, label]) => {
      const matches = items.filter(item => {
        const kind = category(item)?.split('_')[0];
        return (Object.hasOwn(gearGroups, kind) ? kind : 'other') === key;
      });
      return matches.length ? [{ key, label, items: matches }] : [];
    });
  }

  return {
    gearGroups, groupGear, gearCopyLimits, copyLimit, stockTotals, checkStockGrowth, ascensionEnabled, baseGearId, ascendedCycle, nextCycle, ascend, loadoutTemplates,
    TITAN_NAMES_ZH, TITAN_TYPES, DREAMWALKER_PANELS, TRAUMA_DECKS, traumaTrack, defaultTraumaTrack, loadoutTraumaTrack,
    TITAN_PATTERNS, PATTERN_FIELDS, loadoutPatterns, titanPatternFields, traumaDeckLabel,
    dreamwalkerPanel, loadoutTitan, titanType, titanTypeFields, titanLabel, titanArtwork,
    gearKey, normalize, adjust, normalizeLoadout, loadoutTitans, titanIdFor, assignedLoadouts, gearReservations, saveLoadout,
  };
});
