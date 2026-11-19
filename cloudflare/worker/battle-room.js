import { DurableObject } from 'cloudflare:workers';
import heroCatalog from '../../hero/hero-catalog.js';
import inventory from '../../technology/gear-inventory.js';
import cardState from '../../aibp/room-card-state.js';
import roomDice from '../../aibp/room-dice.js';
import { roomProjection } from './room-projection.js';
import { applyTurn, claimTurn, setTurnPhase } from './room-turn.js';
import { battleRecap, battleStats, countReaction, setRollWounds } from './room-recap.js';
import battleConfig from '../../technology/battle-config.js';
import techDictionary from '../../technology/tech_card_dictionary.min.json';
import gearProduction from '../../technology/ato_gear_production.json';
import { ApiError, activeCycle, errorResponse, object, response } from './campaign.js';
import { applyRoomBoard, priorityTarget, setupRoomBoard } from './board.js';

import { applyTrauma, createTrauma, traumaView } from './room-trauma.js';
import { applySquad, createSquad, syncLoadoutTrauma, latestBattleRoll, squadSkills, squadStats, squadView } from './room-squad.js';

export const roomIdPattern = /^[a-f0-9]{32}$/;
const secretPattern = /^[a-f0-9]{64}$/;
const protocol = 'ato-battle-v1';
const poolKeys = ['opening', 'break', 'diversion', 'rouse', 'black', 'fire', 'hope'];
const stats = ['danger', 'rage', 'fate'];
const titanMarkerNames = { despair: '绝望', ambrosia: '神浆' };
const conditions = ['standing', 'down', 'rising', 'dead'];
const encoder = new TextEncoder();

function clean(value, limit = 100) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function randomInt(max) {
  const range = 2 ** 32 - (2 ** 32 % max);
  const sample = new Uint32Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= range);
  return sample[0] % max;
}

function newSecret() {
  return crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
}

async function hash(secret) {
  if (!secretPattern.test(secret || '')) return '';
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(secret))),
    byte => byte.toString(16).padStart(2, '0')).join('');
}

function reject(message, status = 400) {
  throw new ApiError(status, message);
}

function counter(current, delta, limit) {
  if (delta !== 1 && delta !== -1) reject('只能增加或减少 1。');
  if (current + delta < 0 || current + delta > limit) reject('数值已到范围上限或下限。', 409);
  return current + delta;
}

function equipmentName(id) {
  const name = gearProduction.gearCards[inventory.baseGearId(id)]?.trim();
  const label = name?.match(/[\u3400-\u9fff].*/u)?.[0] || name || id;
  const cycle = inventory.ascendedCycle(id);
  return label + (cycle ? ' · 登升至 ' + cycle.toUpperCase() : '');
}

export function squadAbilityOptions(campaign) {
  const { limit, reserveLimit, cards } = battleConfig.availability(campaign, techDictionary);
  return { limit, reserveLimit, cards };
}

export function squadRosterForCampaign(campaign) {
  return heroCatalog.activeHeroes(campaign).map(hero => ({
    id: hero.id, name: clean(heroCatalog.heroDisplayName(hero)), argonaut: hero.argonaut,
  }));
}

export function squadHeroStats(campaign) {
  return Object.fromEntries(heroCatalog.activeHeroes(campaign).map(hero => [hero.id, hero.triskelion || {}]));
}

export function squadTitanTrauma(campaign) {
  const { record } = battleConfig.availability(campaign, techDictionary);
  const titanTracks = Object.fromEntries(inventory.loadoutTitans(record)
    .map(titan => [String(titan.id), inventory.traumaTrack(titan.traumaTrack)]));
  const loadoutTracks = Object.fromEntries(inventory.assignedLoadouts(record, heroCatalog.activeHeroes(campaign))
    .map(([id, raw]) => {
      const { titanId, titanPanelId, traumaTrack } = inventory.normalizeLoadout(raw);
      return [id, { titanId: inventory.titanIdFor(record, titanId), titanPanelId, traumaTrack }];
    }));
  return { titanTracks, loadoutTracks };
}

export async function createBattleRoom(env, campaign, payload, owner) {
  const available = heroCatalog.activeHeroes(campaign);
  const selected = payload?.heroIds;
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 4
      || new Set(selected).size !== selected.length || !selected.every(id => available.some(hero => hero.id === id))) {
    reject('请从当前战役选择 1 至 4 位不同的英雄。');
  }
  const title = clean(payload.title, 80) || owner?.saveName || '联机小队';
  const profile = campaign.sections.dashboard?.activeProfileId || 'default';
  const section = campaign.sections.record;
  const records = section?.users || section?.accounts;
  const record = (records ? records[profile] : section) || {};
  const titans = inventory.loadoutTitans(record);
  const heroes = selected.map(id => {
    const hero = available.find(entry => entry.id === id);
    const kit = inventory.normalizeLoadout(Object.hasOwn(record.loadouts || {}, id) ? record.loadouts[id] : null);
    const titan = inventory.loadoutTitan(titans.find(entry => String(entry.id) === inventory.titanIdFor(record, kit.titanId)), kit.titanPanelId);
    const mnemos = heroCatalog.mnemosCards(hero).map(card => ({
      id: card.card, name: card.zh, progress: card.progress, limit: card.limit, fated: Boolean(card.fated),
    }));
    return {
      id, name: clean(heroCatalog.heroDisplayName(hero)),
      ...(payload.squad === true && { skills: squadSkills(hero) }),
      argonaut: heroCatalog.ARGONAUTS.find(argonaut => argonaut.id === hero.argonaut)?.id,
      titan: titan ? {
        name: clean(titan.name), ...inventory.titanTypeFields(titan),
        panelId: titan.panelId, crippled: Boolean(titan.crippled), traumaTrack: inventory.loadoutTraumaTrack(titan, kit),
      } : null,
      gear: Object.entries(kit.gear).map(([id, count]) => ({ id, name: equipmentName(id), count, used: 0 })),
      mnemos, stats: { danger: 0, rage: 0, fate: 0 }, ...(payload.squad === true && { storyStats: squadStats(hero.triskelion) }), condition: 'standing', player: '',
    };
  });
  const board = payload.board ? setupRoomBoard(payload.board, heroes.length) : null;
  const availableAbilities = battleConfig.availability(campaign, techDictionary);
  const selectedConfig = payload.battleConfig || availableAbilities.record.battleConfigurations
    ?.find(config => config.id === availableAbilities.record.activeBattleConfiguration);
  let configuration;
  try { configuration = battleConfig.prepare(selectedConfig, availableAbilities); }
  catch (error) { reject(error.message); }
  const cycle = activeCycle(campaign);
  const trauma = createTrauma(cycle, payload.traumaTutorial === true, randomInt);
  const termLanguage = campaign.sections.dashboard?.profiles?.[profile]?.termLanguage;
  const language = ['official','fan','en'].includes(payload.language) ? payload.language
    : ['official','fan','en'].includes(termLanguage) ? termLanguage : 'official';
  const squad = payload.squad === true ? createSquad(record, available, language, cycle, equipmentName) : null;
  if (squad) {
    const { limit, reserveLimit, cards } = availableAbilities;
    squad.abilityOptions = { limit, reserveLimit, cards };
  }
  const id = crypto.randomUUID().replaceAll('-', '');
  return env.BATTLE_ROOMS.getByName(id).fetch('https://battle-room.internal/create', {
    method: 'POST', body: JSON.stringify({ id, title, heroes, board, configuration, trauma, squad, language, owner, publicLobby: payload.publicLobby === true, projection: roomProjection(payload.projection, board?.apostle) }),
  });
}

export async function battleRequest(env, request, url) {
  const parts = url.pathname.split('/');
  if (parts.length !== 5 || !roomIdPattern.test(parts[3])) reject('战斗室不存在。', 404);
  if (!['state', 'lobby', 'join', 'action', 'socket', 'library'].includes(parts[4])) reject('战斗室接口不存在。', 404);
  const origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    reject('请从本站加入战斗室。', 403);
  }
  return env.BATTLE_ROOMS.getByName(parts[3]).fetch(request);
}

function publicSquadLoadouts(room) {
  const { stock, gearNames } = room.squad;
  return { kits: room.heroes.map(hero => {
    const kit = inventory.normalizeLoadout(stock.loadouts[hero.id]);
    const titan = inventory.loadoutTitan(stock.titans.find(entry => entry.id === kit.titanId), kit.titanPanelId);
    return { titan: titan && inventory.titanLabel(titan),
      gear: Object.entries(kit.gear).map(([id, count]) => ({ name: gearNames[id] || id, count })) };
  }) };
}

const activityLabels = {
  'turn-take': '开始英雄回合', 'turn-finish': '结束英雄回合',
  'board-move': '移动泰坦', 'board-undo-move': '撤回上一步', 'board-apostle-move': '移动骇物',
  'board-apostle-undo': '撤回骇物移动', 'board-face': '调整骇物朝向', 'priority-target': '调整首要目标', round: '开启新一轮',
  stat: '调整三曲盘', 'titan-marker': '调整泰坦标记', condition: '调整泰坦状态', gear: '使用装备', 'gear-card': '调整装备卡', 'gear-ready-all': '回正所有横置装备',
  'mnemos-card': '调整旧忆卡', 'argo-use': '使用阿尔戈能力', 'argo-undo': '撤回阿尔戈能力',
  'trauma-draw': '抽取创伤或结算受击', 'trauma-resolve': '结算创伤', 'pool-clear': '清空克拉托斯池',
  reroll: '重掷骰子', convert: '转换威力骰', 'roll-wounds': '记录击破结果',
};

function recordBattleActivity(room, actor, body) {
  if (!Object.hasOwn(activityLabels, body.type)) return;
  const seat = Number.isInteger(body.seat) && room.heroes[body.seat] ? body.seat : null;
  const hero = room.heroes[seat];
  let detail = '';
  if (body.type === 'gear' || body.type === 'gear-card') detail = hero?.gear.find(item => item.id === body.key)?.name;
  if (body.type === 'mnemos-card') detail = hero?.mnemos.find(item => item.id === body.key)?.name;
  if (body.type === 'stat') detail = ({ rage: '怒气', fate: '命运', danger: '凶险' }[body.key]) + (body.delta > 0 ? ' +1' : ' −1');
  if (body.type === 'titan-marker') detail = titanMarkerNames[body.key] + (body.delta > 0 ? ' +1' : ' −1');
  if (body.type === 'roll-wounds') detail = roomDice.woundResults[body.value];
  if (body.type === 'board-move') detail = String.fromCharCode(64 + body.point.row) + body.point.column;
  const by = actor.role === 'host' ? '房主' : room.heroes[actor.seat]?.player || room.heroes[actor.seat]?.name;
  room.activity = [{ kind: body.type, label: activityLabels[body.type], by, seat, detail, round: room.round },
    ...(room.activity || [])].slice(0, 20);
}

export class BattleRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.storyLibrary = env.ATO_STORY_LIBRARY;
    this.directory = env.ROOM_DIRECTORY?.getByName("active");
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS room (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), data TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)');
  }

  async syncDirectory(room) {
    if (!this.directory) return;
    const entry = { id: room.id, title: room.title, round: room.round, revision: room.revision,
      hostName: room.owner?.account || room.heroes[room.squad?.hostSeat]?.player || '',
      saveName: room.owner?.saveName || room.title,
      seats: room.heroes.length, available: room.heroes.filter(hero => !hero.player).length,
      open: room.publicLobby === true && !room.closed,
      ...(room.squad && { squad: true, phase: room.squad.phase }) };
    await this.directory.fetch('https://directory.internal/put', { method: 'POST', body: JSON.stringify(entry) });
  }

  load() {
    const row = this.sql.exec('SELECT data FROM room WHERE singleton = 1').toArray()[0];
    if (!row) reject('战斗室不存在。', 404);
    return JSON.parse(row.data);
  }

  save(room) {
    this.sql.exec('INSERT OR REPLACE INTO room VALUES (1, ?)', JSON.stringify(room));
  }

  view(room, actor) {
    const { secrets, trauma, squad, owner, battleStats, ...state } = room;
    return { ok: true, room: { ...state, priorityTarget: priorityTarget(room), trauma: traumaView(room, actor),
      ...(squad && { squad: squadView(room, actor), damageBySeat: room.heroes.map((_, seat) => battleStats?.[seat]?.damage ?? 0) }) }, actor };
  }

  actor(room, secretHash) {
    if (secretHash && room.secrets.host === secretHash) return { role: 'host' };
    if (secretHash && room.secrets.viewer === secretHash) return { role: 'viewer' };
    const seat = secretHash ? room.secrets.players.findIndex(value => value === secretHash) : -1;
    if (seat >= 0) return { role: 'player', seat };
    reject('请重新加入战斗室。', 401);
  }

  revokeSeat(seat) {
    for (const socket of this.ctx.getWebSockets()) {
      const actor = socket.deserializeAttachment();
      if (actor.role === 'player' && actor.seat === seat) socket.close(4001, 'Seat reassigned');
    }
  }

  publish(room) {
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(JSON.stringify(this.view(room, socket.deserializeAttachment()))); }
      catch { socket.close(1011, 'Reconnect'); }
    }
  }

  async create(request) {
    const { id, title, heroes, board, projection, configuration, trauma, squad, language, owner, publicLobby } = await request.json();
    const keys = { host: newSecret(), viewer: newSecret(), invite: newSecret() };
    const [host, viewer, invite] = await Promise.all(Object.values(keys).map(hash));
    const room = {
      id, title, heroes, board, projection, configuration, trauma, ...(squad && { squad }), language, owner, publicLobby: publicLobby === true, round: 1, revision: 0, closed: false,
      pool: Object.fromEntries(poolKeys.map(key => [key, 0])), rolls: [],
      secrets: { host, viewer, invite, players: heroes.map(() => null) },
    };
    this.save(room);
    await this.syncDirectory(room);
    return response({ ...this.view(room, { role: 'host' }), keys }, 201);
  }

  async linkOwner(request) {
    const { account, profile, saveName, keys, abilityOptions, storyStats, titanTracks, loadoutTracks, roster } = await request.json();
    const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    const [host, invite, viewer] = await Promise.all([token, keys?.invite, keys?.viewer].map(hash));
    const room = this.load();
    if (!host || host !== room.secrets.host) reject('只有原房主可以绑定小队。', 403);
    if (!room.squad || room.closed) reject('小队已解散或不存在。', 404);
    if (room.owner && (room.owner.account !== account || room.owner.profile !== profile)) reject('该小队已绑定到其他存档。', 409);
    const name = clean(saveName, 80) || '默认存档';
    const libraryAnchor = this.storyAnchor(room);
    const validKeys = invite === room.secrets.invite && viewer === room.secrets.viewer;
    const rosterChanged = Array.isArray(roster) && JSON.stringify(roster) !== JSON.stringify(room.squad.stock.roster);
    if (rosterChanged) room.squad.stock.roster = roster;
    let tracksChanged = false;
    for (const titan of room.squad.stock.titans) {
      if (!titanTracks || !Object.hasOwn(titanTracks, titan.id)) continue;
      const track = inventory.traumaTrack(titanTracks[titan.id]);
      if (JSON.stringify(titan.traumaTrack || null) === JSON.stringify(track)) continue;
      titan.traumaTrack = track;
      tracksChanged = true;
    }
    if (syncLoadoutTrauma(room.squad.stock, loadoutTracks)) tracksChanged = true;
    if (tracksChanged || rosterChanged || !room.owner || room.owner.saveName !== name || JSON.stringify(room.squad.abilityOptions) !== JSON.stringify(abilityOptions)) {
      room.owner = { account, profile, saveName: name, libraryAnchor };
      room.squad.abilityOptions = abilityOptions;
      for (const hero of room.heroes) hero.storyStats ??= squadStats(storyStats[hero.id]);
      room.revision++;
      this.save(room);
      this.publish(room);
      await this.syncDirectory(room);
    }
    return response({ ok: true, libraryAnchor, ...(validKeys && { keys: { host: token, invite: keys.invite, viewer: keys.viewer } }) });
  }

  storyAnchor(room) {
    const allowed = this.storyLibrary && JSON.parse(this.storyLibrary).squads;
    if (!Array.isArray(allowed)) return null;
    return [room.id, room.owner?.libraryAnchor].find(id => id && allowed.includes(id)) || null;
  }

  retireLegacy() {
    const room = this.load();
    if (room.squad || room.closed || !room.publicLobby) return response({ ok: true, retired: room.closed });
    room.closed = true;
    room.publicLobby = false;
    room.revision++;
    this.save(room);
    this.publish(room);
    return response({ ok: true, retired: true });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const route = url.pathname.split('/').at(-1);
    try {
      if (url.hostname === 'battle-room.internal' && request.method === 'POST') {
        if (url.pathname === '/create') return await this.create(request);
        if (url.pathname === '/link-owner') return await this.linkOwner(request);
        if (url.pathname === '/retire-legacy') return this.retireLegacy();
      }
      if (route === 'socket') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') reject('需要 WebSocket 连接。', 426);
        const [version, secret, extra] = (request.headers.get('Sec-WebSocket-Protocol') || '').split(/,\s*/);
        if (version !== protocol || extra) reject('战斗室连接格式无效。');
        const secretHash = await hash(secret);
        const room = this.load();
        const actor = this.actor(room, secretHash);
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment(actor);
        server.send(JSON.stringify(this.view(room, actor)));
        return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': protocol } });
      }
      const expectedMethod = ['state', 'library'].includes(route) ? 'GET' : 'POST';
      if (request.method !== expectedMethod) reject('请求方法不支持。', 405);
      const secretHash = await hash(request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]);
      const body = expectedMethod === 'POST' ? await this.payload(request, route === 'action' ? 98304 : 4096) : null;
      const newPlayer = route === 'join' ? await hash(body.playerKey) : '';
      const room = this.load();
      if (route === 'join' || route === 'lobby') {
        const invited = Boolean(secretHash && secretHash === room.secrets.invite);
        if (!(body.quick === true && room.publicLobby === true) && !invited) reject('邀请链接无效，或房主尚未开放快速加入。', 403);
        if (room.closed) reject(room.squad ? '小队已解散。' : '本场战斗已结束。', 409);
        const reclaim = invited && room.squad?.phase !== 'battle' && Boolean(room.squad);
        if (route === 'lobby') return response({ ok: true, title: room.title, language: room.language || 'official', heroes: room.heroes.map((hero, seat) => ({
          name: hero.name, taken: Boolean(hero.player), reclaimable: reclaim && Boolean(room.secrets.players[seat]),
          argonaut: hero.argonaut, titan: hero.titan, gear: hero.gear,
        })), ...(room.squad && { squad: true, language: room.squad.language, ...publicSquadLoadouts(room) }) });
        const result = this.join(room, body, newPlayer, reclaim && body.reclaim === true);
        await this.syncDirectory(room);
        return result;
      }
      const actor = this.actor(room, secretHash);
      if (route === 'state') return response(this.view(room, actor));
      if (route === 'library') {
        if (actor.role !== 'host' || !room.squad || room.closed) reject('请用小队房主权限打开故事书。', 403);
        if (!this.storyLibrary) reject('线上故事正文尚未导入。', 503);
        const { version, key } = JSON.parse(this.storyLibrary);
        if (!this.storyAnchor(room)) reject('请用房主账号登录后打开故事书。', 403);
        const story = room.squad.story;
        const current = /^c[1-5]$/.test(story?.bookId || '') && story.entryKey
          ? { book: story.bookId, key: story.entryKey } : null;
        return response({ ok: true, version, key, cycle: room.squad.cycle, language: room.squad.language, phase: room.squad.phase, current });
      }
      const previousPlayers = room.secrets.players.slice();
      const result = this.action(room, actor, body, previousPlayers);
      if (["public-lobby", "end", "round", "squad-phase", "squad-start", "squad-host-seat", "squad-remove-player", "squad-disband"].includes(body.type)) await this.syncDirectory(room);
      return result;
    } catch (error) {
      return errorResponse(error);
    }
  }

  async payload(request, limit) {
    const reader = request.body?.getReader();
    if (!reader) reject('缺少请求内容。');
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          reject('战斗操作请求过大。', 413);
        }
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
    let parsed;
    try { parsed = JSON.parse(text + decoder.decode()); } catch { reject('请求格式无效。'); }
    if (!object(parsed)) reject('请求格式无效。');
    return parsed;
  }

  webSocketMessage(socket) {
    socket.close(1008, 'Use HTTP for actions');
  }

  join(room, body, playerHash, reclaim) {
    const { seat } = body;
    const player = clean(body.player, 32);
    if (!playerHash || !Number.isInteger(seat) || !room.heroes[seat] || !player) reject('请选择英雄并填写玩家名。');
    const existing = room.secrets.players.indexOf(playerHash);
    if (existing === seat) return response(this.view(room, { role: 'player', seat }));
    if (existing >= 0 || (room.secrets.players[seat] && !reclaim) || room.squad?.hostSeat === seat) reject('这位英雄已被认领，请选另一位。', 409);
    const replaced = Boolean(room.secrets.players[seat]);
    room.secrets.players[seat] = playerHash;
    room.heroes[seat].player = player;
    room.revision++;
    this.save(room);
    if (replaced) this.revokeSeat(seat);
    this.publish(room);
    return response(this.view(room, { role: 'player', seat }));
  }

  action(room, actor, body, previousPlayers) {
    if (actor.role === 'viewer') reject('投屏页面只能查看。', 403);
    if (typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id)) reject('操作编号无效。');
    if (this.sql.exec('SELECT 1 FROM actions WHERE id = ?', body.id).toArray().length) {
      return response(this.view(room, actor));
    }
    if (room.closed) reject(room.squad ? '小队已解散。' : '本场战斗已结束。', 409);
    this.apply(room, actor, body);
    recordBattleActivity(room, actor, body);
    room.revision++;
    this.ctx.storage.transactionSync(() => {
      this.save(room);
      this.sql.exec('INSERT INTO actions VALUES (?, ?)', body.id, room.revision);
      this.sql.exec('DELETE FROM actions WHERE revision <= ?', room.revision - 512);
    });
    previousPlayers.forEach((key, seat) => {
      if (key && key !== room.secrets.players[seat]) this.revokeSeat(seat);
    });
    this.publish(room);
    return response(this.view(room, actor));
  }

  apply(room, actor, body) {
    if (body.type === 'squad-start' && actor.role === 'host' && room.squad?.phase === 'prep' && body.battleConfig) {
      const available = room.squad.abilityOptions;
      if (!available) reject('此小队沿用已保存的战斗配置。', 409);
      try { room.configuration = battleConfig.prepare(body.battleConfig, available); }
      catch (error) { reject(error.message); }
    }
    if (typeof body.type === 'string' && body.type.startsWith('squad-')) return applySquad(room, actor, body, randomInt);
    if (room.squad && body.type !== 'public-lobby'
      && (room.squad.phase !== 'battle' || body.battleNumber !== room.squad.battleNumber)) reject('当前战斗已结束或已经切换。', 409);
    if (['turn-phase', 'turn-take', 'turn-finish'].includes(body.type)) return applyTurn(room, actor, body);
    if (typeof body.type === 'string' && body.type.startsWith('trauma-')) return applyTrauma(room, actor, body, randomInt);
    if (typeof body.type === "string" && body.type.startsWith("board-")) return applyRoomBoard(room, actor, body);
    if (body.type === 'room-projection') {
      if (actor.role !== 'host') reject('战况由房主同步。', 403);
      const projection = roomProjection(body.projection, room.board?.apostle);
      if (!projection) reject('战况与房间骇物不一致。', 409);
      room.projection = projection;
      return;
    }
    if (body.type === 'public-lobby') {
      if (actor.role !== 'host') reject('只有房主可以开放快速参战。', 403);
      room.publicLobby = body.value === true;
      return;
    }
    if (body.type === 'round' || body.type === 'end') {
      if (actor.role !== 'host') reject('只有房主可以执行此操作。', 403);
      if (body.type === 'round') {
        if (body.phase !== undefined && (body.round !== room.round || room.turn?.phase !== 'titans')) {
          reject('轮次已更新，请重试。', 409);
        }
        if (body.phase !== undefined && room.heroes.some((hero, seat) =>
          hero.condition !== 'dead' && !room.turn.finished.includes(seat))) {
          reject('还有泰坦尚未结束回合。', 409);
        }
        room.round++;
        setTurnPhase(room, 'apostle');
      } else if (room.squad) {
        if (body.damage !== undefined && (!Array.isArray(body.damage) || body.damage.length !== room.heroes.length
            || body.damage.some(value => value !== null && (!Number.isInteger(value) || value < 0 || value > 999)))) {
          reject('请为每位英雄填写 0–999 的损伤，或留空。');
        }
        room.squad.recap = battleRecap(room, body.damage, randomInt);
        if (latestBattleRoll(room)) room.squad.lastBattleRoll = latestBattleRoll(room);
        room.squad.phase = 'story';
      }
      else room.closed = true;
      return;
    }
    if (body.type === 'roll-reaction') {
      const roll = room.rolls.find(entry => entry.id === body.roll);
      if (!roll) reject('这次掷骰已不在战斗记录中。', 409);
      const by = actor.role === 'host' ? 'host' : 'seat:' + actor.seat;
      if (roomDice.rollOwner(roll, room.squad?.hostSeat) === by) reject('只能回应队友的掷骰。', 403);
      if (![null, 'up', 'down'].includes(body.value)) reject('掷骰回应无效。');
      countReaction(room, roll, by, body.value);
      roll.reactions ||= {};
      if (body.value === null) {
        delete roll.reactions[by];
        if (roll.reactionPeople) delete roll.reactionPeople[by];
      } else {
        roll.reactions[by] = body.value;
        const seat = actor.role === 'host' ? room.squad?.hostSeat : actor.seat;
        const hero = room.heroes[seat];
        (roll.reactionPeople ||= {})[by] = { name: hero?.name, argonaut: hero?.argonaut,
          player: hero?.player || (actor.role === 'host' ? '房主' : '') };
      }
      return;
    }
    if (body.type === 'priority-target') {
      if (actor.role !== 'host') reject('首要目标由房主确认。', 403);
      if (!Number.isInteger(body.seat) || !room.heroes[body.seat] || room.heroes[body.seat].condition === 'dead') {
        reject('请选择存活的泰坦。');
      }
      room.priorityTarget = { seat: body.seat, locked: body.locked === true };
      return;
    }
    if (body.type === 'pool-clear') {
      for (const key of poolKeys) room.pool[key] = 0;
      return;
    }
    if (body.type === 'argo-use' || body.type === 'argo-undo') {
      const card = room.configuration?.abilities?.find(card => card.id === body.key);
      if (!card) reject('只能使用本场已准备的阿尔戈能力。');
      const states = room.argoAbilities ||= {};
      const current = states[card.id] || { used: 0, lastRound: null };
      const limit = battleConfig.abilityCapacity(card.id);
      const by = actor.role === 'player' ? actor.seat : 'host';
      if (body.type === 'argo-use') {
        if (current.lastRound === room.round) reject('这项能力本轮已经使用过。', 409);
        if (limit !== null && current.used >= limit) reject('这项能力的使用次数已用尽。', 409);
        states[card.id] = { used: current.used + 1, lastRound: room.round, by };
      } else {
        if (current.lastRound !== room.round || current.used < 1) reject('只能撤销本轮的使用。', 409);
        if (actor.role !== 'host' && current.by !== by) reject('只能撤销自己本轮的使用。', 403);
        states[card.id] = { used: current.used - 1, lastRound: null };
      }
      return;
    }
    if (body.type === 'pool') {
      if (!poolKeys.includes(body.key)) reject('未知克拉托斯标记。');
      room.pool[body.key] = counter(room.pool[body.key], body.delta, 99);
      return;
    }
    const seat = body.seat;
    const hero = Number.isInteger(seat) ? room.heroes[seat] : null;
    if (!hero || (actor.role === 'player' && actor.seat !== seat)) reject('只能操作自己的英雄。', 403);
    switch (body.type) {
      case 'stat':
        if (!stats.includes(body.key)) reject('未知英雄数值。');
        if (room.trauma && body.key === 'danger' && body.delta === 1) {
          return applyTrauma(room, actor, { ...body, type: 'trauma-draw', mode: 'gain', amount: 1, deck: 'auto' }, randomInt);
        }
        const target = priorityTarget(room);
        hero.stats[body.key] = counter(hero.stats[body.key], body.delta, 30);
        if (body.key === 'rage' && body.delta > 0 && hero.condition !== 'dead' && !target.locked
            && (target.seat === null || hero.stats.rage > room.heroes[target.seat].stats.rage)) {
          room.priorityTarget = { seat, locked: false };
        } else if (body.key === 'rage') room.priorityTarget = target;
        break;
      case 'titan-marker': {
        if (!Object.hasOwn(titanMarkerNames, body.key)) reject('未知泰坦标记。');
        const current = hero.markers?.[body.key] ?? 0;
        const next = counter(current, body.delta, 99);
        (hero.markers ||= {})[body.key] = next;
        break;
      }
      case 'condition':
        if (!conditions.includes(body.value)) reject('未知英雄状态。');
        hero.condition = body.value;
        if (hero.condition === 'dead') {
          if (room.turn?.seat === seat) room.turn.seat = null;
          if (room.board?.titanMoves) delete room.board.titanMoves[seat];
          if (room.board?.forcedTitanMoves) delete room.board.forcedTitanMoves[seat];
          if (room.board?.lastTitanMove?.seat === seat) delete room.board.lastTitanMove;
        }
        room.priorityTarget = priorityTarget(room);
        break;
      case 'gear': {
        const item = hero.gear.find(entry => entry.id === body.key);
        if (!item) reject('该英雄没有这件装备。');
        counter(item.used, body.delta, item.count);
        const slot = cardState.findGearSlot(item, body.delta === 1 ? 'ready' : 'exhausted');
        if (slot < 0) reject('没有可更改状态的装备。', 409);
        cardState.setGearState(item, slot, body.delta === 1 ? 'exhausted' : 'ready');
        break;
      }
      case 'gear-ready-all':
        for (const item of hero.gear) {
          for (let slot = 0; slot < item.count; slot++) {
            if (cardState.gearState(item, slot) === 'exhausted') cardState.setGearState(item, slot, 'ready');
          }
        }
        break;
      case 'gear-card': {
        const item = hero.gear.find(entry => entry.id === body.key);
        const { slot, value } = body;
        if (!item || !Number.isSafeInteger(slot) || slot < 0 || slot >= item.count || !cardState.states.includes(value)) {
          reject('装备卡操作无效。');
        }
        if (cardState.gearState(item, slot) === 'discarded' && value !== 'discarded') reject('该卡牌已弃除。', 409);
        cardState.setGearState(item, slot, value);
        break;
      }
      case 'mnemos-card': {
        const card = hero.mnemos.find(entry => entry.id === body.key);
        if (!card || !cardState.states.includes(body.value)) reject('旧忆卡操作无效。');
        if (card.state === 'discarded' && body.value !== 'discarded') reject('该卡牌已弃除。', 409);
        card.state = body.value;
        break;
      }
      case 'roll':
        this.roll(room, hero, seat, body, actor);
        break;
      case 'roll-wounds': {
        const roll = room.rolls.find(entry => entry.id === body.roll && entry.seat === seat && entry.mode === 'power');
        if (!roll || !Number.isInteger(body.value) || !Object.hasOwn(roomDice.woundResults, body.value)) reject('击破结果无效。');
        setRollWounds(room, roll, body.value);
        break;
      }
      case 'reroll':
      case 'convert':
        this.changeRoll(room, seat, body);
        break;
      default:
        reject('未知战斗操作。');
    }
  }

  roll(room, hero, seat, body, actor) {
    const { counts, mode, parentRoll, defenseCount = 0 } = body;
    const { limits, modes } = roomDice;
    const modeRule = Object.hasOwn(modes, mode) && modes[mode];
    if (mode !== undefined && !modeRule) reject('投掷用途无效。');
    if (!object(counts) || !Object.keys(counts).every(kind => Object.hasOwn(limits, kind)
        && (!modeRule || modeRule.kinds.includes(kind)))) reject('骰子类型无效。');
    if (!Number.isInteger(defenseCount) || defenseCount < 0 || defenseCount > limits.red
        || (defenseCount && mode !== 'dodge')) reject('防御红骰数量无效。');
    const dice = [];
    for (const [kind, count] of Object.entries(counts)) {
      if (!Number.isInteger(count) || count < 0 || count > limits[kind]) reject('骰子数量无效。');
      for (let i = 0; i < count; i++) {
        const dieKind = kind === 'd10' && i === 0 ? 'crit' : kind;
        const result = this.diceResult(dieKind);
        dice.push({ id: crypto.randomUUID(), kind: dieKind, ...result, original: result.face ?? result.value });
      }
    }
    if (!dice.length) reject('请选择至少一枚骰子。');
    const parent = parentRoll && room.rolls.find(roll => roll.id === parentRoll && roll.seat === seat);
    if (parentRoll && (!parent || !modeRule?.parentMode || parent.mode !== modeRule.parentMode
        || (mode === 'defense' && (!parent.defenseCount || parent.defenseRoll)))) {
      reject('关联投掷已结算或不存在。', 409);
    }
    const roll = { id: body.id, seat, hero: hero.name, round: room.round, mode, dice,
      by: actor.role === 'host' ? 'host' : 'seat:' + seat };
    if (parent) {
      roll.parentRoll = parent.id;
      if (mode === 'defense') parent.defenseRoll = roll.id;
    }
    if (defenseCount) roll.defenseCount = defenseCount;
    if (mode === 'attack' || mode === 'power') claimTurn(room, seat);
    battleStats(room)[seat].rolls++;
    room.lastBattleRollId = roll.id;
    room.rolls.unshift(roll);
    if (room.rolls.length > 30) {
      const keep = new Set(roomDice.latestByHero(room.rolls, room.lastBattleRollId));
      const oldest = room.rolls.findLastIndex(entry => !keep.has(entry));
      room.rolls.splice(oldest, 1);
    }
  }

  diceResult(kind) {
    if (Object.hasOwn(roomDice.faces, kind)) {
      const face = randomInt(6);
      return { face, symbols: roomDice.faces[kind][face] };
    }
    return { value: 1 + randomInt(kind === 'armor' ? 6 : 10) };
  }

  changeRoll(room, seat, body) {
    const roll = room.rolls.find(entry => entry.id && entry.id === body.roll && entry.seat === seat);
    if (!roll) reject('找不到该英雄的这次投掷。', 409);
    if (body.type === 'reroll') {
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > roll.dice.length) reject('请先选齐要重掷的骰子。');
      const dice = [...new Set(body.ids)].map(id => roll.dice.find(die => die.id === id));
      if (!dice.every(roomDice.canReroll)) reject('所选骰子已经重掷、转换或不存在。', 409);
      for (const die of dice) Object.assign(die, this.diceResult(die.kind), { rerolled: true });
      this.promoteRoll(room, roll);
      return;
    }
    const die = roll.dice.find(entry => entry.id === body.die);
    const result = die && roomDice.remainingFace(die);
    if (!result) reject('只能转换威力骰。');
    const conversions = { potential: ['converted', 1], dot: ['dotConverted', 2] };
    if (!Object.hasOwn(conversions, body.symbol)) reject('未知骰面符号。');
    const [field, index] = conversions[body.symbol];
    if (!result[index]) reject('该骰已没有可转换的符号。', 409);
    die[field] = (die[field] || 0) + 1;
    this.promoteRoll(room, roll);
  }

  promoteRoll(room, roll) {
    room.lastBattleRollId = roll.id;
    room.rolls.splice(room.rolls.indexOf(roll), 1);
    room.rolls.unshift(roll);
  }
}


export class BattleDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rooms = env.BATTLE_ROOMS;
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)');
  }

  async fetch(request) {
    if (request.method === 'GET') {
      const entries = this.sql.exec('SELECT data FROM entries ORDER BY updated DESC').toArray();
      const legacy = entries.filter(({ data }) => {
        const entry = JSON.parse(data);
        return entry.open && !entry.squad;
      });
      await Promise.allSettled(legacy.map(async ({ data }) => {
        const { id } = JSON.parse(data);
        const result = await this.rooms.getByName(id).fetch('https://battle-room.internal/retire-legacy', { method: 'POST' });
        if (result.status === 404 || (result.ok && (await result.json()).retired)) {
          this.sql.exec('DELETE FROM entries WHERE id = ? AND data = ?', id, data);
        }
      }));
      return response({ ok: true, rooms: this.sql.exec(
        "SELECT data FROM entries WHERE json_extract(data, '$.open') = 1 AND json_extract(data, '$.squad') = 1 ORDER BY updated DESC LIMIT 100",
      ).toArray().map(row => JSON.parse(row.data)) });
    }
    const entry = await request.json();
    if (!roomIdPattern.test(entry.id || '')) return response({ error: 'Invalid room' }, 400);
    const existing = this.sql.exec('SELECT data FROM entries WHERE id = ?', entry.id).toArray()[0];
    if (existing && (JSON.parse(existing.data).revision ?? -1) > entry.revision) return response({ ok: true });
    this.sql.exec('INSERT OR REPLACE INTO entries VALUES (?, ?, ?)', entry.id, JSON.stringify(entry), Date.now());
    return response({ ok: true });
  }
}
