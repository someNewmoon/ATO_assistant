(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ATO_ROOM_DICE = api;
})(typeof window === 'object' ? window : this, function () {
  const faces = {
    red: [[1,1,0], [1,0,0], [0,1,0], [2,0,1], [1,1,0], [0,0,1]],
    black: [[2,2,1], [2,1,0], [0,1,1], [1,1,0], [2,0,1], [1,1,0]],
    white: [[1,2,1], [2,1,1], [1,1,1], [1,3,0], [2,3,0], [3,2,1]],
  };
  const names = { d10: '数字骰', crit: '白色关键骰', red: '红威力骰', black: '黑威力骰', white: '白威力骰', armor: '普通 d6' };
  const limits = { d10: 6, armor: 20, red: 6, black: 4, white: 4 };
  const modes = {
    attack: { name: '攻击', kinds: ['d10'] },
    power: { name: '威力', kinds: ['red', 'black', 'white'], parentMode: 'attack' },
    dodge: { name: '闪避', kinds: ['d10'] },
    defense: { name: '防御', kinds: ['red'], parentMode: 'dodge' },
    check: { name: '检定', kinds: ['d10'] },
    armor: { name: '普通 d6', kinds: ['armor'] },
  };

  function naturalFace(die) {
    const options = Object.hasOwn(faces, die.kind) ? faces[die.kind] : null;
    return options?.[die.face] || die.symbols || null;
  }

  function remainingFace(die) {
    const face = naturalFace(die);
    if (!face) return null;
    const potential = die.converted || 0;
    const dots = die.dotConverted || 0;
    return [face[0] + potential + dots, face[1] - potential, face[2] - dots];
  }

  function faceLabel([power, potential, dot]) {
    return power + ' 威力 · ' + potential + ' 潜力 · ' + dot + ' ●';
  }

  function rollSummary(roll) {
    const strengths = roll.dice.map(remainingFace).filter(Boolean);
    if (!strengths.length) return roll.dice.map(die => names[die.kind] + ' ' + die.value).join('、');
    return faceLabel(strengths.reduce((sum, face) => sum.map((value, index) => value + face[index]), [0, 0, 0]));
  }

  function canReroll(die) {
    return Boolean(die?.id && !die.rerolled && !die.converted && !die.dotConverted);
  }

  function faceIndex(die) {
    if (Number.isInteger(die.face)) return die.face;
    return faces[die.kind]?.findIndex(face => face.every((value, index) => value === die.symbols?.[index])) ?? -1;
  }

  return { faces, names, limits, modes, naturalFace, remainingFace, canReroll, faceIndex, faceLabel, rollSummary };
});
