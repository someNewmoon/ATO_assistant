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
  if (room.turn.aiMovement?.pending) throw new ApiError(409, '请先处理并确认本次冲撞。');
  delete room.turn.aiMovement;
  delete room.turn.aiManualMovementEnded;
  if (room.board) delete room.board.apostleMovement;
}

function validAiTarget(room, target) {
  return target === null || (Number.isInteger(target) && room.heroes[target] && room.heroes[target].condition !== 'dead');
}

function confirmInsertedSignature(room, action) {
  const { turn } = room;
  const { value, target, signatureId } = action;
  if (turn?.phase !== 'titans') throw new ApiError(409, '请在泰坦回合结算临时招牌技。');
  if (value === 'signature-begin' && !turn.aiSignatureId) {
    if (!room.board || !room.projection?.signature) throw new ApiError(409, '本场招牌技尚未同步。');
    finishAiMovement(room);
    turn.aiSignatureId = action.id;
    turn.aiGuide = 'signature-target';
    delete turn.aiTarget;
    return;
  }
  if (turn.aiSignatureId && signatureId === turn.aiSignatureId && value === turn.aiGuide) {
    if (value === 'signature-target' && validAiTarget(room, target)) {
      turn.aiTarget = target;
      turn.aiGuide = 'signature-resolve';
      return;
    }
    if (value === 'signature-resolve') {
      finishAiMovement(room);
      delete turn.aiGuide;
      delete turn.aiTarget;
      delete turn.aiSignatureId;
      return;
    }
  }
  throw new ApiError(409, '当前招牌技步骤已变化，请核对后继续。');
}

function confirmAiStep(room, actor, action) {
  const { turn } = room;
  if (actor.role !== 'host') throw new ApiError(403, '骇物行动由房主确认。');
  if (action.value === 'signature-begin' || guide.isInsertedSignature(action.value)) return confirmInsertedSignature(room, action);
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
      && validAiTarget(room, target)) {
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

const undoableTurnActions = new Set([
  'turn-phase', 'turn-take', 'turn-finish', 'ai-guide', 'ai-request', 'ai-guide-discard',
  'board-ai-route', 'board-ai-trample-confirm', 'board-apostle-move', 'board-apostle-end',
]);

export function captureTurnUndo(room, actor, action) {
  if (actor.role !== 'host' || !undoableTurnActions.has(action.type)) return null;
  if (action.type === 'ai-request' && !room.turn?.aiGuide) return null;
  const fields = ['turn', 'board'];
  if (action.type === 'ai-request' || action.type === 'ai-guide-discard') fields.push('battleDeck', 'projection');
  return { revision: room.revision + 1, fields: structuredClone(Object.fromEntries(fields.map(key => [key, room[key]]))) };
}

export function canUndoTurn(room) {
  return Boolean(room.turnUndo && room.turnUndo.revision === room.revision);
}

export function undoTurn(room, actor, action) {
  if (actor.role !== 'host') throw new ApiError(403, '轮次操作由房主撤回。');
  if (!canUndoTurn(room) || action.revision !== room.revision) {
    throw new ApiError(409, '战斗状态已更新，无法安全撤回上一步。');
  }
  const { fields } = room.turnUndo;
  if (fields.battleDeck) {
    fields.battleDeck.revision = room.battleDeck.revision + 1;
    fields.battleDeck.operation = action.id;
  }
  if (fields.board && fields.board.layoutRevision !== room.board?.layoutRevision) {
    fields.board.layoutRevision = (room.board?.layoutRevision ?? -1) + 1;
  }
  Object.assign(room, fields);
}
