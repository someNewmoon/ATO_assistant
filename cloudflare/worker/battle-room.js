import { DurableObject } from 'cloudflare:workers';
import heroCatalog from '../../hero/hero-catalog.js';
import inventory from '../../technology/gear-inventory.js';
import cardState from '../../aibp/room-card-state.js';
import roomDice from '../../aibp/room-dice.js';
import { roomProjection } from './room-projection.js';
import battleConfig from '../../technology/battle-config.js';
import techDictionary from '../../technology/tech_card_dictionary.min.json';
import gearProduction from '../../technology/ato_gear_production.json';
import { ApiError, errorResponse, object, response } from './campaign.js';
import { applyRoomBoard, setupRoomBoard } from './board.js';

export const roomIdPattern = /^[a-f0-9]{32}$/;
const secretPattern = /^[a-f0-9]{64}$/;
const protocol = 'ato-battle-v1';
const poolKeys = ['opening', 'break', 'diversion', 'rouse', 'black', 'fire', 'hope'];
const stats = ['danger', 'rage', 'fate'];
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
  const name = gearProduction.gearCards[id]?.trim();
  return name?.match(/[\u3400-\u9fff].*/u)?.[0] || name || id;
}

export async function createBattleRoom(env, campaign, payload) {
  const available = heroCatalog.activeHeroes(campaign);
  const selected = payload?.heroIds;
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 4
      || new Set(selected).size !== selected.length || !selected.every(id => available.some(hero => hero.id === id))) {
    reject('请从当前战役选择 1 至 4 位不同的英雄。');
  }
  const title = clean(payload.title, 80) || '决战';
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
      argonaut: heroCatalog.ARGONAUTS.find(argonaut => argonaut.id === hero.argonaut)?.id,
      titan: titan ? {
        name: clean(titan.name), ...inventory.titanTypeFields(titan),
        panelId: titan.panelId, crippled: Boolean(titan.crippled),
      } : null,
      gear: Object.entries(kit.gear).map(([id, count]) => ({ id, name: equipmentName(id), count, used: 0 })),
      mnemos, stats: { danger: 0, rage: 0, fate: 0 }, condition: 'standing', player: '',
    };
  });
  const board = payload.board ? setupRoomBoard(payload.board, heroes.length) : null;
  const availableAbilities = battleConfig.availability(campaign, techDictionary);
  const selectedConfig = payload.battleConfig || availableAbilities.record.battleConfigurations
    ?.find(config => config.id === availableAbilities.record.activeBattleConfiguration);
  let configuration;
  try { configuration = battleConfig.prepare(selectedConfig, availableAbilities); }
  catch (error) { reject(error.message); }
  const id = crypto.randomUUID().replaceAll('-', '');
  return env.BATTLE_ROOMS.getByName(id).fetch('https://battle-room.internal/create', {
    method: 'POST', body: JSON.stringify({ id, title, heroes, board, configuration, projection: roomProjection(payload.projection, board?.apostle) }),
  });
}

export async function battleRequest(env, request, url) {
  const parts = url.pathname.split('/');
  if (parts.length !== 5 || !roomIdPattern.test(parts[3])) reject('战斗室不存在。', 404);
  if (!['state', 'lobby', 'join', 'action', 'socket'].includes(parts[4])) reject('战斗室接口不存在。', 404);
  const origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    reject('请从本站加入战斗室。', 403);
  }
  return env.BATTLE_ROOMS.getByName(parts[3]).fetch(request);
}

export class BattleRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS room (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), data TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)');
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
    const { secrets, ...state } = room;
    return { ok: true, room: state, actor };
  }

  actor(room, secretHash) {
    if (secretHash && room.secrets.host === secretHash) return { role: 'host' };
    if (secretHash && room.secrets.viewer === secretHash) return { role: 'viewer' };
    const seat = secretHash ? room.secrets.players.findIndex(value => value === secretHash) : -1;
    if (seat >= 0) return { role: 'player', seat };
    reject('请重新加入战斗室。', 401);
  }

  publish(room) {
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(JSON.stringify(this.view(room, socket.deserializeAttachment()))); }
      catch { socket.close(1011, 'Reconnect'); }
    }
  }

  async create(request) {
    const { id, title, heroes, board, projection, configuration } = await request.json();
    const keys = { host: newSecret(), viewer: newSecret(), invite: newSecret() };
    const [host, viewer, invite] = await Promise.all(Object.values(keys).map(hash));
    const room = {
      id, title, heroes, board, projection, configuration, round: 1, revision: 0, closed: false,
      pool: Object.fromEntries(poolKeys.map(key => [key, 0])), rolls: [],
      secrets: { host, viewer, invite, players: heroes.map(() => null) },
    };
    this.save(room);
    return response({ ...this.view(room, { role: 'host' }), keys }, 201);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const route = url.pathname.split('/').at(-1);
    try {
      if (url.hostname === 'battle-room.internal' && url.pathname === '/create') return await this.create(request);
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
      const expectedMethod = route === 'state' ? 'GET' : 'POST';
      if (request.method !== expectedMethod) reject('请求方法不支持。', 405);
      const secretHash = await hash(request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]);
      const body = expectedMethod === 'POST' ? await this.payload(request, route === 'action' ? 32768 : 4096) : null;
      const newPlayer = route === 'join' ? await hash(body.playerKey) : '';
      const room = this.load();
      if (route === 'join' || route === 'lobby') {
        if (!secretHash || secretHash !== room.secrets.invite) reject('邀请链接无效。', 403);
        if (room.closed) reject('本场战斗已结束。', 409);
        if (route === 'lobby') return response({ ok: true, title: room.title, heroes: room.heroes.map(hero => ({
          name: hero.name, taken: Boolean(hero.player),
        })) });
        return this.join(room, body, newPlayer);
      }
      const actor = this.actor(room, secretHash);
      if (route === 'state') return response(this.view(room, actor));
      return this.action(room, actor, body);
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

  join(room, body, playerHash) {
    const { seat } = body;
    const player = clean(body.player, 32);
    if (!playerHash || !Number.isInteger(seat) || !room.heroes[seat] || !player) reject('请选择英雄并填写玩家名。');
    const existing = room.secrets.players.indexOf(playerHash);
    if (existing === seat) return response(this.view(room, { role: 'player', seat }));
    if (existing >= 0 || room.secrets.players[seat]) reject('这位英雄已被认领，请选另一位。', 409);
    room.secrets.players[seat] = playerHash;
    room.heroes[seat].player = player;
    room.revision++;
    this.save(room);
    this.publish(room);
    return response(this.view(room, { role: 'player', seat }));
  }

  action(room, actor, body) {
    if (actor.role === 'viewer') reject('投屏页面只能查看。', 403);
    if (typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id)) reject('操作编号无效。');
    if (this.sql.exec('SELECT 1 FROM actions WHERE id = ?', body.id).toArray().length) {
      return response(this.view(room, actor));
    }
    if (room.closed) reject('本场战斗已结束。', 409);
    this.apply(room, actor, body);
    room.revision++;
    this.ctx.storage.transactionSync(() => {
      this.save(room);
      this.sql.exec('INSERT INTO actions VALUES (?, ?)', body.id, room.revision);
      this.sql.exec('DELETE FROM actions WHERE revision <= ?', room.revision - 512);
    });
    this.publish(room);
    return response(this.view(room, actor));
  }

  apply(room, actor, body) {
    if (typeof body.type === "string" && body.type.startsWith("board-")) return applyRoomBoard(room, actor, body);
    if (body.type === 'room-projection') {
      if (actor.role !== 'host') reject('战况由房主同步。', 403);
      const projection = roomProjection(body.projection, room.board?.apostle);
      if (!projection) reject('战况与房间骇物不一致。', 409);
      room.projection = projection;
      return;
    }
    if (body.type === 'round' || body.type === 'end') {
      if (actor.role !== 'host') reject('只有房主可以执行此操作。', 403);
      if (body.type === 'round') room.round++;
      else room.closed = true;
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
        hero.stats[body.key] = counter(hero.stats[body.key], body.delta, 30);
        break;
      case 'condition':
        if (!conditions.includes(body.value)) reject('未知英雄状态。');
        hero.condition = body.value;
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
        this.roll(room, hero, seat, body);
        break;
      case 'reroll':
      case 'convert':
        this.changeRoll(room, seat, body);
        break;
      default:
        reject('未知战斗操作。');
    }
  }

  roll(room, hero, seat, body) {
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
    const roll = { id: body.id, seat, hero: hero.name, round: room.round, mode, dice };
    if (parent) {
      roll.parentRoll = parent.id;
      if (mode === 'defense') parent.defenseRoll = roll.id;
    }
    if (defenseCount) roll.defenseCount = defenseCount;
    room.rolls.unshift(roll);
    room.rolls = room.rolls.slice(0, 30);
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
  }
}
