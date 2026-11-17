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
    const url = new URL(location.pathname, location.origin);
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

  function diceForm() {
    if (state.closed || actor.role === 'viewer') return '';
    const seat = actor.role === 'host' ? rollSeat : actor.seat;
    const drafts = readDiceDraft(seat, rollMode);
    const options = actor.role === 'host' ? state.heroes.map((hero, index) =>
      '<option value="' + index + '"' + (seat === index ? ' selected' : '') + '>' + escape(hero.name) + '</option>').join('') : '';
    const fields = dice.modes[rollMode].kinds.map(kind => {
      const label = kind === 'd10' ? '总数量（含 1 枚白色关键骰）' : dice.names[kind];
      const minimum = kind === 'd10' || kind === 'armor' || rollMode === 'defense' ? 1 : 0;
      return '<label>' + label + '<input type="number" min="' + minimum + '" max="' + dice.limits[kind]
        + '" name="' + kind + '" value="' + escape(drafts[kind] ?? minimum) + '" required></label>';
    }).join('');
    const followup = rollMode === 'dodge' ? '<label>预计防御红骰<input name="defenseCount" type="number" min="0" max="6" value="'
      + escape(drafts.defenseCount ?? 0) + '" required></label>' : '';
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

  function render() {
    const { role, seat } = actor;
    const host = role === 'host';
    const edit = role !== 'viewer' && !state.closed;
    const links = host && credentials.keys ? '<div class="battle-room-links">'
      + (!state.closed ? '<button type="button" data-room-copy="invite">复制玩家邀请</button>' : '')
      + '<a href="' + escape(roomLink('view', credentials.keys.viewer)) + '" target="_blank" rel="noopener">打开只读投屏</a>'
      + (state.closed ? '<a href="./">返回 AIBP 开新战斗</a>' : '') + '</div>' : '';
    const controls = host && !state.closed ? '<button type="button" data-action="round">下一轮</button><button type="button" data-action="end">结束战斗</button>' : '';
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
    content.innerHTML = own + '<section class="battle-room-pool"><header><h3>克拉托斯池</h3>' + clearPool + '</header><div>' + pool + '</div></section>' + diceForm()
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
        if (error instanceof RejectedAction) render();
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
        + '</fieldset><button type="submit">创建战斗室</button></form>';
    } catch (error) {
      content.innerHTML += '<p>' + escape(error.message) + ' <a href="../index.html">打开主控台</a></p>';
    } finally {
      say('');
    }
  }

  async function openJoinLobby() {
    const lobby = await request(id + '/lobby', {}, invite);
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
      const seat = actor.role === 'host' ? rollSeat : actor.seat;
      saveDiceDraft(seat, rollMode, Object.fromEntries(new FormData(event.target.form)));
    }
  });

  content.addEventListener('change', event => {
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

  document.addEventListener('ato-battle-assets', () => {
    if (state) { roomBoard?.render(); render(); }
  });

  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || (!summary.contains(button) && !content.contains(button))) return;
    const { roomCopy, action, key, seat, delta, armCard, slot, value,
      rollMode: mode, rollFollowup, rollId, dieId, symbol } = button.dataset;
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
        const data = await request('create', { title: fields.get('title'), heroIds: fields.getAll('heroIds'), board });
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
        const data = await request(id + '/join', { seat: Number(fields.get('seat')), player: fields.get('player'), playerKey: token }, invite);
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
          if (!invite) throw error;
        }
      }
      if (invite) await openJoinLobby();
      else throw new Error('请使用房主发给你的邀请或投屏链接。');
    } catch (error) {
      say(error.message);
    }
  }

  void start();
})();
