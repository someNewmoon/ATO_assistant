import { ApiError, object } from './campaign.js';
import { roomProjection } from './room-projection.js';

const levels = ['I', 'II', 'III'];
const fail = message => { throw new ApiError(409, message); };
const damageValue = card => card.special === 'DW' || (card.bpLevel || card.level) === 'III' ? 2 : Number(card.damageValue) || 1;
const same = (card, other) => card && other && (card.fileName || other.fileName
  ? card.fileName === other.fileName : card.type === other.type && card.level === other.level && card.index === other.index);

function pileValid(pile) {
  const list = cards => Array.isArray(cards) && cards.length <= 256 && cards.every(object);
  return object(pile) && ['deck', 'discard', 'removed', 'damage', 'damage1', 'damage2'].every(key =>
    (pile[key] === undefined && !['deck', 'discard', 'removed'].includes(key)) || list(pile[key]))
    && object(pile.supply) && Object.values(pile.supply).every(list) && (!pile.pending || object(pile.pending));
}

export function prepareRoomDeck(input, apostle, revision = 1, operation = '') {
  if (input == null) return null;
  if (!apostle || input.apostle !== apostle || !pileValid(input.AI) || (!input.shared && !pileValid(input.BP))
      || !object(input.lastRevealed) || !Array.isArray(input.tokens) || input.tokens.length > 128) fail('请在 AIBP 核对本场骇物牌堆。');
  const { AI, BP, shared, lastRevealed, lastPendingType, tokens, special, flags, chimeraPhase, aiExhaustedBonusIndex } = input;
  return { revision, operation, data: { apostle, AI, ...(shared ? { shared: true } : { BP }),
    lastRevealed, lastPendingType, tokens, special, flags, chimeraPhase, aiExhaustedBonusIndex } };
}

const piles = data => ({ AI: data.AI, BP: data.shared ? data.AI : data.BP });
const pending = (data, type) => !data.shared || data.AI.pendingMode === type ? piles(data)[type].pending : null;

function shuffle(cards, randomInt) {
  for (let index = cards.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
  return cards;
}

function discardIntoDeck(pile, randomInt) {
  pile.deck = shuffle(pile.deck.concat(pile.discard), randomInt);
  pile.discard = [];
}

function promote(pile, level, randomInt) {
  const card = pile.supply[level]?.pop();
  if (!card) return false;
  pile.deck.splice(randomInt(pile.deck.length + 1), 0, card);
  if (pile.deck.length === 1 && pile.discard.length) discardIntoDeck(pile, randomInt);
  return true;
}

function removeLowest(pile, from, levelOf, randomInt, omitSpecial = false, reshuffle = true) {
  for (const level of levels.slice(levels.indexOf(from))) {
    for (const key of ['deck', 'discard']) {
      const index = pile[key].findIndex(card => levelOf(card) === level && !same(card, pile.pending));
      if (index < 0) continue;
      const [card] = pile[key].splice(index, 1);
      if (!omitSpecial || !card.special) pile.removed.push(card);
      if (key === 'discard' || (reshuffle && !pile.deck.length)) discardIntoDeck(pile, randomInt);
      return level;
    }
  }
  return null;
}

function addToken(data, file, amount, flag, position = {}) {
  const perHit = file === 'DA+.png';
  const token = data.tokens.find(entry => flag
    ? entry[flag] === true || (flag === 'criticalMass' && entry.chimeraCriticalMass)
    : entry.file === file && !entry.demidjinnWishArmor
      && (entry.perHit === true || entry.autoLevelBonus === 'danger') === perHit);
  if (token) token.count = Math.min(99, (token.count || 0) + amount);
  else data.tokens.push({ id: crypto.randomUUID(), file, count: amount, x: position.x ?? 8, y: position.y ?? 8,
    ...(flag && { [flag]: true }), ...(perHit && { perHit: true }) });
}

function exhaustedAi(data, amount) {
  const files = ['DA+.png', 'HT+.png', 'ED+.png', 'AT+.png'];
  let index = Number(data.aiExhaustedBonusIndex || 0) % files.length;
  for (let count = 0; count < amount; count++) {
    addToken(data, files[index], 1, null, { x: 8 + (data.tokens.length % 5) * 8, y: 8 + Math.floor(data.tokens.length / 5) * 8 });
    index = (index + 1) % files.length;
  }
  data.aiExhaustedBonusIndex = index;
}

function demidjinnLastWish(data, card, randomInt) {
  const wish = data.special?.demidjinn;
  if (!wish) return false;
  wish.wishForWish = Math.min(99, (wish.wishForWish || 0) + damageValue(card));
  if (card.special || card.level !== 'III' || wish.lastWishAiIvAdded || !data.flags?.lastWish) return false;
  for (const key of ['deck', 'discard']) {
    const index = data.AI[key].findIndex(candidate => candidate.level === 'III' && !candidate.specialAi && !same(candidate, data.AI.pending));
    if (index < 0) continue;
    data.AI.removed.push(data.AI[key].splice(index, 1)[0]);
    break;
  }
  data.AI.deck = shuffle(data.AI.deck.concat(data.flags.lastWish), randomInt);
  wish.lastWishAiIvAdded = true;
  return true;
}

function addDamage(data, pile, card, randomInt) {
  const key = data.apostle === 'CHIMERA_METASTASIOS' ? 'damage1' : 'damage';
  (pile[key] ||= []).push(card);
  const criticalMass = data.flags?.criticalMass;
  if (criticalMass) addToken(data, criticalMass.file, damageValue(card), 'criticalMass', criticalMass);
  if (data.apostle === 'MIDASCORE' && data.special?.midascore) {
    const special = data.special.midascore;
    special.pain = Math.min(99, (special.pain || 0) + damageValue(card));
  }
  return data.apostle === 'DEMIDJINN' && demidjinnLastWish(data, card, randomInt);
}

function escalateAi(data, from, randomInt) {
  const ai = data.AI;
  if (!ai.deck.length) discardIntoDeck(ai, randomInt);
  const found = removeLowest(ai, from === 'III' ? 'I' : from, card => card.level, randomInt, true);
  const next = from === 'III' || found !== 'I' ? 'III' : 'II';
  if (!found || !promote(ai, next, randomInt)) exhaustedAi(data, from === 'III' ? 2 : 1);
}

function updateTitanGroup(bp, group) {
  if (!group) return;
  const wounds = owner => (bp.damage || []).filter(card => card.titanXOwner === owner).reduce((sum, card) => sum + damageValue(card), 0);
  let alive = [1, 2, 3].filter(owner => wounds(owner) < 12);
  if (group.g6 && alive.length === 1 && alive[0] === 3 && wounds(3) >= 10) {
    bp.damage.push({ special: 'DW', titanXOwner: 3, conqueredNail: true });
    alive = [];
  }
  group.won = !alive.length;
  if (!alive.includes(group.target)) group.target = alive[0] || 1;
}

function settleWound(data, bp, card, critical, randomInt, owner) {
  const levelOf = item => item.bpLevel || item.level;
  const level = levelOf(card);
  const wound = level === 'III' && !critical ? { special: 'DW' } : card;
  if (owner) wound.titanXOwner = owner;
  const skipAi = addDamage(data, bp, wound, randomInt);
  if (card._room?.phase) data.chimeraPhase = card._room.phase;
  if (level === 'III') {
    if (bp.supply.III?.length) {
      removeLowest(bp, 'I', levelOf, randomInt, false, !data.shared);
      promote(bp, 'III', randomInt);
      if (critical) promote(bp, 'III', randomInt);
    } else discardIntoDeck(bp, randomInt);
    if (!critical) bp.deck.push(card);
  } else {
    promote(bp, level === 'I' ? 'II' : 'III', randomInt);
  }
  if (!data.shared && !skipAi) escalateAi(data, level, randomInt);
  return damageValue(wound);
}

export function revealRoomAi(deck, randomInt) {
  const data = deck.data;
  const ai = data.AI;
  if (ai.pending) {
    if (data.shared && ai.pendingMode !== 'AI') fail('请先结算当前部位牌。');
    return false;
  }
  if (!ai.deck.length && !ai.discard.length) fail('AI 牌堆已空。');
  if (!ai.deck.length) discardIntoDeck(ai, randomInt);
  const card = data.flags?.aiBottom ? ai.deck.at(-1) : ai.deck[0];
  if (!card._room?.face?.src) fail('这张 AI 缺少可同步的牌面，请检查 AIBP 牌库。');
  ai.pending = card;
  if (data.shared) ai.pendingMode = 'AI';
  if (['THE_NIETZSCJEAN', 'CYCLONUS'].includes(data.apostle)) ai.comboFollowup = false;
  data.lastPendingType = 'AI';
  data.lastRevealed.AI = card;
  return true;
}

export function discardRoomAi(deck, source, randomInt) {
  const data = deck.data;
  const ai = data.AI;
  const card = pending(data, 'AI');
  if (!card || card._room?.face?.src !== source) fail('当前指令技已更新，请重试。');
  const index = ai.deck.findIndex(entry => same(card, entry));
  if (index < 0) fail('找不到当前指令技，请在 AIBP 核对牌堆。');
  ai.discard.push(ai.deck.splice(index, 1)[0]);
  ai.pending = null;
  delete ai.pendingMode;
  delete ai.comboFollowup;
  if (!ai.deck.length) discardIntoDeck(ai, randomInt);
}

export function revealRoomBp(deck, seat, randomInt, allowHandoff = false) {
  const data = deck.data;
  let bp = piles(data).BP;
  if (bp.pending) {
    if (data.shared && bp.pendingMode !== 'BP') fail('请先结算牌面上的 AI。');
    if (!allowHandoff && deck.bpSeat != null && deck.bpSeat !== seat) fail('这张部位牌已由另一位泰坦揭示。');
    if (deck.bpSeat === seat) return false;
    deck.bpSeat = seat;
    return true;
  }
  const titan = data.special?.titanX;
  if (titan?.group?.won || titan?.awakeningWon || bp.deathblowResult?.complete) fail('本场骇物已被击败。');
  if (titan && !titan.group && !titan.awakened && data.flags?.awakening && (bp.damage || []).reduce((sum, card) => sum + damageValue(card), 0) >= 12) {
    titan.beforeAwakeningBp = structuredClone(bp);
    data.BP = bp = { ...bp, deck: [data.flags.awakening], discard: [], supply: { I: [], II: [], III: [] } };
    titan.awakened = true;
    titan.awakeningWon = false;
  }
  if (!bp.deck.length) discardIntoDeck(bp, randomInt);
  if (!bp.deck.length) fail('部位牌堆已空。');
  const card = bp.deck[data.flags?.bpBottom && !titan?.awakened ? bp.deck.length - 1 : 0];
  if (!card._room?.face?.src) fail('这张部位牌缺少可同步的牌面，请检查 AIBP 牌库。');
  bp.pending = card;
  if (data.shared) bp.pendingMode = 'BP';
  data.lastPendingType = 'BP';
  data.lastRevealed.BP = card;
  if (titan?.group) titan.group.pendingBpEnemy = titan.group.target;
  delete bp.combinedAttack;
  deck.bpSeat = seat;
  return true;
}

export function settleRoomBp(deck, { seat, card: path, value, allowHandoff = false }, randomInt) {
  const data = deck.data;
  const bp = piles(data).BP;
  const card = pending(data, 'BP');
  if (!card || card._room?.face?.src !== path || (!allowHandoff && deck.bpSeat != null && deck.bpSeat !== seat)) fail('请先揭示并核对当前部位牌。');
  const index = bp.deck.findIndex(entry => same(entry, card));
  if (index >= 0) bp.deck.splice(index, 1);
  bp.pending = null;
  if (data.shared) bp.pendingMode = '';
  data.lastRevealed.BP = card;
  delete bp.combinedAttack;
  delete deck.bpSeat;

  const titan = data.special?.titanX;
  if (titan?.awakened && !titan.group && card.titanXAwakening) {
    if (!value) bp.deck.unshift(card);
    else { bp.removed.push(card); titan.awakeningWon = true; }
    return 0;
  }
  const group = titan?.group;
  const owner = group?.pendingBpEnemy || group?.target;
  if (group) group.pendingBpEnemy = null;
  if (card.specialBp) { bp.removed.push(card); return 0; }
  if (!value) { bp.discard.push(card); return 0; }

  const amount = damageValue(card);
  if (group) {
    const total = (group.counter || 0) + amount;
    group.counter = total % 3;
    if (total < 3) {
      bp.discard.push(card);
      addDamage(data, bp, { special: amount === 2 ? 'DW' : 'SW', titanXOwner: owner }, randomInt);
      updateTitanGroup(bp, group);
      return amount;
    }
  }
  const damage = settleWound(data, bp, card, value === 2, randomInt, owner);
  if (data.flags?.bpBottom && card.level === 'III') shuffle(bp.deck, randomInt);
  updateTitanGroup(bp, group);
  return damage;
}

export function roomDeckProjection(deck, previous) {
  const data = deck.data;
  const { AI, BP } = piles(data);
  function publicPile(pile, bottom) {
    const cards = pile.deck.filter(card => !same(card, pile.pending));
    if (bottom) cards.reverse();
    const top = cards[0]?._room;
    const counts = new Map();
    for (const card of cards) {
      const tier = card._room?.tier || card.level || '?';
      counts.set(tier, (counts.get(tier) || 0) + 1);
    }
    return { count: cards.length, discard: pile.discard.length, back: top?.back,
      backs: top ? (top.tier || cards[0].level || '?') + '（' + [...counts].map(([tier, count]) => tier + '×' + count).join('，') + '）' : '' };
  }
  const group = data.special?.titanX?.group;
  const total = key => (BP[key] || []).filter(card => !group || card.titanXOwner === group.target)
    .reduce((sum, card) => sum + damageValue(card), 0);
  const split = data.apostle === 'CHIMERA_METASTASIOS';
  const damage1 = split ? total('damage1') : undefined;
  const damage2 = split ? total('damage2') : undefined;
  let tokens = data.tokens;
  // These counters can change in the Worker while the host's AIBP is offline.
  if (data.apostle === 'MIDASCORE' && data.special?.midascore) {
    tokens = tokens.filter(token => !token.midascorePain);
    tokens.push({ file: 'CM.jpg', count: data.special.midascore.pain, midascorePain: true });
  } else if (data.apostle === 'DEMIDJINN' && data.special?.demidjinn) {
    tokens = tokens.filter(token => token.c45PanelCounter !== 'demidjinn');
    tokens.push({ file: 'CM.jpg', count: data.special.demidjinn.wishForWish, c45PanelCounter: 'demidjinn' });
  }
  return roomProjection({ ...previous, apostle: data.apostle, tokens,
    ai: (pending(data, 'AI') || data.lastRevealed.AI)?._room?.face,
    bp: (pending(data, 'BP') || data.lastRevealed.BP)?._room?.face,
    aiPending: Boolean(pending(data, 'AI')), bpPending: Boolean(pending(data, 'BP')), sharedDeck: Boolean(data.shared),
    aiDeck: publicPile(AI, data.flags?.aiBottom), bpDeck: publicPile(BP, data.flags?.bpBottom),
    damage: { wounds: previous?.damage?.wounds, total: split ? damage1 + damage2 : total('damage'), damage1, damage2 },
  }, data.apostle);
}
