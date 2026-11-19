import { ApiError } from './campaign.js';

export function setTurnPhase(room, phase) {
  room.turn = { phase, seat: null, finished: [] };
  if (room.board) {
    delete room.board.titanMoves;
    delete room.board.forcedTitanMoves;
    delete room.board.apostleMovement;
  }
}

export function forcedTitanMove(room, body) {
  return room.turn?.phase === 'apostle' || body.forced === true;
}

export function canClaimTurn(room, seat) {
  const turn = room.turn;
  return turn?.phase === 'titans' && turn.seat === null && room.heroes[seat]
    && room.heroes[seat].condition !== 'dead' && !turn.finished.includes(seat);
}

export function claimTurn(room, seat) {
  if (canClaimTurn(room, seat)) room.turn.seat = seat;
}

export function applyTurn(room, actor, action) {
  if (actor.role === 'viewer') throw new ApiError(403, '投屏只能查看回合。');
  const { turn, round } = room;
  const { seat, type, value } = action;
  if (action.round !== round || action.phase !== (turn?.phase ?? null)) throw new ApiError(409, '轮次已更新，请重试。');
  if (type === 'turn-phase') {
    if (actor.role !== 'host') throw new ApiError(403, '轮次由房主切换。');
    if ((!turn && ['apostle', 'titans'].includes(value)) || (turn?.phase === 'apostle' && value === 'titans')) {
      setTurnPhase(room, value);
      return;
    }
    throw new ApiError(409, '当前无法切换轮次。');
  }
  if (!Number.isInteger(seat) || (actor.role === 'player' && actor.seat !== seat)) {
    throw new ApiError(403, '只能操作自己的英雄回合。');
  }
  if (type === 'turn-take' && canClaimTurn(room, seat)) {
    claimTurn(room, seat);
    return;
  }
  if (type === 'turn-finish' && turn?.phase === 'titans' && turn.seat === seat) {
    turn.finished.push(seat);
    turn.seat = null;
    if (room.board?.titanMoves) delete room.board.titanMoves[seat];
    return;
  }
  throw new ApiError(409, '该回合已被认领、已经结束，或当前是骇物轮次。');
}
