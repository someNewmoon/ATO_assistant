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

function confirmAiStep(room, actor, action) {
  const { turn } = room;
  if (actor.role !== 'host') throw new ApiError(403, '骇物行动由房主确认。');
  if (turn?.phase !== 'apostle' || !guide.bosses.includes(room.board?.apostle)) {
    throw new ApiError(409, '当前骇物轮次无法使用逐步结算。');
  }
  const step = turn.aiGuide;
  const pending = room.projection?.aiPending;
  if (action.value === 'begin' && !step) {
    turn.aiGuide = pending ? 'target' : 'start';
    return;
  }
  if (action.value === 'extra' && step === 'other') {
    turn.aiGuide = pending ? 'target' : 'draw';
    return;
  }
  if (action.value !== step || !step || step === 'ready'
      || (step === 'draw' && !pending) || (['discard', 'other', 'end'].includes(step) && pending)) {
    throw new ApiError(409, '当前步骤或指令技牌面已变化，请核对后继续。');
  }
  const steps = Object.keys(guide.steps);
  turn.aiGuide = steps[steps.indexOf(step) + 1];
}

export function applyTurn(room, actor, action) {
  if (actor.role === 'viewer') throw new ApiError(403, '投屏只能查看回合。');
  const { turn, round } = room;
  const { seat, type, value } = action;
  if (action.round !== round || action.phase !== (turn?.phase ?? null)) throw new ApiError(409, '轮次已更新，请重试。');
  if (type === 'ai-guide') return confirmAiStep(room, actor, action);
  if (type === 'turn-phase') {
    if (actor.role !== 'host') throw new ApiError(403, '轮次由房主切换。');
    if (turn?.aiGuide && (turn.aiGuide !== 'ready' || room.projection?.aiPending)) {
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
