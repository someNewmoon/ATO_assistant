(() => {
  const root = document.getElementById('battleRoom');
  const toggle = document.getElementById('battleRoomToggle');
  const content = root.querySelector('[data-room-content]');
  const summary = root.querySelector('[data-room-summary]');
  const status = root.querySelector('[role="status"]');
  const params = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const routeId = params.get('battle');
  const invite = fragment.get('invite') || '';
  const quickJoin = params.get('quick') === '1';
  const viewKey = fragment.get('view') || '';
  const isLink = /^[a-f0-9]{32}$/.test(routeId || '');
  const base = new URL('../api/battle-room/', location.href);
  const campaignUrl = new URL('../api/campaign-state.php', location.href);
  const savedRoom = 'ato-aibp-last-room';
  const tokenKey = id => 'ato-aibp-room-' + id;
  const { escape, heroPortrait, MNEMOS, FATED_MNEMOS } = window.ATO_HERO_CATALOG;
  const { gearState } = window.ATO_ROOM_CARD_STATE;
  const memoryCatalog = new Map([...Object.values(MNEMOS).flat(), ...Object.values(FATED_MNEMOS).flat()]
    .map(card => [card.card, card]));
  const statNames = { danger: '凶险', fate: '命运', rage: '怒气' };
  const poolNames = { opening: '伺机', break: '破势', diversion: '分神', rouse: '激励', black: '破坏', fire: '火焰', hope: '希望' };
  const conditionNames = { standing: '站立', down: '倒地', rising: '起身', dead: '死亡' };
  const dice = window.ATO_ROOM_DICE;
  let id = isLink ? routeId : '';
  let credentials = null;
  let state = null;
  let lastProjectionSent = '';
  let lobbyCampaign;
  let abilityDictionary;
  const battleConfig = window.ATO_BATTLE_CONFIG;
  let actor = null;
  let socket = null;
  let reconnectTimer;
  let connectionTimer;
  let reconnectDelay = 1000;
  const selectedDice = new Map();
  let rollMode = 'attack';
  let rollSeat = 0;
  let parentRoll = '';
  let armedCard = '';
  let pending = false;
  let writing = false;
  let failedAction = null;
  const actions = [];
  let connection = '正在连接';
  let message = '';
  const roomBoard = window.BattleRoomBoard?.create(root.querySelector('[data-room-board]'), action =>
    send({ id: crypto.randomUUID(), ...action }));

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Keep this tab usable. */ }
  }

  function saved(id) {
    try { return JSON.parse(storageGet(tokenKey(id))); } catch { return null; }
  }

  function roomLink(mode, token) {
    const shareOrigin = location.hostname === 'ato-moon-assistant.pages.dev' ? 'https://moon.xuzizi.cn' : location.origin;
    const url = new URL(mode && window.ATO_LIGHT_ROOM ? '/aibp/room' : location.pathname, mode ? shareOrigin : location.origin);
    url.searchParams.set('battle', id);
    if (mode) url.hash = new URLSearchParams({ [mode]: token }).toString();
    else if (actor?.role === 'host' || credentials?.keys) {
      const current = new URL(location.href);
      const apostle = current.searchParams.get('apostle') || current.hash.slice(1);
      if (apostle) url.searchParams.set('apostle', apostle);
    }
    return url.href;
  }

  function updateStatus() {
    status.textContent = [state && connection, message].filter(Boolean).join(' · ');
  }

  function say(text) {
    message = text;
    updateStatus();
  }

  class RejectedAction extends Error {}

  async function request(path, body, token = credentials?.token) {
    const url = new URL(path, base);
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST', headers, cache: 'no-store',
      signal: AbortSignal.timeout(12000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let data;
    try { data = await response.json(); } catch { throw new TypeError('无法连接在线战斗室。'); }
    if (response.status >= 500) throw new TypeError(data.error || '战斗室暂时不可用。');
    if (!response.ok) throw new RejectedAction(data.error || '战斗室请求失败。');
    return data;
  }

  function accept(data) {
    if (data.room.id !== id || (state && data.room.revision < state.revision)) return;
    if (state?.revision === data.room.revision && actor) return;
    state = data.room;
    actor = data.actor;
    document.body.classList.toggle('aibp-room-only', actor.role !== 'host');
    roomBoard?.sync(state, actor);
    render();
    if (actor.role === 'host') syncProjection();
  }

  function connect() {
    if (!credentials?.token || socket) return;
    const url = new URL(id + '/socket', base);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url, ['ato-battle-v1', credentials.token]);
    const current = socket;
    connectionTimer = setTimeout(() => current.close(), 12000);
    current.onopen = () => {
      clearTimeout(connectionTimer);
      reconnectDelay = 1000;
      connection = '已连接 · 自动保存';
      updateStatus();
    };
    current.onmessage = event => accept(JSON.parse(event.data));
    current.onclose = () => {
      if (current !== socket) return;
      clearTimeout(connectionTimer);
      socket = null;
      connection = '连接已断开，正在重连';
      updateStatus();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    };
  }

  function buttons(type, key, count, seat, label, limit, enabled) {
    const keyAttr = key ? ' data-key="' + escape(key) + '"' : '';
    const seatAttr = seat === undefined ? '' : ' data-seat="' + seat + '"';
    const button = (delta, symbol, disabled) => '<button type="button" data-action="' + type + '"' + keyAttr + seatAttr
      + ' data-delta="' + delta + '" aria-label="' + (delta < 0 ? '减少' : '增加') + escape(label) + '"'
      + (disabled ? ' disabled' : '') + '>' + symbol + '</button>';
    return '<span class="battle-room-counter">' + (enabled ? button(-1, '−', count === 0) : '')
      + '<strong>' + count + '</strong>' + (enabled ? button(1, '+', count >= limit) : '') + '</span>';
  }

  function cardImage(src, name, className = '', thumb = '') {
    if (!src) return '';
    return '<button type="button" class="battle-room-card-art ' + className
      + '" data-room-art="' + escape(src) + '" aria-label="放大' + escape(name) + '">'
      + '<img src="' + escape(thumb || src) + '" alt="' + escape(name) + '" loading="lazy" decoding="async"></button>';
  }

  function marker(src, label) {
    return '<span class="battle-room-marker"><img src="' + src + '" alt="" decoding="async">' + label + '</span>';
  }

  function referenceCard(name, id, detail, memory) {
    const icons = [memory?.skill1, memory?.skill2].filter(Boolean)
      .map(skill => '<img alt="" src="../hero/assets/skill_' + escape(skill) + '.png">').join('');
    const thresholds = memory?.thresholds?.length ? '<span>' + memory.thresholds.join(' · ') + '</span>' : '';
    const passages = memory?.nodes?.length ? '<span>' + memory.nodes.map(escape).join(' · ') + '</span>' : '';
    return '<div class="battle-room-reference"><small>' + escape(id) + '</small><strong>' + escape(name)
      + '</strong><span class="battle-room-reference-icons">' + icons + '</span><span>' + escape(detail)
      + '</span>' + thresholds + passages + '</div>';
  }

  function playableCard({ item, type, seat, slot = 0, value, detail, src, memory, editable }) {
    const id = [type, seat, item.id, slot].join(':');
    const armed = armedCard === id;
    const discarded = value === 'discarded';
    const text = discarded ? '已弃除' : armed ? '横置并弃除' : value === 'exhausted' ? '恢复' : '横置';
    const next = armed ? 'discarded' : value === 'exhausted' ? 'ready' : 'exhausted';
    const attrs = ' data-key="' + escape(item.id) + '" data-seat="' + seat + '" data-slot="' + slot + '"';
    return '<li class="battle-room-playable" data-card-state="' + value + '" data-card-id="' + escape(id)
      + '"><div class="battle-room-card-window">' + (src ? cardImage(src, item.name, '', window.ATO_BATTLE_ASSETS?.thumbSrc(item.id))
        : referenceCard(item.name, item.id, memory ? '旧忆资料卡' : '装备资料卡', memory)) + '</div>'
      + '<span class="battle-room-card-name">' + escape(item.name) + '</span>'
      + (detail ? '<small>' + escape(detail) + '</small>' : '')
      + (editable && !discarded ? '<div class="battle-room-card-controls"><button type="button" data-action="' + type
        + '"' + attrs + ' data-value="' + next + '">' + text + '</button><button type="button" data-arm-card="' + escape(id)
        + '" aria-pressed="' + armed + '" aria-label="' + (armed ? '取消弃除' : '准备弃除') + escape(item.name) + '" title="'
        + (armed ? '取消弃除' : '准备弃除') + '">' + (armed ? '取消' : '弃除') + '</button></div>'
        : value !== 'ready' ? '<small class="battle-room-card-status">' + (discarded ? '已弃除' : '已横置') + '</small>' : '') + '</li>';
  }

  function heroCard(hero, seat) {
    const editable = !state.closed && (actor.role === 'host' || (actor.role === 'player' && actor.seat === seat));
    const art = window.ATO_BATTLE_ASSETS;
    const titan = hero.titan ? escape(window.ATO_GEAR_INVENTORY.titanLabel(hero.titan)) : '未分配泰坦';
    const titanArt = hero.titan && art?.titanArt(hero.titan);
    const titanImage = titanArt ? cardImage(titanArt.src, titanArt.name, 'battle-room-titan-art', art.thumbSrc(titanArt.name)) : '';
    const portrait = heroPortrait(hero);
    const avatar = portrait ? '<img class="battle-room-avatar" src="../hero/assets/' + portrait + '" alt="">' : '';
    const gear = hero.gear.map(item => Array.from({ length: Math.min(item.count, 48) }, (_, slot) => playableCard({
      item, type: 'gear-card', seat, slot, value: gearState(item, slot),
      src: art?.gearSrc(item.id), editable, detail: item.count > 1 ? String(slot + 1) + '/' + item.count : '',
    })).join('') + (item.count > 48 ? '<li>' + escape(item.name) + ' 另有 ' + (item.count - 48) + ' 件</li>' : '')).join('');
    const mnemos = hero.mnemos.map(item => playableCard({
      item, type: 'mnemos-card', seat, value: item.state || 'ready', src: art?.mnemosSrc(item.id),
      memory: memoryCatalog.get(item.id), editable, detail: item.fated ? '命业旧忆' : item.progress + '/' + item.limit,
    })).join('');
    const stats = Object.entries(statNames).map(([key, label]) => '<div>'
      + marker('../hero/assets/tri_' + key + '.png', label)
      + buttons('stat', key, hero.stats[key], seat, label, 30, editable) + '</div>').join('');
    const condition = editable ? '<select data-condition="' + seat + '" aria-label="' + escape(hero.name) + '的泰坦状态">'
      + Object.entries(conditionNames).map(([key, label]) => '<option value="' + key + '"' + (key === hero.condition ? ' selected' : '') + '>' + label + '</option>').join('')
      + '</select>' : '<small>' + conditionNames[hero.condition] + '</small>';
    const last = state.rolls.find(roll => roll.seat === seat);
    const summary = last ? '<p class="battle-room-result">最近一次掷骰 · ' + rollSummary(last) + '</p>' : '';
    return '<article class="battle-room-hero" data-hero-seat="' + seat + '"><header><div class="battle-room-identity">'
      + avatar + '<div><h3>' + escape(hero.name) + '</h3><small>' + escape(hero.player || '待认领') + '</small></div></div>'
      + titanImage + '<div class="battle-room-titan-status"><span>' + titan + '</span>' + condition + '</div></header>'
      + '<div class="battle-room-stats" role="group" aria-label="三曲盘">' + stats + '</div>'
      + '<h4>装备</h4>' + (gear ? '<ul class="battle-room-card-list">' + gear + '</ul>' : '<p>未分配装备</p>')
      + '<h4>旧忆</h4>' + (mnemos ? '<ul class="battle-room-card-list">' + mnemos + '</ul>' : '<p>暂无旧忆卡牌</p>')
      + summary + '</article>';
  }

  function diceDraftKey(seat, mode) {
    return 'ato-room-dice-' + id + '-' + seat + '-' + mode;
  }

  function readDiceDraft(seat, mode) {
    try { return JSON.parse(storageGet(diceDraftKey(seat, mode))) || {}; } catch { return {}; }
  }

  function saveDiceDraft(seat, mode, fields) {
    storageSet(diceDraftKey(seat, mode), JSON.stringify(fields));
  }

  function faceLabel([power, potential, dot]) {
    return power + ' 威力 · ' + potential + ' 潜力 · ' + dot + ' ●';
  }

  function faceArt(die) {
    const natural = dice.naturalFace(die);
    if (natural) {
      const index = dice.faceIndex(die);
      if (index >= 0) return '<span class="room-die-face is-' + die.kind + '" role="img" aria-label="' + faceLabel(natural)
        + '" style="background-position:' + index % 3 * 50 + '% ' + (index < 3 ? 50 : 100) + '%"></span>';
    }
    const name = dice.names[die.kind];
    if (die.kind === 'd10' || die.kind === 'crit') {
      return '<img class="room-die-face" src="room-dice-art/' + die.kind + '-' + die.value + '.svg" alt="' + name + ' ' + die.value + '">';
    }
    return '<span class="room-die-face room-die-number">' + escape(die.value) + '</span>';
  }

  function rollSummary(roll) {
    const strengths = roll.dice.map(dice.remainingFace).filter(Boolean);
    if (!strengths.length) return roll.dice.map(die => dice.names[die.kind] + ' ' + die.value).join('、');
    return faceLabel(strengths.reduce((sum, face) => sum.map((value, index) => value + face[index]), [0, 0, 0]));
  }

  function rollCard(roll) {
    const editable = Boolean(roll.id) && !state.closed && (actor.role === 'host' || (actor.role === 'player' && actor.seat === roll.seat));
    const selection = selectedDice.get(roll.id);
    const attrs = ' data-roll-id="' + escape(roll.id) + '" data-seat="' + roll.seat + '"';
    const mode = dice.modes[roll.mode]?.name;
    const faces = roll.dice.map(die => {
      const result = dice.remainingFace(die);
      const canSelect = editable && dice.canReroll(die);
      const dieAttrs = attrs + ' data-die-id="' + escape(die.id) + '"';
      const original = result ? dice.faces[die.kind]?.[die.original] : die.original;
      const originalLabel = Array.isArray(original) ? faceLabel(original) : original;
      const art = faceArt(die);
      return '<div class="room-die"><small>' + dice.names[die.kind] + '</small>'
        + (canSelect ? '<button type="button" data-select-die' + dieAttrs + ' aria-pressed="' + Boolean(selection?.has(die.id))
          + '" aria-label="选中' + dice.names[die.kind] + '重掷">' + art + '</button>' : art)
        + '<span>' + (result ? result.map((n, i) => n + ['ϟ', '△', '●'][i]).join(' ') : die.value) + '</span>'
        + (die.rerolled ? '<small>已重掷 · 原掷 ' + escape(originalLabel) + '</small>' : '')
        + (editable && result ? '<div class="room-die-conversions">'
          + (result[1] ? '<button type="button" data-action="convert" data-symbol="potential"' + dieAttrs + ' title="将一枚潜力转为威力">△ → ϟ</button>' : '')
          + (result[2] ? '<button type="button" data-action="convert" data-symbol="dot"' + dieAttrs + ' title="将一枚●转为威力">● → ϟ</button>' : '') + '</div>' : '')
        + '</div>';
    }).join('');
    const followup = roll.defenseCount && !roll.defenseRoll;
    return '<li class="room-roll"><h4>' + escape(roll.hero) + (mode ? ' · ' + mode : '') + ' <small>第 ' + roll.round + ' 轮</small></h4>'
      + '<div class="room-dice-results">' + faces + '</div><p>' + rollSummary(roll) + '</p>'
      + (followup ? '<p class="room-dice-help">已配置 ' + roll.defenseCount + ' 枚防御红骰，请按闪避结果确认是否投掷。</p>' : '')
      + (editable && (roll.mode === 'attack' || followup) ? '<button type="button" data-roll-followup="'
        + (followup ? 'defense' : 'power') + '"' + attrs + '>' + (followup ? '准备投掷防御红骰' : '准备投掷威力骰') + '</button>' : '')
      + (editable && roll.dice.some(dice.canReroll) ? '<button type="button" data-action="reroll"' + attrs
        + (selection?.size ? '' : ' disabled') + '>重掷所选骰子' + (selection?.size ? '（' + selection.size + '）' : '') + '</button>' : '')
      + '</li>';
  }

  function diceCountField(kind, label, min, max, value) {
    const button = (delta, text) => '<button type="button" data-dice-step="' + kind + '" data-delta="' + delta
      + '" aria-label="' + (delta < 0 ? '减少' : '增加') + escape(label) + '"'
      + ((delta < 0 ? Number(value) <= min : Number(value) >= max) ? ' disabled' : '') + '>' + text + '</button>';
    return '<label>' + escape(label) + '<small>上限 ' + max + ' 枚</small><span class="room-dice-stepper">' + button(-1, '−')
      + '<input type="number" min="' + min + '" max="' + max + '" name="' + kind + '" value="' + escape(value)
      + '" required aria-label="' + escape(label) + '">' + button(1, '+') + '</span></label>';
  }

  function diceForm() {
    if (state.closed || actor.role === 'viewer') return '';
    const seat = actor.role === 'host' ? rollSeat : actor.seat;
    const drafts = readDiceDraft(seat, rollMode);
    const options = actor.role === 'host' ? state.heroes.map((hero, index) =>
      '<option value="' + index + '"' + (seat === index ? ' selected' : '') + '>' + escape(hero.name) + '</option>').join('') : '';
    const fields = dice.modes[rollMode].kinds.map(kind => {
      const label = kind === 'd10' ? '总数量（含 1 枚白色关键骰）' : dice.names[kind];
      const minimum = kind === 'd10' || kind === 'armor' || rollMode === 'defense' ? 1 : 0;
      return diceCountField(kind, label, minimum, dice.limits[kind], drafts[kind] ?? minimum);
    }).join('');
    const followup = rollMode === 'dodge' ? diceCountField('defenseCount', '预计防御红骰', 0, 6, drafts.defenseCount ?? 0) : '';
    const notes = {
      attack: '按精准、伺机和卡文结算命中，再确认威力骰数量。',
      dodge: '先结算闪避，根据结果决定是否投掷防御红骰。',
      power: '依命中与卡文确认威力骰数量。重掷费用和符号转换来源由玩家结算。',
    };
    return '<section class="room-dice-panel"><h3>掷骰</h3>' + (options ? '<label>英雄 <select data-roll-seat>' + options + '</select></label>' : '')
      + '<div class="room-dice-modes" role="group" aria-label="投掷用途">' + Object.entries(dice.modes)
        .map(([key, entry]) => '<button type="button" data-roll-mode="' + key + '" aria-pressed="' + (key === rollMode) + '">'
          + (key === 'dodge' ? '<img src="room-dice-art/dodge.webp" alt="">' : '') + entry.name + '</button>').join('') + '</div>'
      + '<form data-roll class="battle-room-dice"><div>' + fields + followup
      + '<button type="submit">投掷' + dice.modes[rollMode].name + '</button></div></form>'
      + (notes[rollMode] ? '<p class="room-dice-help">' + notes[rollMode] + '</p>' : '') + '</section>';
  }

  function syncProjection() {
    if (actor?.role !== 'host' || state.closed || !state.board) return;
    const projection = window.getAibpRoomProjection?.();
    if (!projection || projection.apostle !== state.board.apostle) return;
    const key = JSON.stringify(projection);
    if (key === lastProjectionSent) return;
    lastProjectionSent = key;
    send({ id: crypto.randomUUID(), type: 'room-projection', projection });
  }

  function roomProjection() {
    const projection = state.projection;
    if (actor.role !== 'viewer') return '';
    if (!projection) return state.board ? '<section class="room-projection"><h3>骇物战况</h3><p>等待房主同步 AIBP 战况。</p></section>' : '';
    const { title, level, panel, ai, bp, aiDeck, bpDeck, damage } = projection;
    function preview(label, card, empty) {
      return '<div><h4>' + label + '</h4>' + (card?.src
        ? cardImage(card.src, card.label || label) : '<p>' + empty + '</p>') + '</div>';
    }
    function deckCounts(label, deck) {
      return '<div><dt>' + label + '</dt><dd>牌背 ' + deck.count + ' 张 · 弃牌 ' + deck.discard + ' 张</dd>'
        + (deck.backs ? '<dd class="room-projection-deck">' + escape(deck.backs) + '</dd>' : '') + '</div>';
    }
    const damageText = damage.total + (damage.wounds ? ' / ' + damage.wounds : '')
      + (damage.damage1 == null ? '' : '（' + damage.damage1 + ' + ' + damage.damage2 + '）');
    return '<section class="room-projection"><h3>骇物战况</h3><p>' + escape([title, level].filter(Boolean).join(' · ')) + '</p>'
      + '<div class="room-projection-cards">' + preview('骇物面板', { src: panel, label: title }, '暂无面板图')
      + preview('已揭示 AI', ai, '未揭示 AI') + preview('已揭示 BP', bp, '未揭示 BP') + '</div>'
      + '<dl class="room-projection-counts"><div><dt>损伤</dt><dd>' + damageText + '</dd></div>'
      + deckCounts('AI 牌堆', aiDeck) + deckCounts('BP 牌堆', bpDeck) + '</dl></section>';
  }

  function argoAbilities() {
    const config = state.configuration;
    if (!config?.abilities?.length && !config?.reserve?.length) return '';
    const editable = actor?.role !== 'viewer' && !state.closed;
    const cards = [...config.abilities, ...config.reserve];
    const ready = editable && actor.role === 'host'
      ? '<button type="button" data-action="round" title="推进到下一轮并回正能力卡；不补充剩余次数">下一轮 · 一键回正</button>' : '';
    return '<section class="room-argo-abilities"><header><h3>阿尔戈能力</h3>' + ready + '</header><small>' + escape(config.name) + ' · 已准备 '
      + config.abilities.length + '/' + config.limit + ' · 每项每轮限用一次</small><div class="room-argo-cards">'
      + cards.map(card => {
        const reserve = config.reserve.includes(card);
        const used = state.argoAbilities?.[card.id] || { used: 0, lastRound: null };
        const exhausted = used.lastRound === state.round;
        const limit = battleConfig.abilityCapacity(card.id);
        const depleted = limit !== null && used.used >= limit;
        const label = limit === null ? '已用 ' + used.used + ' 次 · 次数按卡面'
          : '剩余 ' + Math.max(0, limit - used.used) + ' / ' + limit + ' 次';
        const canUndo = exhausted && (actor.role === 'host' || used.by === actor.seat);
        const controls = editable && !reserve ? '<div class="battle-room-card-controls"><button type="button" data-action="argo-use" data-key="'
          + escape(card.id) + '"' + (exhausted || depleted ? ' disabled' : '') + '>使用并横置</button>'
          + (canUndo ? '<button type="button" data-action="argo-undo" data-key="' + escape(card.id) + '">撤销本次</button>' : '') + '</div>' : '';
        return '<div class="room-argo-card" data-argo-id="' + escape(card.id) + '" data-card-state="' + (exhausted ? 'exhausted' : 'ready')
          + '"><div class="room-argo-card-window">' + cardImage('../' + card.path, card.name) + '</div><span>' + escape(card.name)
          + (reserve ? ' · 备用' : '') + '</span><strong>' + label + '</strong><small>'
          + (exhausted ? '本轮已用 · 已横置' : depleted ? '次数已用尽' : reserve ? '备用能力' : '可使用') + '</small>' + controls + '</div>';
      }).join('') + '</div></section>';
  }

  function configFields(available) {
    const configs = available.record.battleConfigurations || [];
    const active = configs.find(config => config.id === available.record.activeBattleConfiguration) || {};
    const options = configs.map(config => '<option value="' + escape(config.id) + '"' + (config.id === active.id ? ' selected' : '') + '>' + escape(config.name) + '</option>').join('');
    return '<fieldset class="room-configuration"><legend>阿尔戈能力 · 战斗配置</legend>'
      + '<label>已保存配置<select name="configuration"><option value="">新配置</option>' + options + '</select></label>'
      + '<label>配置名称<input name="configName" maxlength="60" value="' + escape(active.name || '战斗配置') + '" required></label>'
      + '<p data-config-limit>可准备 ' + available.limit + ' 项' + (available.reserveLimit ? ' · 可另选 1 项备用' : '') + '</p>'
      + '<div class="room-config-choices">' + available.cards.map(card => '<label><img src="../' + escape(card.path) + '" alt="' + escape(card.name)
        + '" loading="lazy"><span>' + escape(card.name) + '<input name="ability" type="checkbox" value="' + escape(card.id)
        + '"' + (active.abilities?.includes(card.id) ? ' checked' : '') + '>准备'
        + (available.reserveLimit ? '<input name="reserve" type="checkbox" value="' + escape(card.id) + '"' + (active.reserve?.includes(card.id) ? ' checked' : '') + '>备用' : '')
        + '</span></label>').join('') + '</div>'
      + (available.cards.length ? '' : '<p>尚无已学会的阿尔戈能力，可在科技页解锁。</p>')
      + '<button type="button" data-save-config>保存战斗配置</button><p data-config-status role="status"></p></fieldset>';
  }

  function readConfig(form) {
    const fields = new FormData(form);
    return { name: fields.get('configName'), abilities: fields.getAll('ability'), reserve: fields.getAll('reserve') };
  }

  async function saveConfig(form) {
    const status = form.querySelector('[data-config-status]');
    const button = form.querySelector('[data-save-config]');
    const chosen = form.elements.configuration.value;
    const configId = chosen || (form.dataset.configDraftId ||= crypto.randomUUID());
    const draft = { id: configId, ...readConfig(form) };
    const profile = battleConfig.profileId(lobbyCampaign);
    const accountId = lobbyCampaign.accountId;
    const base = (battleConfig.availability(lobbyCampaign, abilityDictionary).record.battleConfigurations || []).find(entry => entry.id === configId);
    button.disabled = true;
    status.textContent = '正在保存配置';
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const response = await fetch(campaignUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error('请先登录后保存配置。');
        const data = await response.json();
        const campaign = data.campaign;
        if (battleConfig.profileId(campaign) !== profile || data.user?.id !== accountId) throw new Error('账号或档案已切换，请重新打开战斗配置。');
        const available = battleConfig.availability(campaign, abilityDictionary);
        battleConfig.prepare(draft, available);
        const configs = available.record.battleConfigurations || [];
        const current = configs.find(entry => entry.id === configId);
        const alreadySaved = JSON.stringify(current) === JSON.stringify(draft);
        if (!alreadySaved && JSON.stringify(current) !== JSON.stringify(base)) throw new Error('该配置已在其他页面修改，请重新载入。');
        const record = { ...available.record, activeBattleConfiguration: configId,
          battleConfigurations: [...configs.filter(entry => entry.id !== configId), draft] };
        if (!alreadySaved || available.record.activeBattleConfiguration !== configId) {
          const saved = await fetch(campaignUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section: 'record', userId: profile, state: record,
              expectedRevision: campaign.sectionRevisions.record, expectedAccountId: accountId }) });
          if (saved.status === 409) continue;
          if (!saved.ok) throw new Error((await saved.json()).error || '保存失败');
        }
        lobbyCampaign = { ...campaign, accountId };
        if (campaign.sections.record?.users || campaign.sections.record?.accounts) {
          const key = campaign.sections.record.users ? 'users' : 'accounts';
          campaign.sections.record[key][profile] = record;
        } else campaign.sections.record = record;
        const fields = form.querySelector('.room-configuration');
        fields.outerHTML = configFields({ ...available, record });
        form.querySelector('[data-config-status]').textContent = '已保存，下次可直接选择这套配置。';
        return;
      }
      throw new Error('保存时发生并发修改，请重试。');
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  }

  function render() {
    const { role, seat } = actor;
    const host = role === 'host';
    const edit = role !== 'viewer' && !state.closed;
    const links = host && credentials.keys ? '<div class="battle-room-links">'
      + (!state.closed ? '<button type="button" data-room-copy="invite">复制玩家邀请</button>' : '')
      + '<a href="' + escape(roomLink('view', credentials.keys.viewer)) + '" target="_blank" rel="noopener">打开只读投屏</a>'
      + (state.closed ? '<a href="./">返回 AIBP 开新战斗</a>' : '') + '</div>' : '';
    const controls = host && !state.closed ? '<button type="button" data-action="public-lobby" data-value="' + !state.publicLobby + '">' + (state.publicLobby ? '关闭快速参战' : '开放快速参战') + '</button><button type="button" data-action="round">下一轮</button><button type="button" data-action="end">结束战斗</button>' : '';
    const pool = Object.entries(poolNames).map(([key, label]) => '<div>' + marker('images/battle-markers/' + key + '.webp', label)
      + buttons('pool', key, state.pool[key], undefined, label, 99, edit) + '</div>').join('');
    const clearPool = edit ? '<button type="button" data-action="pool-clear"'
      + (Object.values(state.pool).every(value => value === 0) ? ' disabled' : '') + '>一键清空</button>' : '';
    const heroes = state.heroes.map(heroCard);
    const own = role === 'player' ? '<h3 class="battle-room-heading">我的英雄</h3>' + heroes[seat] : '';
    const overview = role === 'player'
      ? '<details class="battle-room-team"' + (content.querySelector('.battle-room-team')?.open ? ' open' : '')
        + '><summary>队伍状态</summary><div class="battle-room-grid">' + heroes.filter((_, index) => index !== seat).join('') + '</div></details>'
      : '<div class="battle-room-grid">' + heroes.join('') + '</div>';
    for (const [id, choices] of selectedDice) {
      const roll = state.rolls.find(entry => entry.id === id);
      for (const dieId of choices) if (!roll?.dice.some(die => die.id === dieId && dice.canReroll(die))) choices.delete(dieId);
      if (!choices.size) selectedDice.delete(id);
    }
    const rolls = state.rolls.map(rollCard).join('');
    const rollLog = '<section class="battle-room-rolls"><h3>掷骰记录</h3>'
      + (rolls ? '<ol>' + rolls + '</ol>' : '<p>还没有掷骰。</p>') + '</section>';
    const active = document.activeElement;
    const focusRoot = summary.contains(active) ? summary : content;
    const focus = active && focusRoot.contains(active) ? [...focusRoot.querySelectorAll('button,select,input')].indexOf(active) : -1;
    const selection = focus >= 0 && active.name;
    summary.innerHTML = '<div class="battle-room-head"><div><h2>' + escape(state.title) + '</h2><p>第 ' + state.round
      + ' 轮' + (state.closed ? ' · 已结束' : '') + '</p></div><div>' + controls + '</div></div>' + links;
    content.innerHTML = roomProjection() + argoAbilities() + own + '<section class="battle-room-pool"><header><h3>克拉托斯池</h3>' + clearPool + '</header><div>' + pool + '</div></section>' + diceForm()
      + (edit ? rollLog : '') + (role !== 'player' ? '<h3 class="battle-room-heading">状态总览</h3>' : '') + overview
      + (edit ? '' : rollLog);
    if (focus >= 0) {
      const target = focusRoot.querySelectorAll('button,select,input')[focus];
      if (target && (!selection || target.name === selection)) target.focus({ preventScroll: true });
    }
    if (failedAction) appendRetry();
    updateStatus();
  }

  function appendRetry() {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.roomRetry = '';
    button.textContent = '重试上次操作';
    content.append(button);
  }

  function send(action) {
    actions.push(action);
    void writeActions();
  }

  async function writeActions() {
    if (writing || failedAction) return;
    writing = true;
    while (actions.length && !failedAction) {
      const action = actions.shift();
      try {
        accept(await request(id + '/action', action));
        say('');
      } catch (error) {
        say(error.message);
        if (error instanceof RejectedAction) {
          if (action.type === 'room-projection') lastProjectionSent = '';
          render();
        }
        else {
          failedAction = action;
          appendRetry();
        }
      }
    }
    writing = false;
  }

  async function openHostLobby() {
    root.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    const recent = storageGet(savedRoom);
    const stored = recent && saved(recent);
    const resume = stored?.token ? '<p><a href="' + escape(new URL('?battle=' + recent, location.href).href) + '">返回上一次战斗</a></p>' : '';
    content.innerHTML = resume;
    say('正在读取当前战役');
    try {
      const response = await fetch(campaignUrl, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('请先在主控台登录，再创建在线战斗室。');
      const data = await response.json();
      lobbyCampaign = { ...data.campaign, accountId: data.user?.id };
      if (!abilityDictionary) {
        const dictionary = await fetch('../technology/tech_card_dictionary.min.json');
        if (!dictionary.ok) throw new Error('无法读取科技卡牌目录，请刷新重试。');
        abilityDictionary = await dictionary.json();
      }
      const available = battleConfig.availability(lobbyCampaign, abilityDictionary);
      const heroes = window.ATO_HERO_CATALOG.activeHeroes(data.campaign);
      if (!heroes.length) {
        content.innerHTML += '<p>请先到<a href="../hero/">英雄页</a>添加参战英雄。</p>';
        return;
      }
      const suggested = document.querySelector('#title')?.innerText?.trim() || '决战';
      content.innerHTML += '<form data-create><label>战斗名称 <input name="title" maxlength="80" value="' + escape(suggested)
        + '"></label><fieldset><legend>选择 1 至 4 位参战英雄</legend>'
        + heroes.map((hero, index) => '<label><input type="checkbox" name="heroIds" value="' + escape(hero.id)
          + '"' + (index < 4 ? ' checked' : '') + '> ' + escape(window.ATO_HERO_CATALOG.heroDisplayName(hero)) + '</label>').join('')
        + '</fieldset>' + configFields(available) + '<label><input name="publicLobby" type="checkbox" checked>允许从登录页快速参战（无需邀请链接）</label><button type="submit">创建战斗室</button></form>';
    } catch (error) {
      content.innerHTML += '<p>' + escape(error.message) + ' <a href="../index.html">打开主控台</a></p>';
    } finally {
      say('');
    }
  }

  async function openJoinLobby() {
    const lobby = await request(id + '/lobby', { quick: quickJoin }, invite);
    const options = lobby.heroes.map((hero, index) => '<option value="' + index + '"' + (hero.taken ? ' disabled' : '') + '>'
      + escape(hero.name) + (hero.taken ? '（已认领）' : '') + '</option>').join('');
    const full = lobby.heroes.every(hero => hero.taken);
    content.innerHTML = '<h2>' + escape(lobby.title) + '</h2>' + (full ? '<p>该房间的英雄已全部被认领。</p>'
      : '<form data-join><label>玩家名 <input name="player" maxlength="32" required autocomplete="nickname"></label>'
      + '<label>英雄 <select name="seat" aria-label="英雄" required>' + options + '</select></label><button type="submit">加入战斗</button></form>');
    say('');
  }

  toggle.addEventListener('click', () => {
    if (state) {
      root.hidden = !root.hidden;
      toggle.setAttribute('aria-expanded', String(!root.hidden));
      if (!root.hidden) root.scrollIntoView({ block: 'nearest' });
    } else void openHostLobby();
  });

  content.addEventListener('input', event => {
    if (event.target.form?.matches('[data-roll]')) {
      const input = event.target;
      for (const button of input.parentElement.querySelectorAll('[data-dice-step]')) {
        button.disabled = Number(button.dataset.delta) < 0 ? Number(input.value) <= Number(input.min) : Number(input.value) >= Number(input.max);
      }
      const seat = actor.role === 'host' ? rollSeat : actor.seat;
      saveDiceDraft(seat, rollMode, Object.fromEntries(new FormData(event.target.form)));
    }
  });

  content.addEventListener('change', event => {
    if (event.target.name === 'configuration') {
      const form = event.target.form;
      delete form.dataset.configDraftId;
      const available = battleConfig.availability(lobbyCampaign, abilityDictionary);
      const config = available.record.battleConfigurations?.find(entry => entry.id === event.target.value) || {};
      form.elements.configName.value = config.name || '战斗配置';
      for (const input of form.querySelectorAll('[name="ability"],[name="reserve"]')) {
        input.checked = (input.name === 'ability' ? config.abilities : config.reserve)?.includes(input.value) || false;
      }
      return;
    }
    if (event.target.matches('[data-roll-seat]')) {
      rollSeat = Number(event.target.value);
      parentRoll = '';
      render();
      return;
    }
    if (event.target.matches('[data-condition]')) {
      void send({ id: crypto.randomUUID(), type: 'condition', seat: Number(event.target.dataset.condition), value: event.target.value });
    }
  });

  window.addEventListener('aibp-room-projection', syncProjection);

  document.addEventListener('ato-battle-assets', () => {
    if (state) { roomBoard?.render(); render(); }
  });

  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || (!summary.contains(button) && !content.contains(button))) return;
    if (button.hasAttribute('data-save-config')) {
      void saveConfig(button.form);
      return;
    }
    const { roomCopy, action, key, seat, delta, armCard, slot, value,
      rollMode: mode, rollFollowup, rollId, dieId, symbol } = button.dataset;
    if (button.dataset.diceStep) {
      const input = button.form.elements.namedItem(button.dataset.diceStep);
      input.value = Math.max(Number(input.min), Math.min(Number(input.max), (Number(input.value) || 0) + Number(delta)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (mode || rollFollowup) {
      rollMode = mode || rollFollowup;
      parentRoll = rollFollowup ? rollId : '';
      if (rollFollowup) {
        rollSeat = Number(seat);
        const source = state.rolls.find(roll => roll.id === rollId);
        if (rollMode === 'defense' && source) saveDiceDraft(rollSeat, 'defense', { red: source.defenseCount });
      }
      render();
      content.querySelector('[data-roll] input')?.focus();
      return;
    }
    if (button.hasAttribute('data-select-die')) {
      const choice = selectedDice.get(rollId) || new Set();
      if (choice.has(dieId)) choice.delete(dieId);
      else choice.add(dieId);
      selectedDice.set(rollId, choice);
      render();
      return;
    }
    if (action === 'reroll' || action === 'convert') {
      const selection = [...(selectedDice.get(rollId) || [])];
      if (action === 'reroll') selectedDice.delete(rollId);
      else selectedDice.get(rollId)?.delete(dieId);
      send({ id: crypto.randomUUID(), type: action, seat: Number(seat), roll: rollId,
        ...(action === 'reroll' ? { ids: selection } : { die: dieId, symbol }) });
      render();
      return;
    }
    if (button.hasAttribute('data-room-art')) {
      const image = button.querySelector('img');
      window.ATO_BATTLE_ASSETS?.zoom(button.dataset.roomArt, image.alt);
    } else if (roomCopy) {
      const url = roomLink(roomCopy, credentials.keys[roomCopy]);
      try {
        await navigator.clipboard.writeText(url);
        say('邀请链接已复制');
      } catch {
        window.prompt('复制玩家邀请链接', url);
      }
    } else if ('roomRetry' in button.dataset && failedAction) {
      actions.unshift(failedAction);
      failedAction = null;
      button.remove();
      void writeActions();
    } else if (armCard) {
      armedCard = armedCard === armCard ? '' : armCard;
      render();
    } else if (action === 'gear-card' || action === 'mnemos-card') {
      if (value === 'discarded') armedCard = '';
      void send({ id: crypto.randomUUID(), type: action, key, seat: Number(seat), slot: Number(slot), value });
      render();
    } else if (action === 'public-lobby') {
      send({ id: crypto.randomUUID(), type: action, value: value === 'true' });
    } else if (action === 'pool-clear') {
      send({ id: crypto.randomUUID(), type: action });
    } else if (action) {
      if (action === 'end' && !window.confirm('确认结束本场战斗？结束后，房间将转为只读。')) return;
      void send({ id: crypto.randomUUID(), type: action, key, seat: Number(seat), delta: Number(delta) });
    }
  });

  content.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const fields = new FormData(form);
    if (form.matches('[data-roll]')) {
      const seat = actor.role === 'host' ? rollSeat : actor.seat;
      saveDiceDraft(seat, rollMode, Object.fromEntries(fields));
      const counts = Object.fromEntries(dice.modes[rollMode].kinds.map(kind => [kind, Number(fields.get(kind))]));
      send({ id: crypto.randomUUID(), type: 'roll', mode: rollMode, seat, counts,
        defenseCount: Number(fields.get('defenseCount')), ...(parentRoll && { parentRoll }) });
      parentRoll = '';

      return;
    }
    if (pending) return;
    pending = true;
    form.querySelector('button[type=submit]').disabled = true;
    try {
      if (form.matches('[data-create]')) {
        const board = window.getAibpBoardSetup?.();
        const projection = window.getAibpRoomProjection?.();
        const configuration = readConfig(form);
        battleConfig.prepare(configuration, battleConfig.availability(lobbyCampaign, abilityDictionary));
        const data = await request('create', { title: fields.get('title'), heroIds: fields.getAll('heroIds'), board, projection, battleConfig: configuration, publicLobby: fields.get('publicLobby') === 'on' });
        lastProjectionSent = JSON.stringify(projection);
        id = data.room.id;
        credentials = { token: data.keys.host, keys: data.keys };
        storageSet(savedRoom, id);
        storageSet(tokenKey(id), JSON.stringify(credentials));
        history.replaceState(null, '', roomLink());
        accept(data);
      } else if (form.matches('[data-join]')) {
        const token = credentials?.token || crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
        credentials = { token };
        storageSet(tokenKey(id), JSON.stringify(credentials));
        const data = await request(id + '/join', { seat: Number(fields.get('seat')), player: fields.get('player'), playerKey: token, quick: quickJoin }, invite);
        history.replaceState(null, '', roomLink());
        accept(data);
      }
      say('');
      connect();
    } catch (error) {
      say(error.message);
    } finally {
      form.querySelector('button[type=submit]').disabled = false;
      pending = false;
    }
  });

  async function start() {
    if (params.has('theatreBattle') || location.protocol === 'file:') return;
    if (!isLink) {
      try {
        const response = await fetch(new URL('../api/health', location.href), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (response.ok && (await response.json()).backend === 'cloudflare') {
        toggle.hidden = false;
        document.getElementById('cloudBattleProjection').hidden = false;
      }
      } catch { /* Battle rooms require the Cloudflare build. */ }
      return;
    }
    root.hidden = false;
    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    credentials = viewKey ? { token: viewKey } : saved(id);
    try {
      if (credentials?.token) {
        try {
          const data = await request(id + '/state');
          accept(data);
          connect();
          return;
        } catch (error) {
          if (!invite && !quickJoin) throw error;
        }
      }
      if (invite || quickJoin) await openJoinLobby();
      else throw new Error('请使用房主发给你的邀请或投屏链接。');
    } catch (error) {
      say(error.message);
    }
  }

  void start();
})();
