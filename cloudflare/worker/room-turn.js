import guide from '../../aibp/ai-turn-guide.js';
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

export function finishAiMovement(room) {
  if (!room.turn.aiMovement) return;
  if (room.turn.aiMovement.pending) throw new ApiError(409, '请先处理并确认本次冲撞。');
  delete room.turn.aiMovement;
  if (room.board) delete room.board.apostleMovement;
}

function confirmAiStep(room, actor, action) {
  const { turn } = room;
  if (actor.role !== 'host') throw new ApiError(403, '骇物行动由房主确认。');
  if (turn?.phase !== 'apostle' || !guide.bosses.includes(room.board?.apostle)) {
    throw new ApiError(409, '当前骇物轮次无法使用逐步结算。');
  }
  const step = guide.stepFor(turn.aiGuide);
  const pending = room.projection?.aiPending;
  const { value, target } = action;
  if (value === 'begin' && !step) {
    turn.aiGuide = pending ? 'target' : 'start';
    return;
  }
  if (value === 'start' && step === 'start') {
    turn.aiGuide = pending ? 'target' : 'draw';
    return;
  }
  if (value === 'extra' && step === 'other') {
    delete turn.aiTarget;
    turn.aiGuide = pending ? 'target' : 'draw';
    return;
  }
  if (value === 'hope' && step === 'other' && !pending && room.projection?.hopeEnds) {
    delete turn.aiTarget;
    turn.aiGuide = 'hope-target';
    return;
  }
  if (value === step && ['target', 'hope-target'].includes(step)
      && (target === null || (Number.isInteger(target) && room.heroes[target] && room.heroes[target].condition !== 'dead'))) {
    turn.aiTarget = target;
    turn.aiGuide = step === 'target' ? 'resolve' : 'hope-resolve';
    return;
  }
  if (value === 'resolve' && step === 'resolve' && !pending) {
    finishAiMovement(room);
    turn.aiGuide = 'other';
    delete turn.aiTarget;
    return;
  }
  if (value === 'hope-resolve' && step === 'hope-resolve' && !pending) {
    finishAiMovement(room);
    turn.aiGuide = 'ready';
    delete turn.aiTarget;
    return;
  }
  throw new ApiError(409, '当前步骤、目标或指令技牌面已变化，请核对后继续。');
}

export function applyTurn(room, actor, action) {
  if (actor.role === 'viewer') throw new ApiError(403, '投屏只能查看回合。');
  const { turn, round } = room;
  const { seat, type, value } = action;
  if (action.round !== round || action.phase !== (turn?.phase ?? null)) throw new ApiError(409, '轮次已更新，请重试。');
  if (type === 'ai-guide') return confirmAiStep(room, actor, action);
  if (type === 'turn-phase') {
    if (actor.role !== 'host') throw new ApiError(403, '轮次由房主切换。');
    const step = guide.stepFor(turn?.aiGuide);
    if (step && (room.projection?.aiPending
      || (step !== 'ready' && !(step === 'other' && !room.projection?.hopeEnds)))) {
      throw new ApiError(409, '请先完成骇物轮次的逐步结算。');
    }
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
