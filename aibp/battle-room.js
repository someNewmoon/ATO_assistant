(() => {
  const root = document.getElementById('battleRoom');
  const toggle = document.getElementById('battleRoomToggle');
  const content = root.querySelector('[data-room-content]');
  const summary = root.querySelector('[data-room-summary]');
  const status = root.querySelector('[role="status"]');
  const params = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const squadLink = window.ATO_SQUAD_LINK;
  const squadId = params.get('squad');
  const routeId = params.get('battle');
  let roomLanguage;
  const hostPersonalView = params.get('personal') === '1';
  const invite = fragment.get('invite') || '';
  const quickJoin = params.get('quick') === '1';
  const viewKey = fragment.get('view') || '';
  const memberProjection = params.get('projection') === '1';
  const isLink = /^[a-f0-9]{32}$/.test(routeId || '');
  const base = new URL('../api/battle-room/', location.href);
  const campaignUrl = new URL('../api/campaign-state.php', location.href);
  const tokenKey = id => 'ato-aibp-room-' + id;
  const { escape, heroPortrait, MNEMOS, FATED_MNEMOS } = window.ATO_HERO_CATALOG;
  const { gearState, findGearSlot } = window.ATO_ROOM_CARD_STATE;
  const memoryCatalog = new Map([...Object.values(MNEMOS).flat(), ...Object.values(FATED_MNEMOS).flat()]
    .map(card => [card.card, card]));
  const statNames = { rage: '怒气', fate: '命运', danger: '凶险' };
  const titanMarkerNames = { despair: '绝望', ambrosia: '神浆' };
  const poolNames = { opening: '伺机', break: '破势', diversion: '分神', rouse: '激励', black: '破坏', fire: '火焰', hope: '希望' };
  const conditionNames = { standing: '站立', down: '倒地', rising: '起身', dead: '死亡' };
  const aiGuide = window.ATO_AI_TURN_GUIDE;
  const dice = window.ATO_ROOM_DICE;
  const { faceLabel, rollSummary } = dice;
  let id = isLink ? routeId : '';
  let credentials = null;
  let state = null;
  let lastProjectionSent = '';
  let projectionRetry;
  let hostDeckRevision = 0;
  let projectionAction;
  let turnAiAction;
  let readingState = false;
  let lobbyCampaign;
  let abilityDictionary;
  const battleConfig = window.ATO_BATTLE_CONFIG;
  let actor = null;
  let socket = null;
  let socketReady = false;
  let socketActions = false;
  let socketAction = null;
  let reconnectTimer;
  let reconnectDelay = 1000;
  const selectedDice = new Map();
  let rollMode = 'attack';
  let rollSeat = 0;
  let equipmentSeat = 0;
  let lastSecondAbility;

  let parentRoll = '';
  let armedCard = '';
  let pending = false;
  let writing = false;
  let failedAction = null;
  let actionRetry;
  let actionRetryDelay = 1500;
  const actions = [];
  const cardActionLabels = {
    'ai-request': '揭示 AI', 'ai-guide': '确认骇物步骤', 'ai-guide-discard': '弃置 AI',
    'bp-request': '揭示部位牌', 'bp-settle': '确认部位牌结果', 'turn-finish': '结束回合',
  };
  const timingKey = 'ato-battle-card-timings';
  const actionTimings = new WeakMap();
  let activeCardAction;
  let timingHistory = [];
  try {
    const stored = JSON.parse(sessionStorage.getItem(timingKey));
    if (Array.isArray(stored)) timingHistory = stored.slice(-60);
  } catch { /* Diagnostics are optional. */ }
  window.getAibpCardActionTimings = () => structuredClone(timingHistory);
  let connection = '正在连接';
  let message = '';
  const boardMount = root.querySelector('[data-room-board]');
  boardMount.id = 'room-movement';
  const roomBoard = window.BattleRoomBoard?.create(boardMount, action =>
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
    const queued = actions.find(action => actionTimings.has(action));
    const progress = activeCardAction ? '正在处理' + cardActionLabels[activeCardAction.type]
      : queued ? '等待发送' + cardActionLabels[queued.type] : '';
    const detail = activeCardAction ? progress : message || progress;
    const next = [state && connection, detail].filter(Boolean).join(' · ');
    if (status.textContent !== next) status.textContent = next;
    if (toolsDialog.open && toolsStatus.textContent !== detail) toolsStatus.textContent = detail;
    const turnStatus = turnWindow.querySelector('[data-turn-status]');
    if (turnStatus.textContent !== detail) turnStatus.textContent = detail;
  }

  function say(text) {
    message = text;
    updateStatus();
  }

  class RejectedAction extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  async function request(path, body, token = credentials?.token) {
    const url = new URL(path, base);
    if (memberProjection) url.searchParams.set('projection', '1');
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
    if (!response.ok) throw new RejectedAction(data.error || '战斗室请求失败。', response.status);
    return data;
  }

  function accept(data) {
    if (data.room.id !== id || (state && data.room.revision < state.revision)) return;
    if (state?.revision === data.room.revision && actor) return;
    const first = !actor;
    const prior = state;
    const wasFighting = prior?.squad?.phase === 'battle';
    state = data.room;
    actor = data.actor;
    if (first && actor.role === 'host') equipmentSeat = rollSeat = personalSeat() ?? 0;
    const language = state.squad?.language || state.language;
    if (language && language !== roomLanguage) { roomLanguage = language; squadLink?.language(language); }
    if (state.squad && (state.closed || state.squad.phase !== 'battle')) {
      if (actor.role === 'host' && !state.closed && state.squad.phase === 'story' && state.squad.recap
          && state.squad.recap.battleNumber === state.squad.battleNumber) {
        renderRecap();
        if (wasFighting) void window.openAibpLoot?.();
        return;
      }
      if (params.get('embed') === '1') return;
      location.replace(viewKey ? squadLink.link('/ss/', id, 'view', viewKey) : squadLink.link('/aibp/squad', id));
      return;
    }
    document.body.classList.toggle('aibp-room-only', actor.role !== 'host');
    if (actor.role === 'host' && state.board) window.setAibpRoomBattleLevel?.(state.board.apostle, state.board.level);
    roomBoard?.sync(state, actor);
    render();
    if (!first && prior && actor.role !== 'viewer') animateLatestRoll(prior);
    const second = state.secondAbility;
    const mySecond = second && second.id !== lastSecondAbility
      && (actor.role === 'player' ? actor.seat === second.seat : actor.role === 'host' && rollSeat === second.seat);
    if (mySecond && !first) {
      const target = content.querySelector('#room-kratos-pool');
      target?.scrollIntoView({ block: 'start' });
      target?.focus({ preventScroll: true });
    }
    lastSecondAbility = second?.id;
    if (actor.role === 'host' && (first || !lastProjectionSent || (state.deckRevision || 0) !== hostDeckRevision)) syncProjection();
  }

  function acceptUpdate(data) {
    if (data.room) return accept(data);
    const patch = data.roomPatch;
    if (!patch || (state && patch.revision <= state.revision)) return;
    if (!state || patch.baseRevision !== state.revision) {
      disconnectSocket?.();
      void refreshRoomState();
      return;
    }
    const room = { ...state, ...patch.room, revision: patch.revision };
    if (patch.hero) {
      const { seat, fields } = patch.hero;
      room.heroes = state.heroes.map((hero, index) => index === seat ? { ...hero, ...fields } : hero);
    }
    if (patch.roll) {
      room.rolls = state.rolls.map(roll => roll.id === patch.roll.id ? patch.roll : roll);
      if (state.squad?.lastBattleRoll?.id === patch.roll.id) {
        room.squad = { ...state.squad, lastBattleRoll: patch.roll };
      }
    }
    if (patch.activity) room.activity = [patch.activity, ...(state.activity || [])].slice(0, 80);
    accept({ room, actor });
  }

  function lostSeat() {
    if (actor?.role !== 'player' || !state?.squad || !credentials) return false;
    credentials = null;
    const url = new URL(squadLink.link('/aibp/squad', id));
    if (state.publicLobby) url.searchParams.set('quick', '1');
    squadLink.forget(id);
    location.replace(url.href);
    return true;
  }

  async function refreshRoomState() {
    if (!state || state.closed || readingState || !credentials?.token || document.hidden
        || (state.squad && state.squad.phase !== 'battle')) return;
    readingState = true;
    try { accept(await request(id + '/state')); }
    catch (error) { if (error.status === 401) lostSeat(); }
    finally { readingState = false; }
  }

  window.setInterval(() => {
    if (!socketReady || socket?.readyState !== WebSocket.OPEN) void refreshRoomState();
  }, 5000);

  let disconnectSocket;
  function connect() {
    if (!credentials?.token || socket) return;
    const url = new URL(id + '/socket?patch=2', base);
    if (memberProjection) url.searchParams.set('projection', '1');
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const current = new WebSocket(url, ['ato-battle-v1', credentials.token]);
    socket = current;
    socketActions = false;
    let unwatch;
    const connectionTimer = setTimeout(() => disconnect(), 12000);
    function disconnect(code) {
      if (socket !== current) return;
      socket = null;
      socketReady = false;
      clearTimeout(connectionTimer);
      unwatch?.();
      socketActions = false;
      if (socketAction?.socket === current) {
        clearTimeout(socketAction.timer);
        socketAction.reject(new TypeError('战斗连接已断开。'));
        socketAction = null;
      }
      if (current.readyState < WebSocket.CLOSING) current.close();
      if (code === 4001 && lostSeat()) return;
      connection = '连接已断开，正在重连';
      updateStatus();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    }
    disconnectSocket = disconnect;
    current.onmessage = event => {
      if (current !== socket) return;
      const data = JSON.parse(event.data);
      if (data.type === 'action-result') {
        if (socketAction?.id !== data.id || socketAction.socket !== current) return;
        const pending = socketAction;
        socketAction = null;
        clearTimeout(pending.timer);
        if (data.status >= 500) pending.reject(new TypeError(data.data.error || '战斗室暂时不可用。'));
        else if (!data.data.ok) pending.reject(new RejectedAction(data.data.error || '战斗室请求失败。', data.status));
        else pending.resolve(data.data);
        return;
      }
      if (data.roomPatch) { acceptUpdate(data); return; }
      if (!data.room) return;
      const reconnected = !socketReady;
      if (reconnected) {
        socketReady = true;
        clearTimeout(connectionTimer);
        reconnectDelay = 1000;
        connection = '已连接 · 自动保存';
        updateStatus();
        if (data.socketHeartbeat) unwatch = squadLink?.watchSocket?.(current, disconnect);
      }
      if (data.socketActions === true) socketActions = true;
      accept(data);
      if (reconnected) retryFailedAction();
    };
    current.onclose = event => disconnect(event.code);
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

  function playableCard({ item, type, seat, slot = 0, value, detail, src, thumb, memory, editable }) {
    const id = [type, seat, item.id, slot].join(':');
    const armed = armedCard === id;
    const discarded = value === 'discarded';
    const text = discarded ? '已弃除' : armed ? '横置并弃除' : value === 'exhausted' ? '恢复' : '横置';
    const next = armed ? 'discarded' : value === 'exhausted' ? 'ready' : 'exhausted';
    const attrs = ' data-key="' + escape(item.id) + '" data-seat="' + seat + '" data-slot="' + slot + '"';
    return '<li class="battle-room-playable" data-card-state="' + value + '" data-card-id="' + escape(id)
      + '"><div class="battle-room-card-window">' + (src ? cardImage(src, item.name, '', thumb)
        : referenceCard(item.name, item.id, memory ? '旧忆资料卡' : '装备资料卡', memory)) + '</div>'
      + '<span class="battle-room-card-name">' + escape(item.name) + '</span>'
      + (detail ? '<small>' + escape(detail) + '</small>' : '')
      + (editable && !discarded ? '<div class="battle-room-card-controls"><button type="button" data-action="' + type
        + '"' + attrs + ' data-value="' + next + '">' + text + '</button><button type="button" data-arm-card="' + escape(id)
        + '" aria-pressed="' + armed + '" aria-label="' + (armed ? '取消弃除' : '准备弃除') + escape(item.name) + '" title="'
        + (armed ? '取消弃除' : '准备弃除') + '">' + (armed ? '取消' : '弃除') + '</button></div>'
        : value !== 'ready' ? '<small class="battle-room-card-status">' + (discarded ? '已弃除' : '已横置') + '</small>' : '') + '</li>';
  }

  const traumaDecks = window.ATO_GEAR_INVENTORY.TRAUMA_DECKS;
  const traumaDialog = document.createElement('dialog');
  traumaDialog.className = 'room-trauma-dialog';
  root.appendChild(traumaDialog);

  const toolNames = { rolls: '战斗掷骰记录', argo: '阿尔戈能力' };
  const dock = document.createElement('div');
  dock.className = 'room-tool-dock';
  dock.hidden = true;
  const toolLinks = document.createElement('div');
  toolLinks.className = 'room-secondary-nav';
  const toolsDialog = document.createElement('dialog');
  toolsDialog.className = 'room-tool-sheet';
  toolsDialog.id = 'room-tool-sheet';
  toolsDialog.setAttribute('aria-labelledby', 'room-tool-title');
  toolsDialog.innerHTML = '<header><h3 id="room-tool-title"></h3><button type="button" data-close-tools>收起</button></header>'
    + '<div data-tools-body></div><p data-tools-status role="status"></p>';
  const toolsBody = toolsDialog.querySelector('[data-tools-body]');
  const toolsStatus = toolsDialog.querySelector('[data-tools-status]');
  let activeTool;
  let toolsMarkup;
  for (const [key, label] of Object.entries(toolNames)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.tool = key;
    button.setAttribute('aria-controls', toolsDialog.id);
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => {
      activeTool = key;
      toolsDialog.querySelector('h3').innerHTML = escape(label);
      toolsStatus.textContent = '';
      renderTools();
      toolsDialog.showModal();
    });
    toolLinks.append(button);
  }
  const bossShortcut = document.createElement('a');
  bossShortcut.className = 'room-turn-boss-link';
  bossShortcut.href = '#room-apostle';
  bossShortcut.textContent = '骇物';
  const quick = document.createElement('nav');
  quick.className = 'room-primary-nav';
  quick.setAttribute('aria-label', '常用操作');
  quick.innerHTML = '<a href="#room-movement">移动</a><a href="#room-dice">掷骰</a><a href="#room-status">状态</a><a href="#room-equipment">装备</a>'
    + '<a href="#room-apostle">骇物</a>';
  toolLinks.insertAdjacentHTML('beforeend', '<a href="#room-trauma">创伤牌库</a>');
  root.addEventListener('click', event => {
    const link = event.target.closest('a[href="#room-apostle"], a[href="#room-trauma"]');
    if (!link) return;
    const panel = root.querySelector(link.hash);
    if (!panel) return;
    panel.open = true;
    turnWindow.open = false;
  });
  const movementShortcut = quick.querySelector('a[href="#room-movement"]');
  function forcedMovementSeat() {
    const seat = personalSeat();
    return state.turn?.phase === 'apostle' && !state.closed && Number.isInteger(seat)
      && state.heroes[seat]?.condition !== 'dead' ? seat : null;
  }
  movementShortcut.addEventListener('click', event => {
    const seat = forcedMovementSeat();
    if (seat !== null && roomBoard?.openForcedMovement(seat)) event.preventDefault();
  });
  dock.append(quick, toolLinks);
  toolsDialog.querySelector('[data-close-tools]').addEventListener('click', () => toolsDialog.close());
  toolsDialog.addEventListener('close', () => {
    activeTool = null;
    toolsMarkup = null;
    toolsBody.replaceChildren();
  });
  root.append(dock, toolsDialog);

  function personalSeat() {
    return actor.role === 'host' ? state.squad?.hostSeat : actor.seat;
  }

  const turnWindow = document.createElement('details');
  turnWindow.className = 'room-turn-window';
  turnWindow.innerHTML = '<summary aria-live="polite"></summary><div data-turn-body></div><small data-turn-status role="status"></small>';
  const turnBar = document.createElement('div');
  turnBar.className = 'room-turn-bar';
  turnBar.hidden = true;
  turnBar.append(turnWindow, bossShortcut);
  root.append(turnBar);
  let turnHeading = '';
  let turnMarkup = '';
  let promptedAiRound = '';
  let aiRange = 1;
  let aiRouteId = '';
  let aiPlanKey = '';
  turnWindow.addEventListener('change', event => {
    if (event.target.matches('[data-ai-range]')) {
      aiRange = Math.max(1, Math.min(20, Math.floor(Number(event.target.value) || 1)));
      aiRouteId = '';
    } else if (event.target.matches('[data-ai-route]')) {
      aiRouteId = event.target.value;
    } else return;
    renderTurn();
  });
  turnWindow.addEventListener('click', event => {
    const button = event.target.closest('[data-turn-action]');
    if (!button || !state || state.closed) return;
    const { turnAction: type, seat, value } = button.dataset;
    const selection = button.dataset.aiTarget || '';
    if (type === 'ai-guide' && ['target', 'hope-target'].includes(value) && !selection) {
      say('请选择本次目标，或选择按牌面处理。');
      return;
    }
    if (type === 'ai-face') {
      send({ id: crypto.randomUUID(), type: 'board-face', facing: Number(value) });
      return;
    }
    if (type === 'ai-guide-discard') {
      send({ id: crypto.randomUUID(), type, card: state.projection?.ai?.src });
      return;
    }
    if (type === 'draw-ai') {
      if (turnAiAction || state.projection?.aiPending) return;
      const apostle = state.board?.apostle;
      if (!state.deckRevision || ['DEMIDJINN', 'TITAN_X'].includes(apostle)) {
        if (projectionAction) { say('牌堆正在同步，请稍后再揭示 AI。'); return; }
        const result = window.drawAibpRoomCard?.('AI', apostle, { preview: !state.turn?.aiGuide });
        if (!result) { say('请在 AIBP 检查当前骇物和 AI 牌堆。'); return; }
        syncProjection();
        say('');
        return;
      }
      syncProjection();
      turnAiAction = crypto.randomUUID();
      renderTurn();
      say('正在揭示 AI…');
      send({ id: turnAiAction, type: 'ai-request' });
      return;
    }
    send({ id: crypto.randomUUID(), type, round: state.round, phase: state.turn?.phase ?? null,
      ...(seat !== undefined && { seat: Number(seat) }), ...(value && { value }),
      ...(selection && { target: selection === 'manual' ? null : Number(selection) }) });
  });

  function aiRouteOptions() {
    const board = state.board;
    const pieces = board?.map?.pieces;
    const target = pieces?.titans?.[state.turn?.aiTarget];
    const profile = window.BattleTerrain?.getApostleProfile(board?.apostle, board?.level);
    if (!target || !pieces.apostle || !profile || state.heroes[state.turn.aiTarget]?.condition === 'dead') return [];
    const modifier = (state.projection?.tokens || []).reduce((value, token) =>
      value + (token.file === 'SP+.png' ? token.count : token.file === 'SP-.png' ? -token.count : 0), 0);
    const limit = profile.speed === Infinity ? Infinity : Math.max(0, (Number(profile.speed) || 0) + modifier);
    const remaining = board.apostleMovement?.remaining;
    const speed = remaining == null ? limit : Math.min(limit, remaining);
    const paths = window.BattleLOS?.computeApostleMovePaths({
      sourceAnchor: pieces.apostle, targetAnchor: target, size: profile.size, speed, reach: aiRange, facing: pieces.apostle.facing,
    });
    return window.BattleLOS.rankApostleRoutes(paths?.rules || [],
      pieces.titans.flatMap((piece, seat) => piece && state.heroes[seat]?.condition !== 'dead' ? [{ ...piece, seat }] : []));
  }

  function renderAiTargetChoice(step) {
    const button = (target, label, portrait = '') => '<button type="button" data-turn-action="ai-guide" data-value="' + step
      + '" data-ai-target="' + target + '">' + portrait + escape(label) + '</button>';
    return '<div class="room-ai-targets" role="group" aria-label="选择本次目标">'
      + state.heroes.map((hero, seat) => hero.condition === 'dead' ? '' : button(String(seat), hero.name, rollAvatar(seat))).join('')
      + button('manual', '无单一目标／按牌面') + '</div>';
  }

  function renderTurn() {
    turnBar.hidden = state.closed;
    if (state.closed) return;
    const turn = state.turn;
    const activeSeat = turn?.seat;
    const titans = turn?.phase === 'titans';
    const host = actor.role === 'host';
    const aiRound = (state.squad?.battleNumber || 0) + ':' + state.round;
    const guideAvailable = turn?.phase === 'apostle' && aiGuide.bosses.includes(state.board?.apostle);
    const step = guideAvailable && aiGuide.stepFor(turn.aiGuide);
    const shouldDrawAi = host && turn?.phase === 'apostle' && !state.projection?.aiPending
      && Boolean(window.drawAibpRoomCard || (guideAvailable && state.deckRevision));
    if (host && (guideAvailable || shouldDrawAi) && promptedAiRound !== aiRound) {
      promptedAiRound = aiRound;
      turnWindow.open = true;
    }
    const everyoneFinished = titans && state.heroes.every((hero, seat) => hero.condition === 'dead' || turn.finished.includes(seat));
    const label = !turn ? '等待房主设置轮次' : !titans ? '骇物轮次'
      : activeSeat !== null ? '泰坦轮次 · ' + state.heroes[activeSeat].name
        : everyoneFinished ? '泰坦轮次 · 全员已结束' : '泰坦轮次 · 等待认领';
    const heading = '第 ' + state.round + ' 轮 · ' + label;
    if (turnHeading !== heading) {
      turnHeading = heading;
      turnWindow.querySelector('summary').textContent = heading;
    }
    const action = (type, text, attr = '') => '<button type="button" data-turn-action="' + type + '"' + attr + '>' + text + '</button>';
    const roster = state.heroes.map((hero, seat) => {
      const dead = hero.condition === 'dead';
      const acted = turn?.finished.includes(seat);
      const current = activeSeat === seat;
      const editable = host || (actor.role === 'player' && actor.seat === seat);
      const actions = titans && editable && !dead && !acted ? current
        ? action('turn-finish', '结束回合', ' data-seat="' + seat + '"')
        : activeSeat === null ? action('turn-take', '认领回合', ' data-seat="' + seat + '"') : '' : '';
      return '<li' + (current ? ' aria-current="true"' : '') + '>' + rollAvatar(seat)
        + '<span>' + escape(hero.name) + '<small>' + (dead ? '死亡' : current ? '行动中' : acted ? '已结束' : '待行动')
        + '</small></span>' + actions + '</li>';
    }).join('');
    const drawAi = () => action('draw-ai', '抽取 AI', turnAiAction || !shouldDrawAi ? ' disabled' : '');
    const guideAction = (value, label) => action('ai-guide', label, ' data-value="' + value + '"');
    let controls = '';
    let guidance = '';
    const planKey = [state.squad?.battleNumber, state.round, step, turn?.aiTarget].join(':');
    if (aiPlanKey !== planKey) {
      aiPlanKey = planKey;
      aiRange = 1;
      aiRouteId = '';
    }
    let route;
    if (guideAvailable) {
      if (!step && host) controls = guideAction('begin', '开始逐步结算');
      if (step) {
        const [title, detail] = aiGuide.steps[step];
        const projection = state.projection;
        const signature = step.startsWith('hope-');
        const current = signature ? { src: projection?.signature, label: '招牌技' } : projection?.ai;
        const targeting = step === 'target' || step === 'hope-target';
        const resolving = step === 'resolve' || step === 'hope-resolve';
        guidance = '<div class="room-ai-guide"><strong>' + title + '</strong><p>' + detail + '</p>'
          + ((targeting || resolving) && current?.src ? cardImage('/aibp/' + current.src, current.label || '当前 AI') : '');
        if (targeting && host) guidance += renderAiTargetChoice(step);
        if (resolving && Number.isInteger(turn.aiTarget)) {
          guidance += '<p>本次目标：<b>' + escape(state.heroes[turn.aiTarget]?.name || '') + '</b></p>';
          const routes = aiRouteOptions();
          route = routes.find(path => path.id === aiRouteId) || routes[0];
          if (host && routes.length) {
            guidance += '<label>按牌面填写攻击范围 <input data-ai-range type="number" min="1" max="20" value="' + aiRange + '"></label>'
              + '<label>路线 <select data-ai-route>' + routes.map((path, i) => '<option value="' + path.id + '"'
                + (route === path ? ' selected' : '') + '>' + (i ? '' : '推荐 · ') + path.label + ' · ' + path.steps
                + ' 步 · ' + (path.collisions ? '可能冲撞 ' + path.collisions + ' 位泰坦' : '避开泰坦') + '</option>').join('')
              + '</select></label><small>版图虚线与半透明模型标出建议落点。按牌面核对移动、视线和转向例外。</small>';
            const headings = { 0: '上', 90: '右', 180: '下', 270: '左' };
            if (Object.hasOwn(headings, route.facing)) {
              const begin = route.firstFacing;
              const currentFacing = route.steps ? begin : route.facing;
              guidance += '<p>' + (route.steps && begin != null ? '移动前朝' + headings[begin] + ' · ' : '')
                + '落点／攻击前朝' + headings[route.facing] + '</p>'
                + (Number.isInteger(currentFacing)
                  ? action('ai-face', route.steps ? '转到起步朝向' : '转向目标', ' data-value="' + currentFacing + '"')
                  : '');
            }
          }
        }
        const hope = projection?.hopeEnds;
        if (step === 'other' && hope) guidance += '<p>希望终结生效，处理完其他行动后执行招牌技。</p>';
        guidance += '</div>';
        if (host) {
          if (step === 'start' || step === 'draw') {
            if (projection?.aiPending) controls = guideAction('start', '确认已揭示');
            else controls = action('draw-ai', step === 'start' ? '开始效果已处理，抽取 AI' : '抽取 AI',
              turnAiAction || !shouldDrawAi ? ' disabled' : '');
            if (!shouldDrawAi && !projection?.aiPending) guidance += '<p>请先由房主在 AIBP 同步牌堆。</p>';
          } else if (step === 'resolve') {
            if (projection?.aiPending && state.deckRevision && current?.src) {
              controls = action('ai-guide-discard', '结算完毕，弃置 AI');
            } else if (!projection?.aiPending) controls = guideAction('resolve', '牌面已处理');
          } else if (step === 'hope-resolve') controls = guideAction(step, '招牌技已结算');
          else if (!targeting) {
            if (step === 'other') controls = guideAction('extra', '结算额外 AI');
            if (step === 'other' && hope) controls += guideAction('hope', '希望终结 · 执行招牌技');
            else controls += action('turn-phase', '结束骇物轮次', ' data-value="titans"');
          }
        }
      }
    } else if (host) {
      controls = !turn ? action('turn-phase', '进入骇物轮次', ' data-value="apostle"')
        + action('turn-phase', '进入泰坦轮次', ' data-value="titans"')
      : !titans ? (shouldDrawAi ? drawAi() : '') + action('turn-phase', '结束骇物轮次', ' data-value="titans"')
        : action('round', '下一轮 · 骇物行动',
          ' title="开始下一轮，回正阿尔戈能力"' + (everyoneFinished ? '' : ' disabled'));
    }
    const hint = !turn ? '' : !titans ? '<p>泰坦仍可结算闪避、击退和推斥。</p>'
      : everyoneFinished ? '<p>结算本轮结束效果后，由房主开启下一轮。</p>'
        : activeSeat === null ? '<p>首次主动移动或投掷攻击／威力骰会认领回合。</p>' : '';
    const actions = controls ? '<div class="room-turn-controls">' + controls + '</div>' : '';
    roomBoard?.setAiRoute(route);
    const next = guidance + actions + (step ? '' : '<ul>' + roster + '</ul>') + hint;
    if (turnMarkup !== next) {
      turnMarkup = next;
      turnWindow.querySelector('[data-turn-body]').innerHTML = next;
    }
  }

  function renderTools() {
    const personal = actor.role !== 'viewer' && !state.closed;
    const seat = personalSeat();
    root.classList.toggle('battle-room-personal', personal);
    dock.hidden = !personal;
    if (!personal && toolsDialog.open) toolsDialog.close();
    movementShortcut.hidden = !state.board;
    bossShortcut.hidden = !state.board;
    quick.querySelector('a[href="#room-apostle"]').hidden = !state.board;
    const forced = forcedMovementSeat() !== null;
    if (forced !== (movementShortcut.dataset.forced === 'true')) {
      movementShortcut.dataset.forced = String(forced);
      movementShortcut.textContent = forced ? '非主动移动' : '移动';
    }
    for (const href of ['#room-equipment', '#room-status']) {
      quick.querySelector('a[href="' + href + '"]').hidden = !state.heroes[actor.role === 'host' ? equipmentSeat : seat];
    }
    if (!personal || !activeTool) return;
    const markup = {
      rolls: latestHeroRolls,
      argo: () => argoAbilities() || '<p>本场尚未准备阿尔戈能力。</p>',
    }[activeTool]();
    if (markup !== toolsMarkup) {
      const focused = toolsBody.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focused?.dataset.action || focused?.dataset.traumaDialog;
      toolsBody.innerHTML = markup;
      toolsMarkup = markup;
      if (focusKey) [...toolsBody.querySelectorAll('button:not(:disabled)')].find(button =>
        (button.dataset.action || button.dataset.traumaDialog) === focusKey
        && button.dataset.key === focused.dataset.key && button.dataset.seat === focused.dataset.seat
        && button.dataset.draw === focused.dataset.draw && button.dataset.rollId === focused.dataset.rollId
        && (focusKey === 'roll-reaction' ? button.getAttribute('aria-label') === focused.getAttribute('aria-label')
          : button.dataset.value === focused.dataset.value))?.focus({ preventScroll: true });
    }
  }

  function traumaOptions(auto = false) {
    return (auto ? '<option value="auto">按泰坦创伤表</option>' : '')
      + Object.entries(traumaDecks).map(([key, name]) => '<option value="' + key + '">' + name + '</option>').join('');
  }

  function traumaCardList(seat, editable) {
    return (state.trauma?.drawn || []).filter(item => item.seat === seat).map(item => {
      const { card } = item;
      const data = ' data-seat="' + seat + '" data-draw="' + escape(item.id) + '"';
      const act = (operation, label) => '<button type="button" data-action="trauma-resolve" data-value="' + operation + '"' + data + '>' + label + '</button>';
      const shuffle = card.deck === 'obol' || card.return?.startsWith('shuffle');
      return '<li>' + (card.art ? cardImage('../aibp/images/trauma/' + card.art, card.name) : '<p>' + escape(card.note) + '</p>')
        + '<strong>' + escape(card.name) + '</strong><small>' + traumaDecks[card.deck] + ' · 凶险 ' + item.danger
        + (item.kept ? ' · 持续' : ' · 待结算') + '</small>'
        + (editable ? '<div class="room-trauma-actions">' + (!item.kept ? act('keep', '保留') : '')
          + (card.return === 'temporary' ? act('bottom', '移除临时牌') : shuffle ? act('shuffle', '结算并洗回')
            : act('bottom', '结算并放回牌底') + act('shuffle', '按卡文洗回')) + '</div>' : '') + '</li>';
    }).join('');
  }

  function traumaControls(hero, seat, editable) {
    if (!state.trauma) return '';
    const canDraw = editable && hero.condition !== 'dead';
    const button = (mode, label) => '<button type="button" data-trauma-dialog="' + mode + '" data-seat="' + seat + '">' + label + '</button>';
    const cards = traumaCardList(seat, editable);
    const track = state.trauma.tracks[seat];
    const level = track && window.ATO_GEAR_INVENTORY.traumaDeckLabel(track[hero.stats.danger - 1]);
    return '<section class="room-trauma-hero"><div class="room-trauma-actions">'
      + (canDraw ? button('hit', '结算受击') + button('draw', '抽创伤') + button('gain', '获得凶险') : '')
      + '</div>' + (canDraw && !track ? '<small>当前泰坦缺少创伤表。可在泰坦管理配置，或按卡文指定牌库。</small>'
        : level ? '<small>当前凶险对应 · ' + escape(level) + '</small>' : '')
      + (cards ? '<ul class="room-trauma-cards">' + cards + '</ul>' : '') + '</section>';
  }

  function roomTrauma() {
    if (!state.trauma) return actor.role === 'host' && !state.closed
      ? '<button type="button" data-trauma-dialog="setup">准备创伤牌库</button>' : '';
    const { cycle, tutorial, counts, latest: recent } = state.trauma;
    const latest = recent ? '<details class="room-trauma-latest"' + (root.querySelector('.room-trauma-latest')?.dataset.draw !== recent.id || root.querySelector('.room-trauma-latest')?.open ? ' open' : '')
      + ' data-draw="' + escape(recent.id) + '"'
      + '><summary>最近揭示 · ' + escape(state.heroes[recent.seat].name) + ' · ' + escape(recent.card.name) + '</summary>'
      + (recent.card.art ? cardImage('../aibp/images/trauma/' + recent.card.art, recent.card.name) : '<p>' + escape(recent.card.note) + '</p>')
      + '</details>' : '';
    return '<section class="room-trauma-summary"><h3>创伤牌库</h3><small>故事集 ' + escape(cycle.slice(1)) + (tutorial ? ' · 教程' : '')
      + ' · ' + Object.entries(counts).map(([deck, count]) => traumaDecks[deck] + ' ' + count).join(' · ') + '</small>'
      + (actor.role === 'host' && !state.closed ? '<button type="button" data-trauma-dialog="manage">调整本场牌库</button> <a href="/aibp/trauma" target="_blank" rel="noopener">存档牌库</a>' : '') + latest + '</section>';
  }

  function openTraumaDialog(mode, seat) {
    const title = { setup: '准备创伤牌库', manage: '调整本场创伤牌库', hit: '结算受击', draw: '抽创伤', gain: '获得凶险' }[mode];
    const name = state.heroes[seat]?.name;
    let fields = '';
    if (mode === 'setup') {
      fields = '<label>故事集 <select name="cycle" required><option value="">请选择</option>'
        + [1,2,3,4,5].map(n => '<option value="c' + n + '">' + n + '</option>').join('')
        + '</select></label><label><input type="checkbox" name="tutorial"> 教程战</label>';
    } else if (mode === 'manage') {
      const catalog = state.trauma.catalog;
      const options = catalog.filter(card => !card.held).map(card =>
        '<option value="' + escape(card.id) + '">' + escape(card.name) + (catalog.filter(item => item.name === card.name).length > 1 ? ' [' + escape(card.id.split('_').pop().toUpperCase()) + ']' : '') + ' · ' + traumaDecks[card.deck] + (card.inPlay ? ' · 已加入' : ' · 未加入') + '</option>').join('');
      fields = '<p>本场调整随战斗结束清除。长期变更请到存档牌库设置。</p><p>按科技或事件指示操作。觉醒版和哈迪斯版会替换原牌；哈迪斯版仍在凶险达到 21 时入库。</p>'
        + '<button type="submit" name="awakening" value="1" formnovalidate>应用觉醒牌库变化（加入觉醒并替换你已死亡）</button>'
        + '<label>卡牌 <select name="card" required>' + options + '</select></label>'
        + '<label>操作 <select name="operation"><option value="add">加入或替换</option><option value="remove">移出牌库</option></select></label>';
    } else if (mode === 'draw') {
      fields = '<label>牌库 <select name="deck">' + traumaOptions(true) + '</select></label><small>当前凶险 ' + state.heroes[seat].stats.danger + '</small>';
    } else {
      fields = '<label>' + (mode === 'hit' ? '护甲减免后的净凶险' : '增加的凶险') + ' <input name="amount" type="number" min="0" max="99" required></label>'
        + (mode === 'gain' ? '<small>非攻击来源，只有超过 9 才触发抽取。</small>'
          : '<label>牌库 <select name="deck">' + traumaOptions(true) + '</select></label><small>超过 9 时按生死关头结算。</small>');
    }
    traumaDialog.innerHTML = '<form><h3>' + title + (name ? ' · ' + escape(name) : '') + '</h3>' + fields
      + '<div class="room-trauma-actions"><button type="button" data-trauma-cancel>取消</button><button type="submit">确认</button></div></form>';
    traumaDialog.querySelector('[data-trauma-cancel]').onclick = () => traumaDialog.close();
    traumaDialog.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const action = { id: crypto.randomUUID(), seat };
      if (mode === 'setup') Object.assign(action, { type: 'trauma-setup', cycle: fields.get('cycle'), tutorial: fields.has('tutorial') });
      else if (mode === 'manage') Object.assign(action, event.submitter?.name === 'awakening' ? { type: 'trauma-awakening' }
        : { type: 'trauma-deck', card: fields.get('card'), operation: fields.get('operation') });
      else Object.assign(action, { type: 'trauma-draw', mode, deck: fields.get('deck') || 'auto', amount: Number(fields.get('amount')) });
      traumaDialog.close();
      send(action);
    };
    traumaDialog.showModal();
    window.ATO_LANGUAGE?.refresh();
  }

  function heroCard(hero, seat) {
    const own = seat === (actor.role === 'host' ? equipmentSeat : personalSeat());
    const editable = !state.closed && (actor.role === 'host' || (actor.role === 'player' && actor.seat === seat));
    const art = window.ATO_BATTLE_ASSETS;
    const titan = hero.titan ? escape(window.ATO_GEAR_INVENTORY.titanLabel(hero.titan)) : '未分配泰坦';
    const titanArt = hero.titan && art?.titanArt(hero.titan);
    const inventory = window.ATO_GEAR_INVENTORY;
    const patterns = inventory.TITAN_PATTERNS.filter(pattern => hero.titan?.patternIds?.includes(pattern.id));
    const patternCards = patterns.map(item => playableCard({ item, type: 'pattern-card', seat,
      value: hero.patternCards?.[item.id] || 'ready', src: '../' + item.art, editable })).join('');
    const titanImage = titanArt ? cardImage(titanArt.src, titanArt.name, 'battle-room-titan-art', art.thumbSrc(titanArt.name)) : '';
    const portrait = heroPortrait(hero);
    const avatar = portrait ? '<img class="battle-room-avatar" src="../hero/assets/' + portrait + '" alt="">' : '';
    const gearCards = item => Array.from({ length: Math.min(item.count, 48) }, (_, slot) => playableCard({
      item, type: 'gear-card', seat, slot, value: gearState(item, slot),
      src: art?.gearSrc(item.id, roomLanguage), thumb: art?.gearThumbSrc(item.id, roomLanguage), editable, detail: item.count > 1 ? String(slot + 1) + '/' + item.count : '',
    })).join('') + (item.count > 48 ? '<li>' + escape(item.name) + ' 另有 ' + (item.count - 48) + ' 件</li>' : '');
    const gear = inventory.groupGear(hero.gear, item => item.category).map(group => '<div class="room-card-group"><h5>'
      + group.label + '</h5><ul class="battle-room-card-list">' + group.items.map(gearCards).join('') + '</ul></div>').join('');
    const mnemos = hero.mnemos.map(item => playableCard({
      item, type: 'mnemos-card', seat, value: item.state || 'ready', src: art?.mnemosSrc(item.id), thumb: art?.thumbSrc(item.id),
      memory: memoryCatalog.get(item.id), editable, detail: item.fated ? '命业旧忆' : item.progress + '/' + item.limit,
    })).join('');
    const stats = Object.entries(statNames).map(([key, label]) => '<div>'
      + marker('../hero/assets/tri_' + key + '.png', label)
      + buttons('stat', key, hero.stats[key], seat, label, 30, editable) + '</div>').join('');
    const markers = Object.entries(titanMarkerNames).map(([key, label]) => '<div data-titan-marker="' + key + '">'
      + '<span class="room-titan-marker-name">' + label + '</span>'
      + buttons('titan-marker', key, hero.markers?.[key] ?? 0, seat, label, 99, editable) + '</div>').join('');
    const condition = editable ? '<select data-condition="' + seat + '" aria-label="' + escape(hero.name) + '的泰坦状态">'
      + Object.entries(conditionNames).map(([key, label]) => '<option value="' + key + '"' + (key === hero.condition ? ' selected' : '') + '>' + label + '</option>').join('')
      + '</select>' : '<small>' + conditionNames[hero.condition] + '</small>';
    const last = state.rolls.find(roll => roll.seat === seat);
    const summary = last && (!own || !editable) ? '<p class="battle-room-result" data-dice-summary="' + escape(last.id) + '">最近一次掷骰 · ' + rollSummary(last) + '</p>' : '';
    const hasExhausted = hero.gear.some(item => findGearSlot(item, 'exhausted') >= 0)
      || hero.mnemos.some(card => card.state === 'exhausted') || Object.values(hero.patternCards || {}).includes('exhausted');
    const readyGear = editable && (hero.gear.length || hero.mnemos.length || patterns.length)
      ? '<button type="button" data-action="gear-ready-all" data-seat="' + seat
        + '"' + (hasExhausted ? '' : ' disabled') + '>一键回正</button>' : '';
    const deck = (name, cards) => cards ? '<section class="room-card-group"><h4>' + name + '</h4>'
      + '<ul class="battle-room-card-list">' + cards + '</ul></section>' : '';
    return '<article class="battle-room-hero" data-hero-seat="' + seat + '"><header><div class="battle-room-identity">'
      + avatar + '<div><h3>' + escape(hero.name) + '</h3><small>' + escape(hero.player || '待认领') + '</small></div></div>'
      + titanImage + '<div class="battle-room-titan-status"><span>' + titan + '</span>' + condition + '</div></header>'
      + '<section class="room-hero-status"' + (own ? ' id="room-status"' : '') + '><h4>状态</h4>'
      + '<div class="battle-room-stats" role="group" aria-label="三曲盘">' + stats + '</div>'
      + '<div class="battle-room-stats room-titan-markers" role="group" aria-label="泰坦状态标记">' + markers + '</div>'
      + traumaControls(hero, seat, editable) + '</section>'
      + '<section class="room-card-groups"' + (own ? ' id="room-equipment"' : '') + '><div class="room-equipment-head"><h4>战斗卡牌</h4>'
      + readyGear + '</div>' + deck('旧忆', mnemos) + deck('样式卡牌', patternCards)
      + '<section class="room-card-group"><h4>装备</h4>' + (gear || '<p>未分配装备</p>') + '</section></section>'
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

  function faceArt(die) {
    return dice.faceMarkup(die, '../aibp/room-dice-art/');
  }

  function animateLatestRoll(prior) {
    const latest = state.rolls.find(roll => roll.id === state.lastBattleRollId);
    if (!latest) return;
    const previous = prior.rolls.find(roll => roll.id === latest.id);
    const rerolled = die => die.rerolled && previous?.dice.some(old => old.id === die.id && !old.rerolled);
    const changed = new Set(latest.dice.filter(die => !previous || rerolled(die)).map(die => die.id));
    if (!changed.size) return;
    const id = CSS.escape(latest.id);
    const cards = [...root.querySelectorAll('.room-roll[data-motion-roll="' + id + '"]')];
    const card = cards.find(node => toolsDialog.open && toolsBody.contains(node) && node.getClientRects().length)
      || cards.find(node => node.getClientRects().length);
    if (!card) return;
    const faces = Array.from(card.querySelectorAll('[data-motion-die]'))
      .filter(die => changed.has(die.dataset.motionDie)).map(die => die.querySelector('.room-die-face'));
    const summaries = root.querySelectorAll('[data-dice-summary="' + id + '"]');
    const activity = state.activity?.[0];
    const activityDetail = activity && ['roll', 'reroll'].includes(activity.kind)
      && activity.id !== prior.activity?.[0]?.id
      ? content.querySelector('[data-dice-activity="' + CSS.escape(activity.id) + '"]') : null;
    void window.ATO_DICE_MOTION?.play(faces.filter(Boolean), [
      ...cards.filter(node => node !== card), ...card.querySelectorAll('[data-dice-reveal]'), ...summaries, activityDetail,
    ]);
  }

  function rollAvatar(seat) {
    const path = heroPortrait(state.heroes[seat]);
    return path ? '<img class="roll-hero-avatar" src="../hero/assets/' + escape(path) + '" alt="">' : '';
  }

  function heroSeatButtons(seat, purpose) {
    const label = purpose === 'roll' ? '选择掷骰英雄' : '选择英雄装备';
    return '<div class="room-seat-tabs" role="group" aria-label="' + label + '">'
      + state.heroes.map((hero, index) => '<button type="button" data-' + purpose + '-seat="' + index + '" aria-pressed="'
        + (index === seat) + '">' + rollAvatar(index) + escape(hero.name) + '</button>').join('') + '</div>';
  }

  function reactions(roll, latest) {
    const by = actor.role === 'host' ? 'host' : 'seat:' + actor.seat;
    const editable = roll.id && actor.role !== 'viewer' && !state.closed && dice.rollOwner(roll, state.squad?.hostSeat) !== by;
    return '<div class="room-roll-reactions">' + dice.reactionGroups(roll, state.heroes, state.squad?.hostSeat)
      .map(({ value, icon, label, people }) => {
        if (!editable && !people.length) return '';
        const own = roll.reactions?.[by] === value;
        const voters = latest ? people.map(({ hero, name }) => {
          const picture = heroPortrait(hero);
          return '<span class="room-reaction-voter" title="' + escape(name) + '" aria-label="' + escape(name) + '">'
            + (picture ? '<img src="../hero/assets/' + escape(picture) + '" alt="">' : escape([...name][0] || ''))
            + '</span>';
        }).join('') : '';
        const labelText = icon + ' ' + people.length;
        const control = editable ? '<button type="button" data-action="roll-reaction" data-roll-id="' + escape(roll.id)
          + '" data-value="' + (own ? 'clear' : value) + '" aria-label="' + label + '" aria-pressed="' + own + '">' + labelText + '</button>'
          : '<span aria-label="' + label + '">' + labelText + '</span>';
        return '<span class="room-reaction-group">' + control + voters + '</span>';
      }).join('') + '</div>';
  }

  function teamActivity() {
    const recent = (state.activity || []).slice(0, 20);
    if (actor.role === 'viewer' || !recent.length) return '';
    return '<section class="battle-room-rolls room-team-activity"><h3>队友操作</h3><ol>'
      + recent.map(entry => '<li>' + (entry.seat === null ? '' : rollAvatar(entry.seat))
        + '<span><strong>' + escape(entry.by || '队友') + '</strong> · ' + escape(entry.label)
        + (entry.detail ? '<span data-dice-activity="' + escape(entry.id) + '"> · ' + escape(entry.detail) + '</span>' : '') + '</span></li>').join('') + '</ol></section>';
  }

  function rollCard(roll, latest, quickFeedback = false) {
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
      const critical = dice.criticalLabel(roll.mode, die);
      return '<div class="room-die" data-motion-die="' + escape(die.id) + '"><small>' + dice.names[die.kind] + '</small>'
        + (canSelect ? '<button type="button" data-select-die' + dieAttrs + ' aria-pressed="' + Boolean(selection?.has(die.id))
          + '" aria-label="选中' + dice.names[die.kind] + '重掷">' + art + '</button>' : art)
        + '<span data-dice-reveal>' + (result ? result.map((n, i) => n + ['ϟ', '△', '●'][i]).join(' ') : die.value) + '</span>'
        + (critical ? '<strong class="room-critical-result" data-dice-reveal>' + critical + '</strong>' : '')
        + (die.rerolled ? '<small data-dice-reveal>已重掷 · 原掷 ' + escape(originalLabel) + '</small>' : '')
        + (editable && result ? '<div class="room-die-conversions" data-dice-reveal>'
          + (result[1] ? '<button type="button" data-action="convert" data-symbol="potential"' + dieAttrs + ' title="将一枚潜力转为威力">△ → ϟ</button>' : '')
          + (result[2] ? '<button type="button" data-action="convert" data-symbol="dot"' + dieAttrs + ' title="将一枚●转为威力">● → ϟ</button>' : '') + '</div>' : '')
        + '</div>';
    }).join('');
    const followup = roll.defenseCount && !roll.defenseRoll;
    const wounds = roll.wounds ?? 0;
    const pendingBp = state.projection?.bpPending && state.projection.bp?.src;
    const pendingPower = dice.pendingPowerRoll(state, roll.seat);
    const showBp = state.deckRevision && editable && pendingPower?.id === roll.id
      && (pendingBp ? canSettleBp(roll.seat) : canRequestBp(roll.seat));
    const outcome = ['失败', '伤口', '暴击'];
    const result = roll.mode === 'power' ? '<div class="room-wound-result" data-dice-reveal>'
      + '<span>击破结果 · ' + (roll.bpOutcome === undefined ? dice.woundResults[wounds] : outcome[roll.bpOutcome])
      + (roll.wounds === undefined ? '（待确认）' : '') + '</span>'
      + (showBp ? '<div class="room-bp-actions">'
        + (pendingBp ? cardImage('/aibp/' + pendingBp, state.projection.bp.label || '部位牌') + bpOutcomeButtons(roll)
          : bpDrawButton(roll.seat))
        + '</div>' : '')
      + (editable && !state.projection && !pendingBp ? '<div role="group" aria-label="记录伤口">' + dice.woundResults.map((label, value) =>
          '<button type="button" data-action="roll-wounds" data-value="' + value + '"' + attrs
          + ' aria-pressed="' + (roll.wounds === value) + '">' + label + '</button>').join('') + '</div>' : '')
      + '</div>' : '';
    const feedback = reactions(roll, latest);
    const heading = '<h4>' + rollAvatar(roll.seat) + escape(roll.hero) + (mode ? ' · ' + mode : '')
      + ' <small>第 ' + roll.round + ' 轮</small></h4>';
    return '<li class="room-roll" data-motion-roll="' + escape(roll.id) + '">' + (quickFeedback ? '<div class="room-roll-head">' + heading + feedback + '</div>' : heading)
      + '<div class="room-dice-results">' + faces + '</div><p data-dice-reveal>' + rollSummary(roll) + '</p>'
      + (followup ? '<p class="room-dice-help">已配置 ' + roll.defenseCount + ' 枚防御红骰，请按闪避结果确认是否投掷。</p>' : '')
      + (editable && (roll.mode === 'attack' || followup) ? '<button type="button" data-dice-reveal data-roll-followup="'
        + (followup ? 'defense' : 'power') + '"' + attrs + '>' + (followup ? '准备投掷防御红骰' : '命中后准备投掷威力骰') + '</button>' : '')
      + (editable && roll.dice.some(dice.canReroll) ? '<div class="room-reroll-controls" data-dice-reveal><button type="button" data-action="reroll"' + attrs
        + (selection?.size ? '' : ' disabled') + '>重掷所选骰子' + (selection?.size ? '（' + selection.size + '）' : '') + '</button>'
        + (['attack', 'dodge'].includes(roll.mode) ? '<div class="room-reroll-fate">'
          + marker('../hero/assets/tri_fate.png', '命运') + buttons('stat', 'fate', state.heroes[roll.seat].stats.fate, roll.seat, '命运', 30, true)
          + '</div>' : '') + '</div>' : '')
      + result + (quickFeedback ? '' : feedback) + '</li>';
  }

  function latestHeroRolls() {
    const rolls = dice.latestByHero(state.rolls, state.lastBattleRollId);
    const seats = new Set(rolls.map(roll => roll.seat));
    return '<ol class="room-last-rolls">' + rolls.map(roll => rollCard(roll, true, true)).join('')
      + state.heroes.map((hero, seat) => seats.has(seat) ? '' : '<li class="room-roll room-roll-empty"><h4>'
        + rollAvatar(seat) + escape(hero.name) + '</h4><small>本场尚未掷骰</small></li>').join('') + '</ol>';
  }

  function diceCountField(kind, label, min, max, value) {
    const button = (delta, text) => '<button type="button" data-dice-step="' + kind + '" data-delta="' + delta
      + '" aria-label="' + (delta < 0 ? '减少' : '增加') + escape(label) + '"'
      + ((delta < 0 ? Number(value) <= min : Number(value) >= max) ? ' disabled' : '') + '>' + text + '</button>';
    return '<label>' + escape(label) + '<small>上限 ' + max + ' 枚</small><span class="room-dice-stepper">' + button(-1, '−')
      + '<input type="number" min="' + min + '" max="' + max + '" name="' + kind + '" value="' + escape(value)
      + '" required aria-label="' + escape(label) + '">' + button(1, '+') + '</span></label>';
  }

  function canRequestBp(seat) {
    const turn = state.turn;
    const inTurn = turn?.phase !== 'apostle'
      && (turn?.seat == null || turn.seat === seat) && !turn?.finished?.includes(seat);
    return Boolean(state.heroes[seat]) && state.heroes[seat].condition !== 'dead'
      && !(state.projection?.sharedDeck && state.projection.aiPending)
      && dice.canUseBodyPart(state, seat, state.bpSeat) && (inTurn || dice.pendingPowerRoll(state, seat));
  }

  function canSettleBp(seat) {
    return Boolean(state.projection?.bpPending && state.projection.bp?.src && state.heroes[seat])
      && (actor.role === 'host' || state.heroes[seat].condition !== 'dead')
      && dice.canUseBodyPart(state, seat, state.bpSeat);
  }

  function bpDrawButton(seat) {
    return '<button type="button" data-bp-request="' + seat + '"'
      + (state.deckRevision ? '>揭示 BP' : ' disabled>等待初始化牌堆') + '</button>';
  }

  function bpOutcomeButtons(roll) {
    return ['失败', '伤口', '暴击'].map((label, value) =>
      '<button type="button" data-bp-settle="' + value + '" data-roll-id="' + escape(roll.id)
      + '" data-seat="' + roll.seat + '">' + label + '</button>').join('');
  }

  function powerPartCard(seat, latestResult) {
    const projection = state.projection;
    const bp = projection?.bpPending ? projection.bp : null;
    const back = projection?.bpDeck?.back;
    const roll = dice.pendingPowerRoll(state, seat);
    const outcome = projection?.bpPending && roll && roll.id !== latestResult?.id && canSettleBp(seat)
      ? '<div class="room-bp-actions">' + bpOutcomeButtons(roll) + '</div>' : '';
    let control = '';
    if (!projection?.bpPending) {
      control = canRequestBp(seat) ? bpDrawButton(seat) : '<small>'
        + (projection?.sharedDeck && projection.aiPending ? '请先结算当前 AI' : '投掷威力骰后可揭示 BP') + '</small>';
    } else if (roll && !canSettleBp(seat)) {
      control = '<small>等待当前部位牌结算</small>';
    }
    return '<aside class="room-power-card"><h4>' + (bp?.src ? '当前部位牌' : '部位牌') + '</h4>'
      + (bp?.src ? cardImage('/aibp/' + bp.src, bp.label || '部位牌')
        : (back?.src ? cardImage('/aibp/' + back.src, back.label || '部位牌牌背') : '')
          + '<small>' + (projection ? '等待揭示本次部位牌' : '等待房主同步') + '</small>')
      + control + outcome + '</aside>';
  }

  function kratosReminder(hero) {
    const kratos = window.ATO_KRATOS_TABLES;
    const table = kratos?.forTitan(hero?.titan);
    if (!table) return '';
    const rage = hero.stats.rage;
    const unlocked = table.rows.filter(([threshold]) => threshold <= rage);
    const next = table.rows.find(([threshold]) => threshold > rage);
    function rowMarkup([threshold, options]) {
      return '<li' + (threshold === unlocked.at(-1)?.[0] ? ' class="room-kratos-latest"' : '') + '><strong>怒气 ' + threshold + '</strong><div>' + options.map(effects =>
        '<span>' + effects.map(effect => {
          const icon = kratos.icons[effect];
          const label = escape(kratos.labels[effect]);
          return icon ? marker('images/' + icon, label) : label;
        }).join(' + ') + '</span>').join('<small>或</small>') + '</div></li>';
    }
    return '<section class="room-kratos-reminder" aria-label="克拉托斯表能力">'
      + '<h4>克拉托斯表 · ' + escape(table.name) + '</h4><p aria-live="polite">当前怒气 ' + rage
      + ' · 解锁 ' + unlocked.length + ' 档' + (next ? ' · 下一档怒气 ' + next[0] : ' · 全部档位已解锁') + '</p>'
      + (unlocked.length ? '<ul>' + unlocked.map(rowMarkup).join('') + '</ul>'
        + '<small>每档选一项，带「+」的效果一起结算。按能力时段手动放置标记。</small>' : '')
      + '</section>';
  }

  function updateDiceSteps(input) {
    for (const button of input.parentElement.querySelectorAll('[data-dice-step]')) {
      button.disabled = Number(button.dataset.delta) < 0
        ? Number(input.value) <= Number(input.min) : Number(input.value) >= Number(input.max);
    }
  }

  function restoreDiceDraft(form, seat) {
    const draft = readDiceDraft(seat, rollMode);
    for (const input of form.querySelectorAll('input[type="number"]')) {
      input.value = draft[input.name] ?? input.min;
      updateDiceSteps(input);
    }
  }

  function rollReference(seat) {
    const hero = state.heroes[seat];
    if (!hero) return '';
    if (rollMode === 'attack') {
      const weapons = hero.gear.filter(item => item.category?.split('_')[0] === 'arm');
      const art = window.ATO_BATTLE_ASSETS;
      const cards = weapons.map(item => {
        const source = art?.gearSrc(item.id, roomLanguage);
        return '<li>' + (source ? cardImage(source, item.name, '', art.gearThumbSrc(item.id, roomLanguage)) : escape(item.name)) + '</li>';
      }).join('');
      const rage = hero.stats.rage;
      return '<section class="room-roll-reference"><h4>宣告武器</h4><div>'
        + '<button type="button" data-action="stat" data-key="rage" data-delta="1" data-seat="' + seat
        + '"' + (rage >= 30 || hero.condition === 'dead' ? ' disabled' : '') + '>怒气 +1</button>'
        + '<span>当前怒气 ' + rage + '</span></div>'
        + (cards ? '<ul>' + cards + '</ul>' : '<p>该英雄未装备武器。</p>') + '</section>';
    }
    if (rollMode === 'dodge') {
      const trait = aiGuide.stepFor(state.turn?.aiGuide)?.startsWith('hope-');
      const projection = state.projection;
      const card = trait ? { src: projection?.signature, label: '当前招牌技' } : projection?.aiPending ? projection.ai : null;
      return '<section class="room-roll-reference"><h4>本次闪避参考</h4>'
        + (card?.src ? cardImage('/aibp/' + card.src, card.label || '当前指令技') : '<p>目前没有待结算的指令技。</p>')
        + '</section>';
    }
    return '';
  }

  function renderDicePanel(panel, powerPool) {
    const seat = actor.role === 'host' ? rollSeat : actor.seat;
    const previousForm = panel.querySelector('form[data-roll]');
    const fields = dice.modes[rollMode].kinds.map(kind => {
      const label = kind === 'd10' ? '总数量（含 1 枚白色关键骰）' : dice.names[kind];
      const minimum = kind === 'd10' || kind === 'armor' || rollMode === 'defense' ? 1 : 0;
      return diceCountField(kind, label, minimum, dice.limits[kind], minimum);
    }).join('');
    const followup = rollMode === 'dodge' ? diceCountField('defenseCount', '预计防御红骰', 0, 6, 0) : '';
    const last = dice.latestByHero(state.rolls, state.lastBattleRollId).find(roll => roll.seat === seat);
    const latestResult = '<section class="room-personal-result"><h4>最新投掷</h4>'
      + (last ? '<ol class="room-last-rolls">' + rollCard(last, true) + '</ol>' : '<p>该英雄本场尚未掷骰。</p>') + '</section>';
    const notes = {
      attack: '宣告武器，增加 1 怒气并检查首要目标，再按武器牌投攻击骰。命中后先结算第一能力时段，再揭示部位卡牌。',
      dodge: '先结算闪避，根据结果决定是否投掷防御红骰。',
      power: '先揭示部位卡牌。重掷和转换潜力后，对照永世力场选结果，再按牌面结算骇物响应、伤口和激化。结算后清空克拉托斯池，再进入第二能力时段。',
    };
    const form = '<form data-roll data-dice-seat="' + seat + '" class="battle-room-dice"><div>' + fields + followup
      + '<button type="submit">投掷' + dice.modes[rollMode].name + '</button></div></form>';
    const modes = '<div class="room-dice-modes" role="group" aria-label="投掷用途">' + Object.entries(dice.modes)
      .map(([key, entry]) => '<button type="button" data-roll-mode="' + key + '" aria-pressed="' + (key === rollMode) + '">'
        + (key === 'dodge' ? '<img class="room-mode-icon" src="room-dice-art/dodge.webp" alt="">'
          : '<span class="room-mode-icon" aria-hidden="true"></span>') + entry.name + '</button>').join('')
      + (state.turn?.phase === 'titans' && state.turn.seat === seat
        ? '<button class="room-dice-end-turn" type="button" data-action="turn-finish" data-seat="' + seat + '">结束回合</button>' : '')
      + '</div>';
    const power = rollMode === 'power';
    const pendingPower = dice.pendingPowerRoll(state, seat);
    const showSeparateBp = !power && pendingPower && pendingPower.id !== last?.id;
    renderSections(panel, [
      '<h3>掷骰</h3>', actor.role === 'host' && !hostPersonalView && heroSeatButtons(seat, 'roll'), modes, rollReference(seat),
      power ? '<div class="room-power-workspace"></div>' : form, latestResult,
      showSeparateBp && powerPartCard(seat, last),
      notes[rollMode] && '<p class="room-dice-help">' + notes[rollMode] + '</p>',
      ['attack', 'power'].includes(rollMode) && kratosReminder(state.heroes[seat]), powerPool,
    ]);
    if (power) renderSections(panel.querySelector('.room-power-workspace'), [powerPartCard(seat, last), form]);
    const currentForm = panel.querySelector('form[data-roll]');
    if (currentForm !== previousForm) restoreDiceDraft(currentForm, seat);
  }

  window.getAibpBattleRecap = () => squadLink?.recapMarkup(state?.squad?.recap?.battleNumber === state?.squad?.battleNumber
    && state?.squad?.phase === 'story' ? state.squad.recap : null);

  function renderRecap() {
    if (content.querySelector('.room-battle-recap')) return;
    dock.hidden = true;
      if (toolsDialog.open) toolsDialog.close();
    boardMount.hidden = true;
    summary.innerHTML = '';
    content.innerHTML = squadLink.recapMarkup(state.squad.recap)
      + '<p><button type="button" data-open-loot>计算战利品</button> <a href="'
      + escape(squadLink.link('/aibp/squad', id)) + '">返回联机小队</a></p>';
    const loot = content.querySelector('[data-open-loot]');
    loot.addEventListener('click', () => window.openAibpLoot?.());
    loot.hidden = !window.openAibpLoot;
  }

  function finishSquadBattle() {
    const dialog = document.createElement('dialog');
    dialog.className = 'room-trauma-dialog room-battle-finish';
    dialog.innerHTML = '<form><h3>结束战斗</h3><p>已按每次威力投掷的击破结果累计损伤。</p><ul>'
      + state.heroes.map((hero, seat) => '<li>' + escape(hero.name) + ' · ' + (state.damageBySeat?.[seat] ?? 0) + '</li>').join('')
      + '</ul><details><summary>调整其他来源造成的损伤</summary>'
      + state.heroes.map((hero, seat) => '<label>' + escape(hero.name)
        + '<input type="number" min="0" max="999" step="1" name="damage-' + seat
        + '" placeholder="' + (state.damageBySeat?.[seat] ?? 0) + '"></label>').join('')
      + '</details><footer><button type="button" data-cancel>取消</button><button type="submit">结束战斗并结算</button></footer></form>';
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.querySelector('form').onsubmit = event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const damage = state.heroes.map((_, seat) => {
        const value = fields.get('damage-' + seat);
        return value === '' ? null : Number(value);
      });
      dialog.close();
      send({ id: crypto.randomUUID(), type: 'end', ...(damage.some(value => value !== null) && { damage }) });
    };
    root.append(dialog);
    dialog.showModal();
  }

  function syncProjection() {
    if (actor?.role !== 'host' || state.closed || !state.board || (state.squad && state.squad.phase !== 'battle')) return;
    const authoritative = state.hostBattleDeck;
    if (authoritative && authoritative.revision !== hostDeckRevision) {
      if (authoritative.operation !== projectionAction
          && !window.setAibpRoomBattleDeck?.(authoritative.data)) return;
      hostDeckRevision = authoritative.revision;
      if (authoritative.operation !== projectionAction) {
        lastProjectionSent = JSON.stringify([window.getAibpRoomProjection?.(), window.getAibpRoomBattleDeck?.()]);
      }
    }
    if (projectionAction) return;
    const projection = window.getAibpRoomProjection?.();
    if (!projection || projection.apostle !== state.board.apostle) return;
    const deck = state.squad && window.getAibpRoomBattleDeck?.();
    const key = JSON.stringify([projection, deck]);
    if (key === lastProjectionSent) return;
    lastProjectionSent = key;
    projectionAction = crypto.randomUUID();
    send({ id: projectionAction, type: 'room-projection', projection, ...(deck && { deck, deckRevision: hostDeckRevision }) });
  }

  window.submitAibpRoomBp = mode => {
    if (actor?.role !== 'host' || !state.deckRevision || state.closed || state.squad?.phase !== 'battle') return false;
    const seat = state.bpSeat ?? state.turn?.seat ?? rollSeat;
    if (!mode) {
      const activeSeat = state.turn?.seat;
      const drawSeat = state.bpSeat ?? activeSeat ?? (dice.pendingPowerRoll(state, rollSeat) ? rollSeat : undefined);
      if (drawSeat !== undefined && !canRequestBp(drawSeat)) { say('请在对应的泰坦回合揭示部位牌。'); return true; }
      send({ id: crypto.randomUUID(), type: 'bp-request', seat: drawSeat, round: state.round });
      return true;
    }
    const value = ['discard', 'defeat', 'critical'].indexOf(mode);
    if (value < 0 || (state.projection?.sharedDeck && state.projection.aiPending)) return false;
    if (!canSettleBp(seat)) {
      say('请先揭示并核对当前部位牌。');
      return true;
    }
    const roll = dice.pendingPowerRoll(state, seat);
    send({ id: crypto.randomUUID(), type: 'bp-settle', seat, round: state.round,
      ...(roll && { roll: roll.id }), value, card: state.projection.bp.src });
    return true;
  };

  function bossIdentityArt() {
    const logo = window.BattleBoardSprites?.forApostle?.(state.board?.apostle)?.icon;
    return logo ? '<img class="boss-identity-art" src="' + escape(logo) + '" alt="">' : '';
  }

  const bossTokenLabels = {
    AT: '永世力场', DA: '凶险', ED: '闪避骰', HT: '命中难度',
    SP: '速度', ps: '闪避难度', py: '命运',
  };
  function roomBossTokens(tokens) {
    if (!tokens) return '';
    const counters = { demidjinn: '以怨还怨', dragon: '累计指示物', meduketos: '累计损伤' };
    const entries = tokens.map(token => {
      const attribute = bossTokenLabels[token.file.slice(0, 2)];
      const sign = token.file.includes('-') ? '−' : '+';
      const label = token.text || token.label || (token.midascorePain ? '疼痛增量' : '')
        || counters[token.c45PanelCounter] || (attribute ? attribute + ' ' + sign + token.count : '')
        || (token.file === 'CM.jpg' ? '临界质量' : '通用标记');
      const detail = (attribute && !token.label ? '' : ' ×' + token.count) + (token.perHit ? ' / 命中' : '');
      const icon = token.file ? '<img src="/aibp/ps/other/token/' + encodeURIComponent(token.file) + '" alt="" loading="lazy">' : '';
      return '<li>' + icon + '<span>' + escape(label + detail) + '</span></li>';
    }).join('');
    return '<h4>当前标记</h4>' + (entries ? '<ul class="room-boss-tokens">' + entries + '</ul>' : '<p>无</p>');
  }

  function roomBossStats(projection) {
    const { apostle, level } = state.board;
    const rows = window.AIBP_BOSS_LEVEL_DATA?.bosses?.[apostle]?.levels ?? {};
    const levels = Object.values(rows);
    const current = rows[level];
    const tokens = projection?.tokens;
    const net = (code, perHit = false) => (tokens || []).reduce((total, token) => {
      if (Boolean(token.perHit) !== perHit || token.demidjinnWishArmor) return total;
      return total + (token.file === code + '+.png' ? token.count : token.file === code + '-.png' ? -token.count : 0);
    }, 0);
    const signed = value => value > 0 ? '+' + value : value;
    const hit = value => Number.isFinite(value) ? value + '+' : value;
    const adjusted = (value, delta, format = value => value) => Number.isFinite(value)
      ? format(value + delta) : delta && value !== '∞' ? (value ?? '—') + '（' + signed(delta) + '）' : value;
    const per = (attack, hit) => [attack ? signed(attack) + ' / 攻击' : '', hit ? signed(hit) + ' / 命中' : '']
      .filter(Boolean).join('、') || '—';
    const wounds = row => projection?.damage?.wounds || row?.stats.wounds;
    const columns = [
      ['生命值', row => row.stats.wounds, wounds],
      ['速度', row => row.stats.movement, row => adjusted(row?.stats.movement, net('SP'), value => Math.max(0, value))],
      ['命中难度', row => hit(row.stats.hitRequirement), row => adjusted(row?.stats.hitRequirement, net('HT'), hit)],
      ['永世力场修正', row => signed(row.bonuses.at), () => signed(net('AT'))],
      ['闪避骰修正', row => signed(row.bonuses.evasionDice), () => signed(net('ED'))],
      ['开战晋升', row => row.bonuses.promotions],
    ];
    if (net('ps')) columns.push(['闪避难度修正', () => '—', () => signed(net('ps'))]);
    if (net('DA') || net('DA', true) || levels.some(({ bonuses }) => bonuses.dangerPerAttack || bonuses.dangerPerHit)) {
      columns.push(['凶险', row => per(row.bonuses.dangerPerAttack, row.bonuses.dangerPerHit), () => per(net('DA'), net('DA', true))]);
    }
    if (net('py') || net('py', true) || levels.some(({ bonuses }) => bonuses.fatePerAttack || bonuses.fatePerHit)) {
      columns.push(['命运', row => per(row.bonuses.fatePerAttack, row.bonuses.fatePerHit), () => per(net('py'), net('py', true))]);
    }
    const cell = value => escape(value ?? '—');
    const attrs = current || projection
      ? '<dl>' + (projection ? [['损伤', () => projection.damage.total]] : []).concat(columns).map(([label, base, live]) =>
        '<div><dt>' + label + '</dt><dd>' + cell(live && (tokens || live === wounds) ? live(current) : current ? base(current) : undefined) + '</dd></div>').join('') + '</dl>'
      : '<p>此等级的属性暂无记录。</p>';
    const comparison = levels.length > 1
      ? '<details class="room-boss-levels"><summary>各等级属性对照</summary>'
        + '<div class="room-boss-level-scroll" role="region" aria-label="各等级属性对照" tabindex="0">'
        + '<table><thead><tr><th scope="col">等级</th>'
        + columns.map(([label]) => '<th scope="col">' + label + '</th>').join('') + '</tr></thead>'
        + '<tbody>' + levels.map(row => '<tr' + (row === current ? ' aria-current="true"' : '') + '>'
          + '<th scope="row">' + cell(row.label) + '</th>'
          + columns.map(([, value]) => '<td>' + cell(value(row)) + '</td>').join('') + '</tr>').join('')
        + '</tbody></table></div></details>'
      : '';
    return '<section class="room-boss-stats"><h4>骇物属性 · Lv ' + cell(current?.label ?? level)
      + '</h4>' + attrs + roomBossTokens(tokens) + comparison + '</section>';
  }

  function roomProjection(showStats = false) {
    const projection = state.projection;
    const heading = '<h3>' + bossIdentityArt() + '骇物战况</h3>';
    const stats = showStats && state.board ? roomBossStats(projection) : '';
    if (!projection) return state.board
      ? '<section class="room-projection">' + heading + stats + '<p>等待房主同步 AIBP 战况。</p></section>' : '';
    const { title, level, panel, signature, ai, bp, aiDeck, bpDeck, damage } = projection;
    const bossArt = (src, label) => src ? cardImage('/aibp/' + src, label) : '';
    function deckCards(type, card, deck) {
      const face = bossArt(card?.src, card?.label || type) || '<p>尚未揭示</p>';
      const reverse = deck.back?.src ? bossArt(deck.back.src, deck.back.label || type + ' 牌背')
        : '<p>' + (deck.count ? escape(deck.backs || '等待牌背同步') : '牌堆已空') + '</p>';
      return '<div data-projection-deck="' + type + '"><h4>' + type + '</h4><div class="room-projection-pair">'
        + '<div><small>最后揭示</small>' + face + '</div><div><small>下一张牌背</small>' + reverse + '</div></div></div>';
    }
    function deckCounts(label, deck) {
      return '<div><dt>' + label + '</dt><dd>牌背 ' + deck.count + ' 张 · 弃牌 ' + deck.discard + ' 张</dd>'
        + (deck.backs ? '<dd class="room-projection-deck">' + escape(deck.backs) + '</dd>' : '') + '</div>';
    }
    const damageText = damage.total + (damage.wounds ? ' / ' + damage.wounds : '')
      + (damage.damage1 == null ? '' : '（' + damage.damage1 + ' + ' + damage.damage2 + '）');
    const signatureCard = signature
      ? '<div class="room-projection-panel"><h4>招牌技</h4>' + bossArt(signature, '招牌技') + '</div>' : '';
    return '<section class="room-projection">' + heading + '<p>' + escape([title, level].filter(Boolean).join(' · ')) + '</p>'
      + (showStats ? '<div class="room-boss-quick">' + signatureCard + stats + '</div>' : '')
      + '<div class="room-projection-cards">' + deckCards('AI', ai, aiDeck) + deckCards('BP', bp, bpDeck)
      + '<div class="room-projection-panel"><h4>骇物面板</h4>' + (bossArt(panel, title) || '<p>暂无面板图</p>') + '</div>'
      + (showStats ? '' : signatureCard) + '</div>'
      + '<dl class="room-projection-counts"><div><dt>损伤</dt><dd>' + damageText + '</dd></div>'
      + deckCounts('AI 牌堆', aiDeck) + deckCounts('BP 牌堆', bpDeck) + '</dl></section>';
  }

  function argoAbilities() {
    const config = state.configuration;
    if (!config?.abilities?.length && !config?.reserve?.length) return '';
    const editable = actor?.role !== 'viewer' && !state.closed;
    const cards = [...config.abilities, ...config.reserve];
    return '<section class="room-argo-abilities"><header><h3>阿尔戈能力</h3></header><small>' + escape(config.name) + ' · 已准备 '
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

  const renderedMarkup = new WeakMap();
  function renderMarkup(target, markup) {
    const previous = renderedMarkup.get(target);
    const current = [...target.childNodes];
    const intact = previous && current.length === previous.nodes.length
      && current.every((node, index) => node === previous.nodes[index]);
    if (intact && previous.markup === markup) return;
    const template = document.createElement('template');
    template.innerHTML = markup;
    const next = [...template.content.childNodes];
    const sources = next.map(node => node.outerHTML ?? node.textContent);
    for (const [index, node] of next.entries()) {
      // Compare the source HTML. The language observer may have translated
      // the live node, and open details and focused controls carry local state.
      if (intact && previous.sources[index] === sources[index]) continue;
      if (current[index]) current[index].replaceWith(node);
      else target.append(node);
    }
    for (const node of current.slice(next.length)) node.remove();
    renderedMarkup.set(target, { markup, sources, nodes: [...target.childNodes] });
  }

  const renderedSections = new WeakMap();
  function renderSections(target, sections) {
    const previous = renderedSections.get(target);
    const current = previous?.nodes.filter(Boolean);
    const intact = current?.length === target.childNodes.length
      && current.every((node, index) => node === target.childNodes[index]);
    if (!intact) target.replaceChildren();
    const nodes = [];
    let anchor = null;
    let template;
    // Stable slots let unrelated state updates skip parsing unchanged sections.
    for (let index = sections.length - 1; index >= 0; index--) {
      const html = sections[index];
      const old = intact ? previous.nodes[index] : null;
      if (!html) {
        old?.remove();
        nodes[index] = null;
        continue;
      }
      if (old && previous.sections[index] === html) {
        anchor = nodes[index] = old;
        continue;
      }
      template ||= document.createElement('template');
      template.innerHTML = html;
      const node = template.content.firstElementChild;
      if (old) old.replaceWith(node);
      else target.insertBefore(node, anchor);
      anchor = nodes[index] = node;
    }
    renderedSections.set(target, { sections, nodes });
  }

  function screenHero(hero, seat) {
    const stats = Object.entries(statNames).map(([key, label]) => '<span data-screen-stat="' + key + '">'
      + marker('../hero/assets/tri_' + key + '.png', label) + '<strong>' + hero.stats[key] + '</strong></span>').join('');
    const markers = Object.entries(titanMarkerNames).filter(([key]) => hero.markers?.[key])
      .map(([key, label]) => label + ' ' + hero.markers[key]);
    const condition = hero.condition !== 'standing' && conditionNames[hero.condition];
    const trauma = traumaCardList(seat, false);
    const titan = hero.titan && window.ATO_GEAR_INVENTORY.titanLabel(hero.titan);
    return '<article class="room-screen-hero"><header>' + rollAvatar(seat) + '<div><h4>' + escape(hero.name)
      + '</h4>' + (titan ? '<small>' + escape(titan) + '</small>' : '') + '</div></header>'
      + '<div class="room-screen-stats">' + stats + '</div>'
      + ([condition, ...markers].filter(Boolean).length ? '<p>' + [condition, ...markers].filter(Boolean).join(' · ') + '</p>' : '')
      + (trauma ? '<ul class="room-screen-trauma">' + trauma + '</ul>' : '') + '</article>';
  }

  let latestScreenActivity;
  const screenAlerts = new Map();

  function screenActivityKind(entry) {
    if (entry.kind === 'roll' || entry.kind === 'reroll') return 'roll';
    if (entry.kind === 'ai-request') return 'ai';
    if (entry.kind === 'room-projection' && /^AI(?: |、|$)/.test(entry.detail)) return 'ai';
    return null;
  }

  function screenActivityDetail(entry) {
    return (entry.detail || '').replace(/^AI (?=AI\b)/, '');
  }

  function renderScreenActivity(log, alerts) {
    const activity = state.activity || [];
    const index = activity.findIndex(entry => entry.id === latestScreenActivity);
    const incoming = latestScreenActivity === undefined ? [] : activity.slice(0, index < 0 ? activity.length : index);
    latestScreenActivity = activity[0]?.id ?? null;
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 12;
    const entries = [...activity].reverse();
    const items = entries.map(entry => {
      const hero = entry.seat == null ? '' : state.heroes[entry.seat]?.name;
      const detail = screenActivityDetail(entry);
      return '<li><small>第 ' + entry.round + ' 轮</small><p><strong>' + escape(hero || entry.by || '房主')
        + '</strong> · ' + escape(entry.label) + (detail ? ' · ' + escape(detail) : '') + '</p></li>';
    }).join('');
    renderMarkup(log, items || '<li>等待战斗操作。</li>');
    if (atEnd) log.scrollTop = log.scrollHeight;

    for (const kind of ['ai', 'roll']) {
      const alert = alerts.querySelector('[data-screen-alert="' + kind + '"]');
      const entry = incoming.find(item => screenActivityKind(item) === kind);
      if (entry) {
        const prior = screenAlerts.get(kind);
        clearTimeout(prior?.timer);
        const hero = state.heroes[entry.seat];
        const ai = state.projection?.aiPending && state.projection.ai;
        const roll = kind === 'roll' && (state.rolls || []).find(item =>
          entry.kind === 'roll' ? item.id === entry.id : item.id === state.lastBattleRollId && item.seat === entry.seat);
        const art = kind === 'ai' && ai?.src
          ? '<img class="room-screen-ai-card" src="/aibp/' + escape(ai.src) + '" alt="' + escape(ai.label || 'AI 卡牌') + '">'
          : roll ? '<div class="room-screen-dice">' + roll.dice.map(die => dice.faceMarkup(die, './room-dice-art/')).join('') + '</div>' : '';
        const title = kind === 'ai' ? '揭示 AI' : [hero?.name, entry.label].filter(Boolean).join(' · ');
        alert.innerHTML = '<strong>' + escape(title) + '</strong><span>' + escape(screenActivityDetail(entry)) + '</span>' + art;
        alert.hidden = false;
        const timer = setTimeout(() => {
          alert.hidden = true;
          alert.replaceChildren();
          screenAlerts.delete(kind);
          log.querySelector('[data-screen-highlight="' + kind + '"]')?.removeAttribute('data-screen-highlight');
        }, kind === 'ai' ? 8000 : 6000);
        screenAlerts.set(kind, { id: entry.id, timer });
      }
    }
    for (const [i, entry] of entries.entries()) {
      const kind = screenActivityKind(entry);
      if (kind && screenAlerts.get(kind)?.id === entry.id) log.children[i].dataset.screenHighlight = kind;
      else log.children[i].removeAttribute('data-screen-highlight');
    }
  }

  function renderViewer() {
    document.body.classList.add('room-viewer');
      dock.hidden = true;
    const active = state.turn?.seat == null ? '' : state.heroes[state.turn.seat]?.name;
    const phase = state.turn?.phase === 'apostle' ? '骇物轮次' : state.turn?.phase === 'titans' ? '泰坦轮次' : '';
    const heading = ['第 ' + state.round + ' 轮', phase, active, state.closed && '已结束'].filter(Boolean).join(' · ');
    renderMarkup(summary, '<header class="battle-room-head"><h2>' + escape(state.title) + '</h2><p>'
      + escape(heading) + '</p></header>');
    if (!content.querySelector('.room-screen-layout')) {
      content.innerHTML = '<div class="room-screen-layout"><div class="room-screen-sidebar">'
        + '<section><h3>队伍状态</h3><div data-screen-heroes></div></section>'
        + '<section><h3>战斗简报</h3><ol class="room-screen-log" tabindex="0" aria-label="按时间排列的战斗简报"></ol></section></div>'
        + '<section><h3>战斗面板</h3><div data-screen-fight></div><div data-screen-board></div>'
        + '<div data-screen-projection></div></section></div>'
        + '<aside class="room-screen-alerts" aria-label="战斗提示">'
        + '<article data-screen-alert="ai" aria-live="polite" hidden></article>'
        + '<article data-screen-alert="roll" aria-live="polite" hidden></article></aside>';
      content.querySelector('[data-screen-board]').append(boardMount);
    }
    renderMarkup(content.querySelector('[data-screen-heroes]'), state.heroes.map(screenHero).join(''));
    const pool = Object.entries(poolNames).map(([key, label]) => '<span>'
      + marker('images/battle-markers/' + key + '.webp', label) + '<strong>' + state.pool[key] + '</strong></span>').join('');
    renderMarkup(content.querySelector('[data-screen-fight]'), (state.battleGoal ? '<p class="room-screen-goal"><strong>战斗目标</strong> '
      + escape(state.battleGoal) + '</p>' : '') + '<div class="room-screen-stats" aria-label="克拉托斯池">' + pool + '</div>');
    renderMarkup(content.querySelector('[data-screen-projection]'), roomProjection());

    renderScreenActivity(content.querySelector('.room-screen-log'), content.querySelector('.room-screen-alerts'));
    updateStatus();
  }

  function render() {
    const { role } = actor;
    if (role === 'viewer') return renderViewer();
    const seat = personalSeat();
    const host = role === 'host';
    const edit = role !== 'viewer' && !state.closed;
    const personalLink = host && Number.isInteger(seat)
      ? '<a href="' + escape(hostPersonalView
        ? '/aibp/?battle=' + id + (state.board?.apostle ? '&apostle=' + state.board.apostle : '')
        : '/aibp/room?battle=' + id + '&personal=1') + '">' + (hostPersonalView ? '返回房主战斗台' : '个人战斗面板') + '</a>' : '';
    const links = host && credentials.keys ? '<div class="battle-room-links">' + personalLink
      + (!state.closed && !state.squad ? '<button type="button" data-room-copy="invite">复制玩家邀请</button>' : '')
      + '<a href="' + escape(roomLink('view', credentials.keys.viewer)) + '" target="_blank" rel="noopener">打开只读投屏</a>'
      + (state.closed ? '<a href="./">返回 AIBP 开新战斗</a>' : '') + '</div>' : '';
    const controls = host && !state.closed
      ? '<button type="button" data-action="end">结束战斗</button>' : '';
    const pool = Object.entries(poolNames).map(([key, label]) => '<div>' + marker('images/battle-markers/' + key + '.webp', label)
      + buttons('pool', key, state.pool[key], undefined, label, 99, edit) + '</div>').join('');
    const clearPool = edit ? '<button type="button" data-action="pool-clear"'
      + (Object.values(state.pool).every(value => value === 0) ? ' disabled' : '') + '>一键清空</button>' : '';
    const heroes = state.heroes.map(heroCard);
    const shownSeat = host ? equipmentSeat : seat;
    const heroTabs = host && !hostPersonalView ? heroSeatButtons(shownSeat, 'equipment') : '';
    const own = heroes[shownSeat];
    const ownHeading = own && '<h3 class="battle-room-heading">' + (host && !hostPersonalView ? '泰坦与装备' : '我的英雄') + '</h3>';
    const teammates = heroes.filter((_, index) => index !== shownSeat);
    const overview = role === 'player' || hostPersonalView
      ? '<details class="battle-room-team"' + (content.querySelector('.battle-room-team')?.open ? ' open' : '')
        + '><summary>队伍状态</summary><div class="battle-room-grid">' + teammates.join('') + '</div></details>'
      : '<div class="battle-room-grid">' + teammates.join('') + '</div>';
    for (const [id, choices] of selectedDice) {
      const roll = state.rolls.find(entry => entry.id === id);
      for (const dieId of choices) if (!roll?.dice.some(die => die.id === dieId && dice.canReroll(die))) choices.delete(dieId);
      if (!choices.size) selectedDice.delete(id);
    }
    const personal = (role === 'player' || (host && hostPersonalView)) && edit;
    const latestRoll = personal ? null : state.rolls.find(roll => roll.id === state.lastBattleRollId) || state.rolls[0];
    const rolls = latestRoll ? rollCard(latestRoll, true)
      + state.rolls.filter(roll => roll !== latestRoll).map(roll => rollCard(roll, false)).join('') : '';
    const rollLog = '<section class="battle-room-rolls"><h3>掷骰记录</h3>'
      + (rolls ? '<ol>' + rolls + '</ol>' : '<p>还没有掷骰。</p>') + '</section>';
    const active = document.activeElement;
    const focusRoot = summary.contains(active) ? summary : content;
    const focus = active && focusRoot.contains(active) ? [...focusRoot.querySelectorAll('button,select,input')].indexOf(active) : -1;
    const selection = focus >= 0 && active.name;
    renderMarkup(summary, '<div class="battle-room-head"><div><h2>' + escape(state.title) + '</h2><p>第 ' + state.round
      + ' 轮' + (state.closed ? ' · 已结束' : '') + '</p></div><div>' + controls + '</div></div>' + links);
    const goal = state.battleGoal ? '<section class="room-battle-goal"><h3>战斗目标</h3><p>'
      + escape(state.battleGoal) + '</p></section>' : '';
    const second = state.secondAbility;
    const canFinishTurn = second?.round === state.round && state.turn?.phase === 'titans'
      && state.turn.seat === second.seat && (host ? rollSeat === second.seat : seat === second.seat);
    const poolSection = '<section class="battle-room-pool" id="room-kratos-pool" tabindex="-1"><header><h3>克拉托斯池</h3>'
      + clearPool + '</header>' + (second && second.round === state.round
        ? '<p class="room-second-ability"><strong>第二能力时段 · ' + escape(state.heroes[second.seat]?.name)
          + '</strong> · 先结算响应与激化，再清空旧标记（按卡文保留例外），之后加入本次标记。</p>'
        + (canFinishTurn ? '<button type="button" data-action="turn-finish" data-seat="' + second.seat + '">结束回合</button>' : '') : '')
      + '<div>' + pool + '</div></section>';
    const poolByDice = edit && (personal || !!own || rollMode === 'power');
    renderSections(content, [
      goal, !personal && !poolByDice && poolSection,
      edit && '<section class="room-dice-panel" id="room-dice"></section>',
      ownHeading, own && heroTabs, own, !personal && argoAbilities(),
      state.board && '<details class="room-jump-panel" id="room-apostle"><summary>骇物面板</summary><div data-jump-apostle></div></details>',
      '<details class="room-jump-panel" id="room-trauma"><summary>创伤牌库</summary><div data-jump-trauma></div></details>',
      !personal && edit && rollLog, edit && teamActivity(),
      role !== 'player' && !hostPersonalView && '<h3 class="battle-room-heading">状态总览</h3>', overview, !edit && rollLog,
      state.squad && '<p><a href="' + escape(squadLink.link('/aibp/squad', id)) + '">返回联机小队</a></p>',
    ]);
    if (edit) renderDicePanel(content.querySelector('#room-dice'), poolByDice ? poolSection : '');
    const bossPanel = content.querySelector('[data-jump-apostle]');
    if (bossPanel) renderMarkup(bossPanel, roomProjection(true));
    const traumaSeat = seat ?? (host ? equipmentSeat : null);
    renderMarkup(content.querySelector('[data-jump-trauma]'), roomTrauma()
      + (state.heroes[traumaSeat] ? traumaControls(state.heroes[traumaSeat], traumaSeat, edit) : ''));
    renderTools();
    renderTurn();
    if (focus >= 0 && active !== document.activeElement) {
      const target = focusRoot.querySelectorAll('button,select,input')[focus];
      if (target && (!selection || target.name === selection)) target.focus({ preventScroll: true });
    }
    if (failedAction) appendRetry();
    updateStatus();
  }

  function appendRetry() {
    if (content.querySelector('[data-room-retry]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.roomRetry = '';
    button.textContent = '重试上次操作';
    content.append(button);
  }

  function retryFailedAction() {
    if (!failedAction || writing || !credentials?.token || state.closed
        || (state.squad && state.squad.phase !== 'battle')) return;
    clearTimeout(actionRetry);
    actions.unshift(failedAction);
    failedAction = null;
    content.querySelector('[data-room-retry]')?.remove();
    void writeActions();
  }

  function send(action) {
    const queued = { ...action, ...(state.squad && { battleNumber: state.squad.battleNumber }),
      ...(action.type !== 'room-projection' && { expectedRound: state.round }) };
    actions.push(queued);
    if (Object.hasOwn(cardActionLabels, action.type)) {
      actionTimings.set(queued, {
        queuedAt: performance.now(),
        result: { at: new Date().toISOString(), operation: action.type, round: state.round, transports: [] },
      });
      updateStatus();
    }
    void writeActions();
  }

  function noteTransport(timing, transport) {
    if (!timing) return;
    const now = performance.now();
    timing.sentAt ??= now;
    const transports = timing.result.transports;
    if (transports.length < 12) transports.push(transport);
  }

  function saveActionTiming(timing, outcome, fields = {}) {
    if (!timing) return;
    const { result, queuedAt, sentAt } = timing;
    if (!timingHistory.includes(result)) {
      timingHistory.push(result);
      if (timingHistory.length > 60) timingHistory.shift();
    }
    Object.assign(result, {
      outcome, queueMs: Math.round((sentAt ?? performance.now()) - queuedAt),
      totalMs: Math.round(performance.now() - queuedAt), ...fields,
    });
    try { sessionStorage.setItem(timingKey, JSON.stringify(timingHistory)); } catch { /* Optional. */ }
  }

  async function submitAction(action, timing) {
    if (socketActions && socket?.readyState === WebSocket.OPEN) {
      const current = socket;
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            socketAction = null;
            disconnectSocket?.();
            reject(new TypeError('战斗操作确认超时。'));
          }, 8000);
          socketAction = { id: action.id, socket: current, timer, resolve, reject };
          try {
            noteTransport(timing, 'websocket');
            current.send(JSON.stringify({ type: 'action', action }));
          }
          catch (error) {
            clearTimeout(timer);
            socketAction = null;
            reject(error);
          }
        });
      } catch (error) {
        if (error instanceof RejectedAction) throw error;
        // An acknowledgement may be lost after the action was saved. Retrying
        // the same operation ID through HTTP lets the server deduplicate it.
      }
    }
    noteTransport(timing, 'http');
    return request(id + '/action', action);
  }

  async function writeActions() {
    if (writing || failedAction) return;
    writing = true;
    while (actions.length && !failedAction) {
      const action = actions.shift();
      const timing = actionTimings.get(action);
      if (timing) {
        activeCardAction = action;
        updateStatus();
      }
      try {
        const result = await submitAction(action, timing);
        const confirmedAt = timing ? performance.now() : 0;
        acceptUpdate(result);
        if (action.id === turnAiAction) {
          turnAiAction = null;
          renderTurn();
          const card = state.projection?.aiPending && state.projection.ai;
          if (card?.src && !state.turn?.aiGuide && !window.openAibpRoomAi?.(state.board?.apostle)) {
            window.ATO_BATTLE_ASSETS?.zoom('/aibp/' + card.src, card.label || '抽取的 AI');
          }
        }
        actionRetryDelay = 1500;
        say('');
        if (timing) {
          const revision = result.room?.revision ?? result.roomPatch?.revision;
          saveActionTiming(timing, 'confirmed', {
            status: null, reason: null, confirmMs: Math.round(confirmedAt - timing.sentAt),
            uiMs: state.revision >= revision ? Math.round(performance.now() - confirmedAt) : null,
          });
        }
      } catch (error) {
        saveActionTiming(timing, error instanceof RejectedAction ? 'rejected' : 'retry', {
          status: error.status ?? null, reason: error instanceof RejectedAction ? error.message : 'transport',
        });
        say(error.message);
        if (action.type === 'room-projection') {
          lastProjectionSent = '';
          if (error.status === 409) await refreshRoomState();
          if (!(error instanceof RejectedAction)) {
            clearTimeout(projectionRetry);
            projectionRetry = setTimeout(syncProjection, 3000);
          }
        } else if (error instanceof RejectedAction) {
          if (action.id === turnAiAction) turnAiAction = null;
          if (error.status === 409 && ['ai-request', 'ai-guide', 'ai-guide-discard', 'bp-request', 'bp-settle'].includes(action.type)) await refreshRoomState();
          if (error.status === 401 && lostSeat()) break;
          if (!state.squad || state.squad.phase === 'battle') render();
        } else {
          failedAction = action;
          say('操作未确认，恢复连接后会自动重试。');
          appendRetry();
          clearTimeout(actionRetry);
          actionRetry = setTimeout(() => {
            if (!document.hidden && navigator.onLine) retryFailedAction();
          }, actionRetryDelay);
          actionRetryDelay = Math.min(actionRetryDelay * 2, 15000);
        }
      } finally {
        if (timing) {
          activeCardAction = null;
          updateStatus();
        }
        if (action.id === projectionAction) {
          projectionAction = null;
          if (lastProjectionSent) syncProjection();
        }
      }
    }
    writing = false;
  }

  async function openJoinLobby() {
    const lobby = await request(id + '/lobby', { quick: quickJoin }, invite);
    if (lobby.squad) {
      const target = new URL(squadLink.link('/aibp/squad', id, 'invite', invite));
      if (quickJoin) target.searchParams.set('quick', '1');
      location.replace(target);
      return;
    }
    squadLink?.language(lobby.language);
    const options = lobby.heroes.map((hero, index) => '<option value="' + index + '"' + (hero.taken ? ' disabled' : '') + '>'
      + escape(hero.name) + (hero.taken ? '（已认领）' : '') + '</option>').join('');
    const full = lobby.heroes.every(hero => hero.taken);
    const previews = lobby.heroes.map(hero => {
      const avatar = heroPortrait(hero);
      return '<li>' + (avatar ? '<img class="battle-room-avatar" src="../hero/assets/' + escape(avatar) + '" alt="">' : '')
        + '<strong>' + escape(hero.name) + '</strong><small> · ' + escape(hero.titan ? window.ATO_GEAR_INVENTORY.titanLabel(hero.titan) : '未分配泰坦')
        + (hero.gear?.length ? ' · ' + hero.gear.map(item => escape(item.name) + ' ×' + item.count).join('、') : '') + '</small></li>';
    }).join('');
    content.innerHTML = '<h2>' + escape(lobby.title) + '</h2><ul class="room-join-previews">' + previews + '</ul>' + (full ? '<p>该房间的英雄已全部被认领。</p>'
      : '<form data-join><label>玩家名 <input name="player" maxlength="32" required autocomplete="nickname"></label>'
      + '<label>英雄 <select name="seat" aria-label="英雄" required>' + options + '</select></label><button type="submit">加入战斗</button></form>');
    say('');
  }

  toggle.addEventListener('click', () => {
    if (state) {
      root.hidden = !root.hidden;
      toggle.setAttribute('aria-expanded', String(!root.hidden));
      if (!root.hidden) root.scrollIntoView({ block: 'nearest' });
    }
  });

  content.addEventListener('input', event => {
    if (event.target.form?.matches('[data-roll]')) {
      const input = event.target;
      updateDiceSteps(input);
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
    if (event.target.matches('[data-condition]')) {
      void send({ id: crypto.randomUUID(), type: 'condition', seat: Number(event.target.dataset.condition), value: event.target.value });
    }
  });

  window.addEventListener('aibp-room-projection', syncProjection);
  function resumeConnection() {
    if (document.hidden || !credentials?.token || !state || state.closed) return;
    if (socket?.readyState >= WebSocket.CLOSING) disconnectSocket?.();
    clearTimeout(reconnectTimer);
    connect();
    syncProjection();
    void refreshRoomState();
    retryFailedAction();
  }
  window.addEventListener('online', resumeConnection);
  document.addEventListener('visibilitychange', resumeConnection);

  document.addEventListener('ato-battle-assets', () => {
    if (state) { roomBoard?.render(); render(); }
  });

  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || (!summary.contains(button) && !content.contains(button) && !toolsBody.contains(button) && !turnWindow.contains(button))) return;
    if (button.dataset.rollSeat !== undefined && actor?.role === 'host') {
      const selected = Number(button.dataset.rollSeat);
      if (state.heroes[selected] && selected !== rollSeat) {
        rollSeat = selected;
        parentRoll = '';
        render();
      }
      return;
    }
    if (button.dataset.equipmentSeat !== undefined) {
      equipmentSeat = Number(button.dataset.equipmentSeat);
      render();
      return;
    }
    if (button.dataset.bpRequest !== undefined) {
      if (button.disabled || !state || state.closed) return;
      send({ id: crypto.randomUUID(), type: 'bp-request', seat: Number(button.dataset.bpRequest), round: state.round });
      return;
    }
    if (button.dataset.bpSettle !== undefined) {
      if (actions.some(action => action.type === 'bp-settle')) return;
      send({ id: crypto.randomUUID(), type: 'bp-settle', seat: Number(button.dataset.seat),
        round: state.round, roll: button.dataset.rollId, value: Number(button.dataset.bpSettle), card: state.projection?.bp?.src });
      return;
    }
    if (button.hasAttribute('data-save-config')) {
      void saveConfig(button.form);
      return;
    }
    const { roomCopy, action, key, seat, delta, armCard, slot, value,
      rollMode: mode, rollFollowup, rollId, dieId, symbol } = button.dataset;
    if (button.dataset.traumaDialog) {
      openTraumaDialog(button.dataset.traumaDialog, Number(seat));
      return;
    }
    if (button.dataset.diceStep) {
      const input = button.form.elements.namedItem(button.dataset.diceStep);
      input.value = Math.max(Number(input.min), Math.min(Number(input.max), (Number(input.value) || 0) + Number(delta)));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (mode || rollFollowup) {
      rollMode = mode || rollFollowup;
      parentRoll = rollFollowup ? rollId : '';
      const source = rollFollowup && state.rolls.find(roll => roll.id === rollId);
      const defense = rollMode === 'defense' && source;
      if (rollFollowup) rollSeat = Number(seat);
      if (defense) saveDiceDraft(rollSeat, 'defense', { red: source.defenseCount });
      if (rollFollowup && toolsDialog.open) toolsDialog.close();
      render();
      const form = content.querySelector('form[data-roll]');
      if (defense && form) restoreDiceDraft(form, rollSeat);
      form?.querySelector('input')?.focus();
      return;
    }
    if (action === 'roll-wounds') {
      send({ id: crypto.randomUUID(), type: action, roll: rollId, seat: Number(seat), value: Number(value) });
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
    if (action === 'roll-reaction') {
      send({ id: crypto.randomUUID(), type: action, roll: rollId, value: value === 'clear' ? null : value });
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
      const { panel, signature } = state.projection || {};
      const related = signature && button.dataset.roomArt === '/aibp/' + panel
        ? { src: '/aibp/' + signature, label: '招牌技' } : null;
      window.ATO_BATTLE_ASSETS?.zoom(button.dataset.roomArt, image.alt, related);
    } else if (roomCopy) {
      const url = roomLink(roomCopy, credentials.keys[roomCopy]);
      try {
        await navigator.clipboard.writeText(url);
        say('邀请链接已复制');
      } catch {
        window.prompt('复制玩家邀请链接', url);
      }
    } else if ('roomRetry' in button.dataset && failedAction) {
      retryFailedAction();
    } else if (armCard) {
      armedCard = armedCard === armCard ? '' : armCard;
      render();
    } else if (action === 'gear-ready-all') {
      send({ id: crypto.randomUUID(), type: action, seat: Number(seat) });
    } else if (['gear-card', 'mnemos-card', 'pattern-card'].includes(action)) {
      if (value === 'discarded') armedCard = '';
      void send({ id: crypto.randomUUID(), type: action, key, seat: Number(seat), slot: Number(slot), value });
      render();
    } else if (action === 'trauma-resolve') {
      send({ id: crypto.randomUUID(), type: action, seat: Number(seat), draw: button.dataset.draw, operation: value });
    } else if (action === 'public-lobby') {
      send({ id: crypto.randomUUID(), type: action, value: value === 'true' });
    } else if (action === 'turn-finish') {
      send({ id: crypto.randomUUID(), type: action, seat: Number(seat), round: state.round, phase: state.turn?.phase });
    } else if (action === 'pool-clear') {
      send({ id: crypto.randomUUID(), type: action });
    } else if (action) {
      if (action === 'end' && state.squad) return finishSquadBattle();
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
      if (form.matches('[data-join]')) {
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

  async function prepareSquadBattle() {
    const credential = squadLink.read(squadId);
    const back = squadLink.link('/aibp/squad', squadId);
    root.hidden = false;
    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    try {
      const data = await squadLink.request(squadId, 'state', credential?.token);
      if (data.actor.role !== 'host' || data.room.squad?.phase !== 'prep') throw new Error('请先由房主开启备战。');
      squadLink.language(data.room.squad.language);
      let available;
      try {
        const [campaignResponse, dictionary] = await Promise.all([
          fetch(campaignUrl, { cache: 'no-store', signal: AbortSignal.timeout(8000) }),
          fetch('../technology/tech_card_dictionary.min.json', { signal: AbortSignal.timeout(8000) }),
          squadLink.home({ id: squadId, credentials: credential }),
        ]);
        if (campaignResponse.ok && dictionary.ok) {
          const campaign = await campaignResponse.json();
          lobbyCampaign = { ...campaign.campaign, accountId: campaign.user?.id };
          abilityDictionary = await dictionary.json();
          available = battleConfig.availability(lobbyCampaign, abilityDictionary);
        }
      } catch { /* An invited host still has the squad's saved configuration. */ }
      await window.refreshAibpRecordLevels?.();
      content.innerHTML = '<h2>' + escape(data.room.title) + '</h2>'
        + '<ol><li>按战斗段落要求更新<a href="../record/" target="_blank" rel="noopener">阿尔戈号记录表</a>，在 AIBP 核对骇物与等级。</li>'
        + '<li>让队员在备战页确认泰坦、装备及旧忆。三曲盘沿用剧情数值。</li>'
        + '<li>核对本场的阿尔戈能力、AI／BP 牌堆、地形、站位及战斗目标。</li><li>创伤牌库沿用<a href="/aibp/trauma" target="_blank" rel="noopener">存档配置</a>。</li></ol>'
        + '<p data-prep-apostle aria-live="polite"></p><form data-prepare-battle>'
        + '<label>战斗目标<textarea name="goal" maxlength="1200" rows="3" placeholder="按故事书填写胜利条件、回合上限等"></textarea></label>'
        + (available ? configFields(available) : '')
        + '<label><input name="confirmed" type="checkbox" required>已核对配装、牌堆和本场特殊设置</label>'
        + (data.room.squad.cycle === 'c1' ? '<label><input type="checkbox" name="tutorial"> 教程战</label> ' : '')
        + '<button type="submit">用当前骇物开战</button> <a href="' + escape(back) + '">返回小队</a></form>';
      const form = content.querySelector('[data-prepare-battle]');
      const showBoss = () => {
        const selected = window.getAibpRoomProjection?.();
        const label = content.querySelector('[data-prep-apostle]');
        if (label) label.textContent = selected
          ? [selected.title, selected.level].filter(Boolean).join(' · ') : '请在 AIBP 选择骇物';
      };
      showBoss();
      window.addEventListener('aibp-room-projection', showBoss);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        event.stopPropagation();
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        try {
          await window.refreshAibpRecordLevels?.();
          const board = window.getAibpBoardSetup?.();
          if (!board) throw new Error('请先选择骇物。');
          await window.AibpCardBacks?.ready().catch(() => {});
          await squadLink.request(squadId, 'action', credential.token, {
            id: crypto.randomUUID(), type: 'squad-start', battleNumber: data.room.squad.battleNumber,
            board, goal: form.elements.goal.value, projection: window.getAibpRoomProjection?.(), deck: window.getAibpRoomBattleDeck?.(), tutorial: form.elements.tutorial?.checked === true,
            ...(available && { battleConfig: readConfig(form) }),
          });
          const url = new URL(location.href);
          url.searchParams.delete('squad');
          url.searchParams.set('battle', squadId);
          url.searchParams.set('apostle', board.apostle);
          url.hash = '';
          location.assign(url);
        } catch (error) { say(error.message); button.disabled = false; }
      });
      toggle.addEventListener('click', event => {
        event.stopImmediatePropagation();
        root.hidden = !root.hidden;
        if (!root.hidden) root.scrollIntoView({ block: 'nearest' });
      }, true);
    } catch (error) {
      say(error.message);
      content.innerHTML = '<a href="' + escape(back) + '">返回小队</a>';
    }
  }

  async function start() {
    if (params.has('theatreBattle') || location.protocol === 'file:') return;
    if (!isLink && squadLink?.validId(squadId)) return prepareSquadBattle();
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
