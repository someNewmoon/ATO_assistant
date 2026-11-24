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
    ready: ['可以进入泰坦轮次', '确认本轮剩余的结束效果已经处理。'],
  };
  const previousSteps = { move: 'resolve', evade: 'resolve', effects: 'resolve', after: 'resolve', discard: 'resolve', end: 'other' };
  const stepFor = step => previousSteps[step] || step;
  const api = { bosses, steps, stepFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ATO_AI_TURN_GUIDE = api;
})(globalThis);
