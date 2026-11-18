import cardList from './trauma-cards.json';
import inventory from '../../technology/gear-inventory.js';
import { ApiError } from './campaign.js';

const decks = Object.keys(inventory.TRAUMA_DECKS);
const cards = new Map(cardList.map(card => [card.id, card]));
const cycles = ['c1', 'c2', 'c3', 'c4', 'c5'];
const fail = (message, status = 400) => { throw new ApiError(status, message); };

function shuffle(pile, randomInt) {
  for (let index = pile.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [pile[index], pile[other]] = [pile[other], pile[index]];
  }
}

export function createTrauma(cycle, tutorial, randomInt) {
  if (!cycles.includes(cycle) || (tutorial && cycle !== 'c1')) fail('请选择有效的故事集和教程设置。');
  const piles = Object.fromEntries(decks.map(deck => [deck, []]));
  for (const card of cardList) {
    if (card.base && allowed(card, cycle) && !(tutorial && card.tutorialExcluded)) piles[card.deck].push(card.id);
  }
  Object.values(piles).forEach(pile => shuffle(pile, randomInt));
  return { cycle, tutorial, piles, drawn: [], tracks: {}, excluded: [], highestDanger: 0 };
}

function allowed(card, cycle) {
  return !card.cycles || card.cycles.includes(cycle);
}

function trackFor(room, seat) {
  const titan = room.heroes[seat].titan;
  return inventory.traumaTrack(titan?.traumaTrack) || room.trauma.tracks[seat] || inventory.defaultTraumaTrack(titan);
}

function inPlay(state, id) {
  const card = cards.get(id);
  return state.piles[card.deck].includes(id) || state.drawn.some(draw => draw.card === id);
}

export function traumaView(room, actor) {
  const state = room.trauma;
  if (!state) return null;
  const view = {
    cycle: state.cycle, tutorial: state.tutorial,
    counts: Object.fromEntries(decks.map(deck => [deck, state.piles[deck].length])),
    tracks: room.heroes.map((_, seat) => trackFor(room, seat)),
    drawn: state.drawn.map(({ card, ...draw }) => ({ ...draw, card: cards.get(card) })),
    latest: state.latest ? { ...state.latest, card: cards.get(state.latest.card) } : null,
  };
  if (actor.role === 'host') view.catalog = cardList.filter(card => allowed(card, state.cycle)).map(card => ({
    ...card, inPlay: inPlay(state, card.id) || (card.id === 'AM0360' && state.hades && !state.excluded.includes(card.id)), held: state.drawn.some(draw => draw.card === card.id),
  }));
  return view;
}

function addCard(state, card, randomInt) {
  if (card.replaces && inPlay(state, card.replaces)) {
    if (state.drawn.some(draw => draw.card === card.replaces)) fail('请先归还要被替换的牌。', 409);
    const pile = state.piles[card.deck];
    pile.splice(pile.indexOf(card.replaces), 1);
    if (!state.excluded.includes(card.replaces)) state.excluded.push(card.replaces);
  }
  state.excluded = state.excluded.filter(id => id !== card.id);
  state.piles[card.deck].push(card.id);
  shuffle(state.piles[card.deck], randomInt);
}

function addOverflowCards(state) {
  for (const card of cardList) {
    if (card.threshold > 0 && state.highestDanger >= card.threshold
        && !state.excluded.includes(card.id) && !inPlay(state, card.id)) {
      state.piles.obol.push(card.id);
    }
  }
  if (state.hades && state.highestDanger >= 21 && !inPlay(state, 'AM0360')
      && !state.excluded.includes('AM0360')) state.piles.obol.push('AM0360');
}

export function applyTrauma(room, actor, body, randomInt) {
  const host = actor.role === 'host';
  if (body.type === 'trauma-setup') {
    if (!host) fail('创伤牌库由房主准备。', 403);
    if (room.trauma) fail('创伤牌库已经准备。', 409);
    room.trauma = createTrauma(body.cycle, body.tutorial === true, randomInt);
    return;
  }
  const state = room.trauma;
  if (!state) fail('请先由房主准备创伤牌库。', 409);
  if (body.type === 'trauma-awakening') {
    if (!host) fail('创伤牌库由房主调整。', 403);
    if (state.drawn.some(draw => draw.card === 'AM0354')) fail('请先归还要被替换的牌。', 409);
    for (const id of ['lethal_awakening', 'AM0355']) {
      if (!inPlay(state, id)) addCard(state, cards.get(id), randomInt);
    }
    return;
  }
  if (body.type === 'trauma-deck') {
    if (!host) fail('创伤牌库由房主调整。', 403);
    const card = cards.get(body.card);
    if (!card || !allowed(card, state.cycle) || (card.id === 'AM0359' && state.hades)) fail('这张牌不适用于当前故事集。');
    if (body.operation === 'add' && !inPlay(state, card.id)) {
      if (card.id === 'AM0360') {
        state.hades = true;
        if (state.highestDanger < 21 && !inPlay(state, 'AM0359')) {
          if (!state.excluded.includes('AM0359')) state.excluded.push('AM0359');
          state.excluded = state.excluded.filter(id => id !== card.id);
          return;
        }
      }
      addCard(state, card, randomInt);
    } else if (body.operation === 'remove' && (state.piles[card.deck].includes(card.id) || (card.id === 'AM0360' && state.hades && !inPlay(state, card.id)))) {
      const pile = state.piles[card.deck];
      const index = pile.indexOf(card.id);
      if (index >= 0) pile.splice(index, 1);
      if (card.id === 'AM0360') {
        state.hades = false;
        state.excluded = state.excluded.filter(id => id !== 'AM0359');
      }
      if (!state.excluded.includes(card.id)) state.excluded.push(card.id);
    } else fail('该牌目前无法加入或移除。', 409);
    return;
  }
  const seat = body.seat;
  const hero = Number.isInteger(seat) ? room.heroes[seat] : null;
  if (!hero || (!host && actor.seat !== seat)) fail('只能操作自己的英雄。', 403);
  if (body.type === 'trauma-track') {
    if (!host) fail('创伤表由房主设置。', 403);
    if (!Array.isArray(body.track) || body.track.length !== 9 || !body.track.every(deck => decks.includes(deck))) {
      fail('请按面板选择凶险 1 至 9 的险情等级。');
    }
    state.tracks[seat] = body.track;
    return;
  }
  if (body.type === 'trauma-resolve') {
    const index = state.drawn.findIndex(draw => draw.id === body.draw && draw.seat === seat);
    if (index === -1) fail('这张创伤已归还。', 409);
    if (body.operation === 'keep') {
      state.drawn[index].kept = true;
      return;
    }
    if (!['bottom', 'shuffle'].includes(body.operation)) fail('请选择创伤归还方式。');
    const [draw] = state.drawn.splice(index, 1);
    const card = cards.get(draw.card);
    if (card.return !== 'temporary') {
      const pile = state.piles[card.deck];
      pile.push(card.id);
      if (card.deck === 'obol' || card.return?.startsWith('shuffle') || body.operation === 'shuffle') shuffle(pile, randomInt);
    }
    return;
  }
  if (body.type !== 'trauma-draw') fail('未知的创伤操作。');
  if (hero.condition === 'dead') fail('请先确认泰坦状态。', 409);
  let danger = hero.stats.danger;
  if (body.mode === 'hit' || body.mode === 'gain') {
    if (!Number.isInteger(body.amount) || body.amount < 0 || body.amount > 99) fail('请输入 0 至 99 的凶险。');
    if (body.amount === 0) return;
    danger += body.amount;
    if (body.mode === 'gain' && danger <= 9) {
      hero.stats.danger = danger;
      return;
    }
  } else if (body.mode !== 'draw') fail('请选择抽取方式。');
  const track = trackFor(room, seat);
  const selected = body.deck;
  if (selected !== 'auto' && !decks.includes(selected)) fail('请选择有效的创伤牌库。');
  if (body.mode === 'gain' && selected !== 'auto') fail('超过 9 的凶险按规则结算。');
  // 官方中文规则 p42：普通创伤抽取在凶险为0时无事发生；卡文指定牌库除外。
  if (body.mode === 'draw' && selected === 'auto' && danger === 0) return;
  const overflow = danger > 9 && (selected === 'auto' || body.mode === 'hit');
  const deck = overflow ? 'obol' : selected !== 'auto' ? selected : track?.[danger - 1];
  if (!deck) fail(danger === 0 ? '凶险为 0，请按卡文指定牌库。' : '当前泰坦缺少创伤表。请在泰坦管理中配置，或按卡文手动指定牌库。', 409);
  if (overflow) {
    state.highestDanger = Math.max(state.highestDanger, danger);
    addOverflowCards(state);
  }
  const pile = state.piles[deck];
  if (!pile.length) fail('这叠创伤牌已抽空，请先结算并归还。', 409);
  if (deck === 'obol') shuffle(pile, randomInt);
  const card = pile.shift();
  if (deck === 'obol') state.piles.obol = pile.filter(id => cards.get(id).return !== 'temporary');
  if (body.mode !== 'draw' || selected === 'auto') hero.stats.danger = Math.min(danger, 9);
  const revealed = { id: body.id, card, seat, danger, kept: false };
  state.drawn.push(revealed);
  state.latest = { ...revealed };
}
