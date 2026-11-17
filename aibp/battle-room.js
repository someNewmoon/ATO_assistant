(() => {
  const root = document.getElementById('battleRoom');
  const toggle = document.getElementById('battleRoomToggle');
  const content = root.querySelector('[data-room-content]');
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
  const escape = window.ATO_HERO_CATALOG.escape;
  const poolNames = { opening: '伺机', break: '破势', diversion: '分神', rouse: '激励', black: '破坏', fire: '火焰', hope: '希望' };
  const conditionNames = { standing: '站立', down: '倒地', rising: '起身', dead: '死亡' };
  const diceNames = { d10: '攻击骰', crit: '暴击骰', armor: '护甲骰', red: '红色威力骰', black: '黑色威力骰', white: '白色威力骰' };
  let id = isLink ? routeId : '';
  let credentials = null;
  let state = null;
  let actor = null;
  let socket = null;
  let reconnectTimer;
  let connectionTimer;
  let reconnectDelay = 1000;
  let diceDraft = {};
  let pending = false;
  let writing = false;
  let failedAction = null;
  const actions = [];
  let connection = '正在连接';
  let message = '';

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

  function heroCard(hero, seat) {
    const editable = !state.closed && (actor.role === 'host' || (actor.role === 'player' && actor.seat === seat));
    const titan = hero.titan ? [hero.titan.name, hero.titan.type, hero.titan.crippled ? '残废' : ''].filter(Boolean).map(escape).join(' · ') : '未分配泰坦';
    const titanArt = hero.titan && window.ATO_BATTLE_ASSETS?.titanArt(hero.titan);
    const titanPreview = titanArt ? ' <button type="button" data-titan-preview="' + seat + '">' + titanArt.label + '</button>' : '';
    const gear = hero.gear.map(item => '<li><span>' + escape(item.name) + ' <small>' + escape(item.id) + '</small>'
      + (window.ATO_BATTLE_ASSETS?.hasGear(item.id) ? ' <button type="button" data-gear-preview="' + escape(item.id) + '" data-gear-name="'
        + escape(item.name) + '">查看卡图</button>' : '') + '</span>'
      + '<span>已用 ' + buttons('gear', item.id, item.used, seat, item.name + '使用数', item.count, editable) + ' / ' + item.count + '</span></li>').join('');
    const mnemos = hero.mnemos.map(card => '<li><span>' + escape(card.name)
      + (window.ATO_BATTLE_ASSETS?.hasMnemos(card.id) ? ' <button type="button" data-mnemos-preview="' + escape(card.id)
        + '" data-card-name="' + escape(card.name) + '">查看卡图</button>' : '')
      + '</span><small>' + escape(card.id) + ' · ' + (card.fated ? '命业旧忆' : escape(card.progress) + '/' + escape(card.limit))
      + '</small></li>').join('');
    const condition = editable ? '<select data-condition="' + seat + '" aria-label="' + escape(hero.name) + '的泰坦状态">'
      + Object.entries(conditionNames).map(([key, label]) => '<option value="' + key + '"' + (key === hero.condition ? ' selected' : '') + '>' + label + '</option>').join('')
      + '</select>' : conditionNames[hero.condition];
    const last = state.rolls.find(roll => roll.seat === seat);
    const summary = last ? '<p class="battle-room-result">最近一次掷骰 · ' + rollSummary(last) + '</p>' : '';
    return '<article class="battle-room-hero"><header><div><h3>' + escape(hero.name) + '</h3><div>' + titan + titanPreview + '</div></div><small>'
      + escape(hero.player || '待认领') + '</small></header><div class="battle-room-stats"><div>凶险 '
      + buttons('stat', 'danger', hero.stats.danger, seat, '凶险', 30, editable) + '</div><div>泰坦状态 ' + condition + '</div></div>'
      + '<h4>装备</h4>' + (gear ? '<ul>' + gear + '</ul>' : '<p>未分配装备</p>')
      + '<h4>旧忆</h4>' + (mnemos ? '<ul>' + mnemos + '</ul>' : '<p>暂无旧忆卡牌</p>')
      + summary + '</article>';
  }

  function rollSummary(roll) {
    const symbols = roll.dice.filter(die => die.symbols).reduce((totals, die) => totals.map((value, index) => value + die.symbols[index]), [0, 0, 0]);
    return roll.dice.map(({ kind, value, symbols: face }) => diceNames[kind] + ' ' + (face ? face.join('/') : value)).join('、')
      + (roll.dice.some(die => die.symbols) ? '（共 ' + symbols[0] + ' 威力、' + symbols[1] + ' 潜能、' + symbols[2] + ' ●）' : '');
  }

  function diceForm() {
    if (state.closed || actor.role === 'viewer') return '';
    const options = actor.role === 'host' ? state.heroes.map((hero, index) =>
      '<option value="' + index + '"' + (String(index) === diceDraft.seat ? ' selected' : '') + '>' + escape(hero.name) + '</option>').join('') : '';
    const limits = { d10: 6, armor: 6, red: 6, black: 4, white: 4 };
    return '<form data-roll class="battle-room-dice"><h3>掷骰</h3><div>'
      + (options ? '<label>英雄 <select name="seat">' + options + '</select></label>' : '')
      + Object.entries(limits).map(([die, max]) => '<label>' + diceNames[die] + '<input type="number" min="0" max="' + max + '" name="' + die
        + '" value="' + escape(diceDraft[die] ?? (die === 'd10' ? 1 : 0)) + '" required></label>').join('')
      + '<button type="submit">掷骰</button></div></form>';
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
    const pool = Object.entries(poolNames).map(([key, label]) => '<div>' + label
      + buttons('pool', key, state.pool[key], undefined, label, 99, edit) + '</div>').join('');
    const heroes = state.heroes.map(heroCard);
    const own = role === 'player' ? '<h3 class="battle-room-heading">我的英雄</h3>' + heroes[seat] : '';
    const overview = role === 'player'
      ? '<details class="battle-room-team"' + (content.querySelector('.battle-room-team')?.open ? ' open' : '')
        + '><summary>队伍状态</summary><div class="battle-room-grid">' + heroes.filter((_, index) => index !== seat).join('') + '</div></details>'
      : '<div class="battle-room-grid">' + heroes.join('') + '</div>';
    const rolls = state.rolls.map(roll => '<li><strong>第 ' + roll.round + ' 轮 · ' + escape(roll.hero) + '</strong>　' + rollSummary(roll) + '</li>').join('');
    const active = document.activeElement;
    const focus = active && content.contains(active) ? [...content.querySelectorAll('button,select,input')].indexOf(active) : -1;
    const selection = focus >= 0 && active.name;
    if (selection && active.form?.matches('[data-roll]')) diceDraft = Object.fromEntries(new FormData(active.form));
    content.innerHTML = '<div class="battle-room-head"><div><h2>' + escape(state.title) + '</h2><p>第 ' + state.round
      + ' 轮' + (state.closed ? ' · 已结束' : '') + '</p></div><div>' + controls + '</div></div>' + links + own
      + '<section class="battle-room-pool"><h3>克拉托斯池</h3><div>' + pool + '</div></section>' + diceForm()
      + (role !== 'player' ? '<h3 class="battle-room-heading">状态总览</h3>' : '') + overview
      + '<section class="battle-room-rolls"><h3>掷骰记录</h3>' + (rolls ? '<ol>' + rolls + '</ol>' : '<p>还没有掷骰。</p>') + '</section>';
    if (focus >= 0) {
      const target = content.querySelectorAll('button,select,input')[focus];
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
      const suggested = document.querySelector('#title')?.textContent?.trim() || '决战';
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
    if (event.target.form?.matches('[data-roll]')) diceDraft = Object.fromEntries(new FormData(event.target.form));
  });

  content.addEventListener('change', event => {
    if (event.target.matches('[data-condition]')) {
      void send({ id: crypto.randomUUID(), type: 'condition', seat: Number(event.target.dataset.condition), value: event.target.value });
    }
  });

  document.addEventListener('ato-battle-assets', () => { if (state) render(); });

  content.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    const { roomCopy, action, key, seat, delta } = button.dataset;
    if (button.dataset.gearPreview) {
      await window.ATO_BATTLE_ASSETS?.showGear(button.dataset.gearPreview, button.dataset.gearName);
    } else if (button.dataset.titanPreview) {
      window.ATO_BATTLE_ASSETS?.showTitan(state.heroes[Number(button.dataset.titanPreview)].titan);
    } else if (button.dataset.mnemosPreview) {
      window.ATO_BATTLE_ASSETS?.showMnemos(button.dataset.mnemosPreview, button.dataset.cardName);
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
      diceDraft = Object.fromEntries(fields);
      const seat = actor.role === 'host' ? Number(fields.get('seat')) : actor.seat;
      const counts = Object.fromEntries(Object.keys(diceNames).filter(kind => kind !== 'crit').map(kind => [kind, Number(fields.get(kind))]));
      void send({ id: crypto.randomUUID(), type: 'roll', seat, counts });
      return;
    }
    if (pending) return;
    pending = true;
    form.querySelector('button[type=submit]').disabled = true;
    try {
      if (form.matches('[data-create]')) {
        const data = await request('create', { title: fields.get('title'), heroIds: fields.getAll('heroIds') });
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
        if (response.ok && (await response.json()).backend === 'cloudflare') toggle.hidden = false;
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
