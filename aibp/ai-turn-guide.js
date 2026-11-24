(function (root) {
  'use strict';

  const bosses = ['HEKATON', 'LABYRINTHAUROS', 'HERMESIAN_PURSUER', 'ALPHA_TEMENOS'];
  const steps = {
    start: ['开始骇物轮次', '先处理轮次开始效果，再抽取指令技。'],
    draw: ['揭示指令技', '按牌面或特性处理抽牌例外。'],
    target: ['确定目标', '按牌面从上到下核对目标条件，选定一位泰坦后可预览移动路线。'],
    resolve: ['结算指令技', '按牌面移动、攻击并依次处理闪避、攻击后果和攻击后效果。'],
    other: ['轮次结束前', '检查其他行动、额外指令技和轮次结束效果。'],
    'hope-target': ['希望终结 · 确定目标', '现在执行招牌技，按招牌技重新选择目标。'],
    'hope-resolve': ['希望终结 · 结算招牌技', '按招牌技结算移动、攻击、闪避和其他效果。'],
    'signature-target': ['招牌技 · 确定目标', '按牌面选择目标。'],
    'signature-resolve': ['招牌技 · 结算', '按牌面结算移动、闪避、攻击后果和其他效果。'],
    ready: ['可以进入泰坦轮次', '确认本轮剩余的结束效果已经处理。'],
  };
  const previousSteps = { move: 'resolve', evade: 'resolve', effects: 'resolve', after: 'resolve', discard: 'resolve', end: 'other' };
  const stepFor = step => previousSteps[step] || step;
  const isInsertedSignature = step => step === 'signature-target' || step === 'signature-resolve';
  const usesSignature = step => isInsertedSignature(step) || step === 'hope-target' || step === 'hope-resolve';
  const resolvesMovement = step => ['resolve', 'hope-resolve', 'signature-resolve'].includes(stepFor(step));

  function apostleRoutes(room, reach, terrain, los) {
    const { board, heroes, turn, projection } = room;
    if (turn?.aiManualMovementEnded) return [];
    const pieces = board?.map?.pieces;
    const target = pieces?.titans?.[turn?.aiTarget];
    const profile = terrain?.getApostleProfile(board?.apostle, board?.level);
    if (!target || !pieces.apostle || !profile || !los || heroes[turn.aiTarget]?.condition === 'dead') return [];
    const modifier = (projection?.tokens || []).reduce((value, token) =>
      value + (token.file === 'SP+.png' ? token.count : token.file === 'SP-.png' ? -token.count : 0), 0);
    const limit = profile.speed === Infinity ? Infinity : Math.max(0, (Number(profile.speed) || 0) + modifier);
    // Rebuild from the original square so a hand-moved segment cannot restart the zig-zag.
    const active = board.apostleMovement;
    const walked = active?.route || [];
    const used = Math.max(0, walked.length - 1);
    const sameCell = (a, b) => a?.column === b.column && a?.row === b.row;
    if (used && !sameCell(walked.at(-1), pieces.apostle)) return [];
    const speed = Math.min(limit, active?.remaining == null ? Infinity : active.remaining + used);
    const paths = los.computeApostleMovePaths({
      sourceAnchor: walked[0] || pieces.apostle, targetAnchor: target, size: profile.size, speed, reach, facing: pieces.apostle.facing,
    });
    const continuations = (paths?.rules || []).filter(path => walked.every((cell, i) => sameCell(path.centers[i], cell)))
      .map(path => {
        if (!used) return path;
        const centers = path.centers.slice(used);
        const [origin, next] = centers;
        const firstFacing = !next ? null : next.column !== origin.column
          ? (next.column > origin.column ? 90 : 270) : (next.row > origin.row ? 0 : 180);
        return { ...path, label: '接续已走路线', centers, steps: centers.length - 1,
          footprints: path.footprints.slice(used), firstFacing };
      });
    const titans = pieces.titans.flatMap((piece, seat) =>
      piece && heroes[seat]?.condition !== 'dead' ? [{ ...piece, seat }] : []);
    return los.rankApostleRoutes(continuations, titans)
      .map(path => ({ ...path, speed: Number.isFinite(limit) ? limit : null }));
  }

  function routeStamp(room, route) {
    const step = stepFor(room.turn.aiGuide);
    const card = usesSignature(step) ? room.projection?.signature : room.projection?.ai?.src;
    return JSON.stringify([room.board.layoutRevision, room.board.apostleMovement?.id, step, room.turn.aiSignatureId, card,
      room.turn.aiTarget, route.centers, route.facing, route.crossedSeats, route.endSeats, route.stopReason]);
  }

  const api = { bosses, steps, stepFor, isInsertedSignature, usesSignature, resolvesMovement, apostleRoutes, routeStamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ATO_AI_TURN_GUIDE = api;
})(globalThis);
