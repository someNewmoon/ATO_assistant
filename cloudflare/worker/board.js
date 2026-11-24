import '../../aibp/boss-levels-data.js';
import terrain from '../../ss/terrain-data.js';
import los from '../../aibp/battle_los.js';
import guide from '../../aibp/ai-turn-guide.js';
import { ApiError, object } from './campaign.js';
import { claimTurn, forcedTitanMove } from './room-turn.js';

const H = 14;
const W = 20;
const modes = ['titan-move', 'titan-attack', 'apostle-sight', 'apostle-move'];

function fail(text, status = 400) {
  throw new ApiError(status, text);
}

function isCell(cell) {
  return object(cell) && Number.isInteger(cell.column) && Number.isInteger(cell.row)
    && cell.column >= 1 && cell.column <= W && cell.row >= 1 && cell.row <= H;
}

function cleanMap(value, apostle, level, seats) {
  if (value != null && (!object(value) || !Array.isArray(value.terrain) || value.terrain.length > 128)) {
    fail('版图地形数据无效。');
  }
  const input = value ? {
    ...value,
    terrain: value.terrain.filter(tile => object(tile) && Object.hasOwn(terrain.catalog, tile.name)
      && Number.isFinite(tile.column) && tile.column >= 1 && tile.column <= W
      && Number.isFinite(tile.row) && tile.row >= 1 && tile.row <= H
      && [0, 90, 180, 270].includes(tile.rotation))
      .map(tile => ({ ...tile, id: typeof tile.id === 'string' ? tile.id.slice(0, 64) : '' })),
  } : terrain.createBattleMap(apostle, level);
  const map = terrain.normalizeBattleMap(input, apostle, level);
  const starts = terrain.getBoardPieces(map, apostle, level);
  return terrain.normalizeBattleMap({
    ...map, pieces: { ...starts, titans: starts.titans.slice(0, seats) },
  }, apostle, level);
}

function cleanOverlay(value, seats) {
  const state = object(value) ? value : {};
  const active = state.active !== false && modes.includes(state.mode);
  const controls = object(state.weaponControls) ? state.weaponControls : {};
  const ranged = los.normalizeWeapon({ ...controls, kind: 'ranged' });
  const reach = los.normalizeWeapon({ kind: 'reach', max: controls.reach }).max;
  const weaponControls = {
    kind: los.normalizeWeapon(controls).kind, min: ranged.min, max: ranged.max, reach,
  };
  const selectedTitan = Number.isInteger(state.selectedTitan) && state.selectedTitan >= 0 && state.selectedTitan < seats
    ? state.selectedTitan : 0;
  const titanSpeeds = Array.from({ length: seats }, (_, index) => {
    const speed = state.titanSpeeds?.[index];
    return Number.isInteger(speed) && speed >= 0 && speed <= 20 ? speed : 5;
  });
  return {
    active, mode: active ? state.mode : '',
    selectedTitan, weaponControls, weapon: los.normalizeWeapon({
      ...weaponControls, max: weaponControls.kind === 'reach' ? reach : weaponControls.max,
    }),
    moveSpeed: titanSpeeds[selectedTitan], titanSpeeds, forced: state.forced === true, elevated: state.elevated === true,
  };
}

export function setupRoomBoard(input, seats) {
  if (!object(input) || typeof input.apostle !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(input.apostle)
    || !Number.isInteger(input.level) || input.level < 0 || input.level > 10) fail('可以从 AIBP 选择有效的骇物与等级。');
  return {
    apostle: input.apostle, level: input.level, layoutRevision: 0,
    map: cleanMap(input.map, input.apostle, input.level, seats), los: cleanOverlay(null, seats),
  };
}

export function priorityTarget(room) {
  const current = room.priorityTarget;
  const holder = Number.isInteger(current?.seat) && room.heroes[current.seat];
  if (holder && holder.condition !== 'dead') return current;
  let seat = null;
  room.heroes.forEach((hero, index) => {
    if (hero.condition === 'dead') return;
    if (seat === null || hero.stats.rage > room.heroes[seat].stats.rage) seat = index;
  });
  return { seat, locked: false };
}

function applyAiMovement(room, body) {
  const { turn, board } = room;
  const guidedAi = turn?.phase === 'apostle' && guide.bosses.includes(board.apostle);
  const signature = turn?.phase === 'titans' && turn.aiGuide === 'signature-resolve';
  if ((!guidedAi && !signature) || !guide.resolvesMovement(turn.aiGuide)) {
    fail('当前步骤无法执行推荐移动。', 409);
  }
  if (body.type === 'board-ai-trample-confirm') {
    if (!turn.aiMovement?.pending || turn.aiMovement.id !== body.move) fail('冲撞记录已更新。', 409);
    turn.aiMovement.pending = false;
    return;
  }
  if (turn.aiMovement) fail('当前指令已经执行过推荐移动。', 409);
  if (!Number.isInteger(body.reach) || body.reach < 1 || body.reach > 20) fail('攻击范围无效。');
  const route = guide.apostleRoutes(room, body.reach, terrain, los).find(path => path.id === body.route);
  if (!route || guide.routeStamp(room, route) !== body.stamp) fail('路线已更新，请重新核对。', 409);
  const current = board.map.pieces.apostle;
  const active = board.apostleMovement;
  const originalFacing = current.facing;
  if (route.steps) {
    const move = los.appendTitanMove(active, { id: body.id, speed: active ? active.speed : route.speed, route: route.centers });
    board.apostleMovement = board.lastApostleMove = move;
  }
  Object.assign(current, route.finalCenter, { facing: route.facing });
  board.layoutRevision++;
  turn.aiMovement = { id: body.id, steps: route.steps, facing: route.facing, originalFacing,
    crossedSeats: route.crossedSeats, endSeats: route.endSeats, pending: route.collisions > 0, stopReason: route.stopReason };
}

export function applyRoomBoard(room, actor, body) {
  const seats = room.heroes.length;
  const board = room.board;
  if (body.type === 'board-ping') {
    if (!['host', 'player'].includes(actor.role)) fail('投屏只能查看点位。', 403);
    if (!board || !isCell(body.point)) fail('请选择有效的版图点位。');
    const hero = room.heroes[actor.seat];
    room.boardPing = { id: body.id, column: body.point.column, row: body.point.row,
      by: actor.role === 'host' ? '房主' : hero?.player || hero?.name || '队员', expiresAt: Date.now() + 12000 };
    return;
  }
  if (['board-move', 'board-undo-move', 'board-end-move'].includes(body.type)) {
    const { seat, point, from, speed } = body;
    if (actor.role === 'viewer' || !Number.isInteger(seat) || seat < 0 || seat >= seats
      || (actor.role === 'player' && actor.seat !== seat)) fail('只能移动自己英雄的泰坦。', 403);
    if (room.heroes[seat].condition === 'dead') fail('死亡的泰坦无法移动。', 409);
    const deadSeats = room.heroes.flatMap((hero, index) => hero.condition === 'dead' ? [index] : []);
    const forced = forcedTitanMove(room, body);
    const movesKey = forced ? 'forcedTitanMoves' : 'titanMoves';
    const move = board?.[movesKey]?.[seat];
    if (body.type === 'board-end-move') {
      if (!move || move.id !== body.move) fail('本次移动已更新，请重试。', 409);
      delete board[movesKey][seat];
      return;
    }
    if (body.type === 'board-undo-move') {
      const pieces = board?.map.pieces;
      if (!move || move.id !== body.move || !pieces) fail('没有可撤回的移动。', 409);
      const { origin, previous } = los.rewindTitanMove(move);
      const destination = move.route.at(-1);
      const current = pieces.titans[seat];
      if (current.column !== destination.column || current.row !== destination.row) fail('泰坦位置已变更。', 409);
      const size = terrain.getApostleProfile(board.apostle, board.level)?.size || 1;
      const hasBoss = Math.abs(pieces.apostle.column - origin.column) <= (size - 1) / 2
        && Math.abs(pieces.apostle.row - origin.row) <= (size - 1) / 2;
      if (!forced && (hasBoss || pieces.titans.some((titan, index) => index !== seat && !deadSeats.includes(index) && titan.column === origin.column && titan.row === origin.row))) {
        fail('原位置已有棋子，无法撤回。', 409);
      }
      pieces.titans[seat] = { ...origin };
      if (previous) board[movesKey][seat] = previous;
      else delete board[movesKey][seat];
      if (board.lastTitanMove?.id === move.id) {
        if (previous) board.lastTitanMove = previous;
        else delete board.lastTitanMove;
      }
      return;
    }
    if (!board || !isCell(point) || !isCell(from) || !Number.isInteger(speed) || speed < 0 || speed > 20) fail('泰坦移动数据无效。');
    const current = board.map.pieces.titans[seat];
    if (current.column !== from.column || current.row !== from.row) fail('泰坦位置已更新，请重选目的格。', 409);
    if (body.move !== undefined && body.move !== (move?.id ?? null)) fail('本次移动已更新，请重选目的格。', 409);
    const active = move?.clicks ? move : null;
    if (active && (active.route.at(-1).column !== current.column || active.route.at(-1).row !== current.row)) {
      fail('位置在这次移动之外已改变，请先结束这次移动。', 409);
    }
    const remaining = active?.remaining ?? speed;
    if (!remaining) fail('本次移动没有剩余步数。', 409);
    const overlay = los.buildLosOverlay(board.map, {
      active: true, mode: 'titan-move', selectedTitan: seat, moveSpeed: remaining, visited: active?.route, forced,
    }, terrain, board.apostle, { level: board.level, deadSeats });
    const route = los.titanMoveRoute(overlay, point);
    if (!route) fail('这一格当前不可达。', 409);
    const next = los.appendTitanMove(active, { id: body.id, seat, speed: active?.speed ?? speed, route });
    (board[movesKey] ||= {})[seat] = next;
    if (!forced) claimTurn(room, seat);
    board.lastTitanMove = next;
    board.map.pieces.titans[seat] = { column: point.column, row: point.row };
    return;
  }
  if (actor.role !== 'host') fail('版图布局由房主控制。', 403);
  if (body.type === 'board-setup') {
    if (board && board.layoutRevision !== body.layoutRevision) fail('版图布局已更新。', 409);
    room.board = setupRoomBoard(body, seats);
    delete room.boardPing;
    if (room.projection?.apostle !== room.board.apostle) room.projection = null;
    room.board.layoutRevision = (board?.layoutRevision ?? -1) + 1;
    return;
  }
  if (!board) fail('请先载入房间版图。');
  if (['board-ai-route', 'board-ai-trample-confirm'].includes(body.type)) return applyAiMovement(room, body);
  if (['board-apostle-move', 'board-apostle-undo', 'board-apostle-end'].includes(body.type)) {
    const active = board.apostleMovement;
    const current = board.map.pieces.apostle;
    if (body.type !== 'board-apostle-move') {
      if (!active || active.id !== body.move) fail('骇物移动已更新。', 409);
      if (body.type === 'board-apostle-end') {
        delete board.apostleMovement;
        const turn = room.turn;
        if (guide.resolvesMovement(turn?.aiGuide) && !turn.aiMovement) {
          turn.aiManualMovementEnded = true;
        }
        return;
      }
      const guided = room.turn?.aiMovement?.id === active.id && room.turn.aiMovement;
      if (guided && guided.crossedSeats.length && !guided.pending) fail('冲撞已经确认，请按牌面手动校正版图。', 409);
      delete board.apostleMovement;
      const { origin, previous } = los.rewindTitanMove(active);
      Object.assign(current, origin);
      if (guided) {
        current.facing = guided.originalFacing;
        delete room.turn.aiMovement;
      }
      if (previous) board.apostleMovement = previous;
      if (previous) board.lastApostleMove = previous;
      else delete board.lastApostleMove;
      board.layoutRevision++;
      return;
    }
    if (body.move !== undefined && body.move !== (active?.id ?? null)) fail('骇物移动已更新，请重选目的格。', 409);
    const profile = terrain.getApostleProfile(board.apostle, board.level);
    if (body.from?.column !== current.column || body.from?.row !== current.row) fail('骇物位置已更新，请重选目的格。', 409);
    const point = terrain.boardCell(body.point, profile?.size || 1);
    if (!point || point.column !== body.point.column || point.row !== body.point.row) fail('骇物落位无效。');
    const route = los.apostleMoveRoute(current, point);
    if (route.length < 2) return;
    if (body.speed !== undefined && (!Number.isInteger(body.speed) || body.speed < 0 || body.speed > 32)) fail('骇物移动上限无效。');
    const speed = active ? active.speed : (body.speed ?? (Number.isFinite(profile?.speed) ? profile.speed : null));
    const remaining = active ? active.remaining : speed;
    if (remaining !== null && route.length - 1 > remaining) fail('目的格超出骇物剩余步数。', 409);
    const next = los.appendTitanMove(active, { id: body.id, speed, route });
    board.apostleMovement = board.lastApostleMove = next;
    Object.assign(current, point);
    board.layoutRevision++;
    return;
  }
  if (body.type === 'board-face') {
    if (![0, 90, 180, 270].includes(body.facing)) fail('骇物朝向无效。');
    board.map.pieces.apostle.facing = body.facing;
    board.layoutRevision++;
    return;
  }
  if (body.type === 'board-overlay') {
    board.los = cleanOverlay(body.overlay, seats);
    return;
  }
  if (body.type === 'board-layout') {
    if (board.layoutRevision !== body.layoutRevision) fail('版图布局已更新。', 409);
    const map = cleanMap(body.map, board.apostle, board.level, seats);
    if (body.keepTitans) map.pieces.titans = board.map.pieces.titans;
    board.map = map;
    delete room.boardPing;
    delete board.lastApostleMove;
    delete board.apostleMovement;
    delete board.titanMoves;
    delete board.forcedTitanMoves;
    if (!body.keepTitans) delete board.lastTitanMove;
    board.layoutRevision++;
    return;
  }
  fail('未知版图操作。');
}
