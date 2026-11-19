import inventory from '../../technology/gear-inventory.js';
import heroCatalog from '../../hero/hero-catalog.js';
import { ApiError } from './campaign.js';
import { priorityTarget, setupRoomBoard } from './board.js';
import { createTrauma } from './room-trauma.js';
import { roomProjection } from './room-projection.js';
import { setTurnPhase } from './room-turn.js';

const skills = { courage: '勇气', wisdom: '智慧', will: '意志', endurance: '耐力', cunning: '狡黠', fury: '力量' };
const fail = (message, status = 400) => { throw new ApiError(status, message); };
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

export function createSquad(record, roster, language, cycle, gearName) {
  const arsenal = inventory.normalize(record.arsenal);
  const titans = inventory.loadoutTitans(record).map(titan => ({
    id: String(titan.id), name: text(titan.name, 80), ...inventory.titanTypeFields(titan),
    count: Math.max(1, Math.min(999, Number(titan.count) || 1)), crippled: Boolean(titan.crippled),
    traumaTrack: inventory.traumaTrack(titan.traumaTrack),
  }));
  const rosterLabels = roster.map(hero => ({ id: hero.id, name: heroCatalog.heroDisplayName(hero), argonaut: hero.argonaut }));
  const validIds = new Set(roster.map(hero => hero.id));
  const loadouts = Object.fromEntries(Object.entries(record.loadouts || {}).filter(([id]) => validIds.has(id)).map(([id, loadout]) => {
    const kit = inventory.normalizeLoadout(loadout);
    kit.titanId = inventory.titanIdFor(record, kit.titanId);
    return [id, kit];
  }));
  const gearNames = Object.fromEntries([...new Set([...Object.keys(arsenal), ...Object.values(loadouts).flatMap(kit => Object.keys(kit.gear))])]
    .filter(key => !key.startsWith('T:')).map(key => [key, gearName(key)]));
  return { phase: 'story', cycle, language,
    battleNumber: 0, hostSeat: null, checks: [], stock: { arsenal, titans, loadouts, roster: rosterLabels }, gearNames };
}

export function squadSkills(hero) {
  const base = hero.baseSkills || hero.skills || {};
  const totals = Object.fromEntries(Object.keys(skills).map(key => [key, Math.max(0, Math.min(100, Number.parseInt(base[key], 10) || 0))]));
  for (const card of heroCatalog.mnemosCards(hero)) {
    const keys = card.fated ? card.skills || [card.skill] : [card.skill1, card.skill2];
    for (const key of keys) if (Object.hasOwn(totals, key)) totals[key] += card.fated ? -1 : 1;
  }
  return totals;
}

export function squadStats(raw) {
  return Object.fromEntries(['danger', 'fate', 'rage'].map(key => [
    key, Math.max(0, Math.min(999, Number.parseInt(raw?.[key] ?? (key === 'rage' && raw?.fury), 10) || 0)),
  ]));
}

export function latestBattleRoll(room) {
  return room.rolls?.find(roll => roll.id === room.lastBattleRollId) || room.rolls?.[0] || null;
}

export function squadView(room, actor) {
  const squad = room.squad;
  if (!squad) return null;
  const { phase, cycle, language, battleNumber, hostSeat, checks, story, stock, gearNames } = squad;
  const result = { phase, cycle, language, battleNumber, hostSeat, checks, recap: squad.recap, lastBattleRoll: latestBattleRoll(room) || squad.lastBattleRoll || null };
  if (actor.role === 'viewer' || actor.role === 'host') result.story = story;
  if (actor.role === 'host' || actor.role === 'player') {
    result.loadouts = room.heroes.map(hero => inventory.normalizeLoadout(stock.loadouts[hero.id]));
    result.titans = stock.titans;
    const roster = new Map(Object.keys(stock.loadouts).map(id => [id, { id, name: '其他英雄' }]));
    for (const { id, name, argonaut } of [...(stock.roster || []), ...room.heroes]) roster.set(id, { id, name, argonaut });
    const reservations = inventory.gearReservations(stock, [...roster.values()]);
    result.gear = Object.entries(gearNames).map(([id, name]) => ({ id, name, count: stock.arsenal[id]?.quantity || 0, holders: reservations.get(id) || [] }));
  }
  return result;
}

function cleanStory(raw) {
  if (!raw || typeof raw !== 'object') fail('没有可投屏的剧情。');
  const story = Object.fromEntries(['id', 'title', 'bookTitle', 'bookId', 'entryKey', 'section'].map(key => [key, text(raw[key], 240)]));
  story.text = text(raw.text, 24000);
  story.fallbackText = text(raw.fallbackText, 24000);
  story.images = Array.isArray(raw.images) ? raw.images.filter(src => typeof src === 'string'
    && /^\/story\/data\/ato-storybook-key-scans\/[\w%./-]+\.(?:jpg|jpeg|webp|png)$/i.test(src)
    && !src.includes('..') && src.length < 500).slice(0, 4) : [];
  story.imagesOnly = raw.imagesOnly === true && story.images.length > 0;
  const media = raw.mixedMedia;
  if (media?.schema === 1 && /^c[1-5]$/.test(media.bookId) && ['official','fan'].includes(media.variant)) {
    story.mixedMedia = { schema: 1, bookId: media.bookId, variant: media.variant, entryKey: text(media.entryKey, 240) };
  }
  if (!story.text && !story.fallbackText && !story.images.length) fail('没有可投屏的剧情。');
  return story;
}

function refreshCombatKit(room) {
  const { stock, gearNames } = room.squad;
  for (const hero of room.heroes) {
    const kit = inventory.normalizeLoadout(stock.loadouts[hero.id]);
    const titan = inventory.loadoutTitan(stock.titans.find(entry => entry.id === kit.titanId), kit.titanPanelId);
    hero.titan = titan ? {
      name: titan.name, ...inventory.titanTypeFields(titan), panelId: titan.panelId, crippled: titan.crippled, traumaTrack: inventory.traumaTrack(titan.traumaTrack),
    } : null;
    hero.gear = Object.entries(kit.gear).map(([id, count]) => ({ id, name: gearNames[id] || id, count, used: 0 }));
    hero.stats = { danger: 0, rage: 0, fate: 0 };
    hero.condition = 'standing';
    hero.mnemos = hero.mnemos.map(({ state, ...card }) => card);
  }
}

export function applySquad(room, actor, body, randomInt) {
  const squad = room.squad;
  if (!squad) fail('此房间不是常驻小队。', 409);
  const host = actor.role === 'host';
  if (['squad-phase','squad-start','squad-story','squad-host-seat','squad-remove-player','squad-disband'].includes(body.type) && !host) fail('只有房主可以操作。', 403);

  if (body.type === 'squad-disband') {
    room.closed = true;
    room.publicLobby = false;
    return;
  }
  if (body.type === 'squad-phase') {
    if (squad.phase === 'battle' || !['story','prep'].includes(body.phase)) fail('请先结束当前战斗。', 409);
    squad.phase = body.phase;
    return;
  }
  if (body.type === 'squad-story') {
    if (squad.phase !== 'story') fail('请先切回读剧情。', 409);
    squad.story = cleanStory(body.story);
    return;
  }
  if (body.type === 'squad-start') {
    if (squad.phase !== 'prep' || body.battleNumber !== squad.battleNumber) fail('请先进入备战，或刷新小队状态。', 409);
    const board = setupRoomBoard(body.board, room.heroes.length);
    const trauma = createTrauma(squad.cycle, body.tutorial === true, randomInt);
    if (latestBattleRoll(room)) squad.lastBattleRoll = latestBattleRoll(room);
    refreshCombatKit(room);
    room.priorityTarget = priorityTarget({ heroes: room.heroes });
    room.activity = [];
    delete room.battleStats;
    Object.assign(room, { board, trauma, projection: roomProjection(body.projection, board.apostle), round: 1,
      rolls: [], lastBattleRollId: null, argoAbilities: {}, pool: Object.fromEntries(Object.keys(room.pool).map(key => [key, 0])) });
    setTurnPhase(room, 'apostle');
    squad.phase = 'battle';
    squad.battleNumber++;
    return;
  }

  const seat = body.seat;
  const hero = Number.isInteger(seat) ? room.heroes[seat] : null;
  if (!hero) fail('请选择一个英雄。');
  if (body.type === 'squad-remove-player') {
    if (!room.secrets.players[seat] || squad.hostSeat === seat) fail('这个席位没有可移除的队员。', 409);
    room.secrets.players[seat] = null;
    hero.player = '';
    return;
  }
  if (body.type === 'squad-host-seat') {
    if (squad.phase === 'battle' || (room.secrets.players[seat] && body.reclaim !== true)) {
      fail('该席位已认领，或当前无法认领。', 409);
    }
    if (squad.hostSeat !== null && squad.hostSeat !== seat) room.heroes[squad.hostSeat].player = '';
    room.secrets.players[seat] = null;
    squad.hostSeat = seat;
    hero.player = text(body.player, 32) || room.owner?.account || '房主';
    return;
  }
  if ((host ? squad.hostSeat : actor.seat) !== seat) fail('只能操作自己认领的英雄。', 403);

  if (body.type === 'squad-kit') {
    if (squad.phase !== 'prep') fail('只有备战时可以更改配装。', 409);
    const { stock } = squad;
    const current = inventory.normalizeLoadout(stock.loadouts[hero.id]);
    const next = inventory.normalizeLoadout({ ...body.kit, player: current.player });
    if (next.titanId && !stock.titans.some(titan => titan.id === next.titanId)) fail('军械库中没有这个泰坦。');
    for (const [id, count] of Object.entries(next.gear)) {
      if (!Object.hasOwn(squad.gearNames, id) || count > 99) fail('装备或数量无效。');
    }
    const roster = [...new Set([...Object.keys(stock.loadouts), ...room.heroes.map(item => item.id)])].map(id => ({ id }));
    try {
      const updated = inventory.saveLoadout(stock, roster, hero.id, body.base, next);
      if (updated) squad.stock = updated;
    } catch (error) { fail(error.message, 409); }
    return;
  }
  if (body.type === 'squad-stat' || body.type === 'squad-reroll') {
    if (squad.phase === 'battle') fail('请返回读剧情或备战。', 409);
    const values = squadStats(hero.storyStats);
    if (body.type === 'squad-stat') {
      if (!Object.hasOwn(values, body.key) || ![-1, 1].includes(body.delta)) fail('数值调整无效。');
      const next = values[body.key] + body.delta;
      if (next < 0 || next > 999) fail('数值已到上限或下限。', 409);
      values[body.key] = next;
    } else {
      const latest = squad.checks.find(item => item.seat === seat);
      if (!latest || latest.id !== body.roll || latest.target === null || latest.replaces) fail('只能对自己的最近一次检定重掷一次。', 409);
      if (values.fate >= 999) fail('命运已到上限。', 409);
      values.fate++;
      const die = randomInt(10) + 1;
      const sum = die + latest.bonus + latest.modifier;
      const success = die === 10 || (die !== 1 && sum >= latest.target);
      squad.checks = [{ ...latest, id: body.id, replaces: latest.id, values: [die], sum, success, at: Date.now() },
        ...squad.checks.filter(item => item.id !== latest.id)].slice(0, 30);
    }
    hero.storyStats = values;
    return;
  }
  if (body.type === 'squad-roll') {
    if (squad.phase === 'battle') fail('战斗中请在战斗室掷骰。', 409);
    const { sides, count, skill, target, modifier } = body;
    if (![6,10].includes(sides) || !Number.isInteger(count) || count < 1 || count > 6) fail('骰子数量或种类无效。');
    const check = target !== null;
    if (check && (sides !== 10 || count !== 1 || !Number.isInteger(target) || target < 1 || target > 99
      || (skill && !Object.hasOwn(skills, skill)) || !Number.isInteger(modifier) || Math.abs(modifier) > 99)) fail('检定参数无效。');
    const values = Array.from({ length: count }, () => randomInt(sides) + 1);
    const bonus = check && skill ? hero.skills[skill] : 0;
    const sum = values.reduce((total, value) => total + value, 0) + bonus + (check ? modifier : 0);
    const success = check ? values[0] === 10 || (values[0] !== 1 && sum >= target) : null;
    squad.checks = [{ id: body.id, seat, hero: hero.name, sides, values, skill: check ? skills[skill] || '' : '',
      bonus, modifier: check ? modifier : 0, target, sum, success, at: Date.now() }, ...squad.checks].slice(0, 30);
    return;
  }
  fail('未知的小队操作。');
}
