import '../../aibp/boss-levels-data.js';
import terrain from '../../ss/terrain-data.js';
import los from '../../aibp/battle_los.js';
import { ApiError, object } from './campaign.js';

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
  if (state.active === false) return { active: false, mode: '' };
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
    active: true,
    mode: modes.includes(state.mode) ? state.mode : modes[0],
    selectedTitan, weaponControls, weapon: los.normalizeWeapon({
      ...weaponControls, max: weaponControls.kind === 'reach' ? reach : weaponControls.max,
    }),
    moveSpeed: titanSpeeds[selectedTitan], titanSpeeds, elevated: state.elevated === true,
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

export function applyRoomBoard(room, actor, body) {
  const seats = room.heroes.length;
  const board = room.board;
  if (body.type === 'board-move') {
    const { seat, point, from, speed } = body;
    if (actor.role === 'viewer' || !Number.isInteger(seat) || seat < 0 || seat >= seats
      || (actor.role === 'player' && actor.seat !== seat)) fail('只能移动自己英雄的泰坦。', 403);
    if (!board || !isCell(point) || !isCell(from) || !Number.isInteger(speed) || speed < 0 || speed > 20) fail('泰坦移动数据无效。');
    const current = board.map.pieces.titans[seat];
    if (current.column !== from.column || current.row !== from.row) fail('泰坦位置已更新，请重选目的格。', 409);
    const overlay = los.buildLosOverlay(board.map, {
      active: true, mode: 'titan-move', selectedTitan: seat, moveSpeed: speed,
    }, terrain, board.apostle, { level: board.level });
    if (!overlay.moveCells.some(({ c, r }) => c === point.column && r === point.row)) fail('这一格当前不可达。', 409);
    board.map.pieces.titans[seat] = { column: point.column, row: point.row };
    return;
  }
  if (actor.role !== 'host') fail('版图布局由房主控制。', 403);
  if (body.type === 'board-setup') {
    if (board && board.layoutRevision !== body.layoutRevision) fail('版图布局已更新。', 409);
    room.board = setupRoomBoard(body, seats);
    room.board.layoutRevision = (board?.layoutRevision ?? -1) + 1;
    return;
  }
  if (!board) fail('请先载入房间版图。');
  if (body.type === 'board-apostle-move') {
    const profile = terrain.getApostleProfile(board.apostle, board.level);
    const size = profile?.size || 1;
    const current = board.map.pieces.apostle;
    if (body.from?.column !== current.column || body.from?.row !== current.row) fail('骇物位置已更新，请重选目的格。', 409);
    const point = terrain.boardCell(body.point, size);
    if (!point || point.column !== body.point.column || point.row !== body.point.row) fail('骇物落位无效。');
    const steps = los.apostleDestinationSteps(board.map.pieces, point, size);
    if (steps === null) fail('骇物不能重叠到泰坦所在格。', 409);
    if (steps > (profile?.speed ?? Infinity)) fail('这一位置超出骇物的移动范围。', 409);
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
    if (body.keepTitans) {
      map.pieces.titans = board.map.pieces.titans;
      const old = board.map.pieces.apostle;
      const boss = map.pieces.apostle;
      if (boss.column !== old.column || boss.row !== old.row) {
        const size = terrain.getApostleProfile(board.apostle, board.level)?.size || 1;
        if (los.apostleDestinationSteps(board.map.pieces, boss, size) === null) fail('骇物不能重叠到泰坦所在格。', 409);
      }
    }
    board.map = map;
    board.layoutRevision++;
    return;
  }
  fail('未知版图操作。');
}
