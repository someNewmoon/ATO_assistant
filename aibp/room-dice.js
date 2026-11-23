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
  const pipLayouts = [[], [5], [1, 9], [1, 5, 9], [1, 3, 7, 9], [1, 3, 5, 7, 9], [1, 3, 4, 6, 7, 9]];
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

  const woundResults = ['未造成伤口', '单次伤口', '二次伤口', '3 个伤口'];

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

  function criticalLabel(mode, die) {
    if (die.kind !== 'crit' || die.value !== 10) return '';
    return mode === 'attack' ? '关键命中' : mode === 'dodge' ? '关键闪避' : '';
  }

  function faceMarkup(die, dir, artKind = die.kind) {
    const natural = naturalFace(die);
    const index = faceIndex(die);
    if (natural && index >= 0 && Object.hasOwn(faces, die.kind)) {
      return '<span class="room-die-face room-die-cube is-' + die.kind + '" role="img" aria-label="' + faceLabel(natural)
        + '"><span class="room-die-pips" style="background-position:' + index % 3 * 50 + '% ' + (index < 3 ? 50 : 100)
        + '%"></span></span>';
    }
    const number = Number(die.value);
    if (!Number.isInteger(number) || number < 1 || number > 10) return '';
    if (die.kind === 'd10' || die.kind === 'crit') {
      return '<img class="room-die-face" src="' + dir + artKind + '-' + number + '.svg" alt="' + names[die.kind] + ' ' + number + '">';
    }
    if (die.kind !== 'armor' || number > 6) return '';
    const pips = pipLayouts[number].map(position => '<span class="room-pip" style="grid-area:'
      + Math.ceil(position / 3) + '/' + ((position - 1) % 3 + 1) + '"></span>').join('');
    return '<span class="room-die-face room-die-cube is-armor" role="img" aria-label="普通 d6 ' + number
      + '"><span class="room-die-pips">' + pips + '</span></span>';
  }

  function storyFaces(roll) {
    return roll.values.map(value => ({ value, kind: roll.sides === 6 ? 'armor' : 'd10' }));
  }

  function rollOwner(roll, hostSeat) {
    return roll.by || (roll.seat === hostSeat ? 'host' : 'seat:' + roll.seat);
  }

  function latestByHero(rolls, latestId) {
    const latest = rolls.find(roll => roll.id && roll.id === latestId);
    const bySeat = new Map();
    for (const roll of latest ? [latest, ...rolls] : rolls) {
      if (!bySeat.has(roll.seat)) bySeat.set(roll.seat, roll);
    }
    return [...bySeat.values()];
  }

  function reactionGroups(roll, heroes, hostSeat) {
    return [
      { value: 'up', icon: '👍', label: '赞同' },
      { value: 'down', icon: '👎', label: '反对' },
    ].map(group => ({
      ...group,
      people: Object.entries(roll.reactions || {}).filter(([, choice]) => choice === group.value)
        .map(([by]) => {
          const seat = by === 'host' ? hostSeat : Number(by.slice(5));
          const hero = roll.reactionPeople?.[by] || heroes[seat];
          return { hero, name: hero?.player || hero?.name || (by === 'host' ? '房主' : '队友') };
        }),
    }));
  }

  return { faces, names, limits, modes, naturalFace, remainingFace, canReroll, faceIndex, faceLabel, rollSummary, woundResults, criticalLabel, faceMarkup, storyFaces, rollOwner, latestByHero, reactionGroups };
});
