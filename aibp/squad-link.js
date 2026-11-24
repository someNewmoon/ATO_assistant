(() => {
  const prefix = 'ato-aibp-room-';
  const validId = id => /^[a-f0-9]{32}$/.test(id || '');
  const validKey = key => /^[a-f0-9]{64}$/.test(key || '');
  const sharedOrigin = () => location.hostname === 'ato-moon-assistant.pages.dev' ? 'https://moon.xuzizi.cn' : location.origin;
  function read(id) {
    try { return JSON.parse(localStorage.getItem(prefix + id)); } catch { return null; }
  }
  function save(id, credentials) {
    try {
      localStorage.setItem(prefix + id, JSON.stringify(credentials));
      localStorage.setItem('ato-last-squad', id);
      return true;
    } catch { return false; }
  }
  function localHost(id) {
    if (!validId(id)) return null;
    const credentials = read(id);
    return validKey(credentials?.token) && credentials.keys?.host === credentials.token ? { id, credentials } : null;
  }
  function recentHost() {
    try { return localHost(localStorage.getItem('ato-last-squad')); } catch { return null; }
  }
  async function listedHost() {
    try {
      const response = await fetch('/api/battle-room/open', { cache: 'no-store', signal: AbortSignal.timeout(4500) });
      if (!response.ok) return null;
      const { rooms } = await response.json();
      return rooms.filter(room => room.squad).map(room => localHost(room.id)).find(Boolean) || null;
    } catch { return null; }
  }
  function forget(id) {
    try {
      localStorage.removeItem(prefix + id);
      if (localStorage.getItem('ato-last-squad') === id) localStorage.removeItem('ato-last-squad');
    } catch { /* Storage is optional. */ }
  }
  async function home(linked, { signal = AbortSignal.timeout(10000) } = {}) {
    const response = await fetch('/api/battle-room/home', {
      cache: 'no-store', signal,
      ...(linked && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(linked) }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      const error = new Error(data?.error || '暂时无法读取当前存档的小队。');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function link(path, id, field, key, share = false) {
    const url = new URL(path, share ? sharedOrigin() : location.origin);
    url.searchParams.set(path === '/aibp/room' ? 'battle' : 'squad', id);
    if (key) url.hash = new URLSearchParams({ [field]: key });
    return url.href;
  }
  async function request(id, route, token, body, { timeout = 12000 } = {}) {
    if (!validId(id)) throw new Error('小队链接无效。');
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch('/api/battle-room/' + id + '/' + route, {
      cache: 'no-store', signal: AbortSignal.timeout(timeout), headers,
      ...(body !== undefined && { method: 'POST', body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      const error = new Error(data?.error || '暂时无法连接联机小队。');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function watchSocket(socket, disconnect) {
    let timer;
    function activity() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) return disconnect();
        try { socket.send('{"type":"ping"}'); }
        catch { return disconnect(); }
        timer = setTimeout(disconnect, 10000);
      }, 25000);
    }
    socket.addEventListener('message', activity);
    activity();
    return () => {
      clearTimeout(timer);
      socket.removeEventListener('message', activity);
    };
  }

  function connect(id, token, receive, status, { timeout: connectTimeout = 12000, projection = false } = {}) {
    const url = new URL('/api/battle-room/' + id + '/socket', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (projection) url.searchParams.set('projection', '1');
    let socket, timer, close, stopped = false, delay = 1000;
    function open() {
      if (stopped || socket) return;
      const current = new WebSocket(url, ['ato-battle-v1', token]);
      socket = current;
      let unwatch, ready = false;
      const timeout = setTimeout(() => disconnect(), connectTimeout);
      function disconnect(code) {
        if (socket !== current) return;
        socket = null;
        clearTimeout(timeout);
        unwatch?.();
        if (current.readyState < WebSocket.CLOSING) current.close();
        if (stopped) return;
        if (code === 4001) {
          stop();
          status?.('你的英雄席位已释放或被接管，请重新加入小队。', code);
          return;
        }
        status?.('连接中断，正在重连…');
        timer = setTimeout(open, delay);
        delay = Math.min(delay * 2, 15000);
      }
      close = disconnect;
      current.onmessage = event => {
        if (socket !== current) return;
        const data = JSON.parse(event.data);
        if (!data.room) return;
        clearTimeout(timeout);
        delay = 1000;
        if (data.socketHeartbeat && !unwatch) unwatch = watchSocket(current, disconnect);
        receive(data);
        if (!ready && socket === current) {
          ready = true;
          status?.('');
        }
      };
      current.onclose = event => disconnect(event.code);
    }
    function reconnect() {
      clearTimeout(timer);
      if (socket?.readyState >= WebSocket.CLOSING) close();
      clearTimeout(timer);
      open();
    }
    function stop() {
      stopped = true;
      clearTimeout(timer);
      close?.();
      window.removeEventListener('online', reconnect);
    }
    if (validId(id) && validKey(token)) {
      window.addEventListener('online', reconnect);
      open();
    }
    return stop;
  }
  function language(value) {
    const apply = () => window.ATO_LANGUAGE?.set(value, false);
    if (window.ATO_LANGUAGE) apply();
    else document.addEventListener('DOMContentLoaded', apply, { once: true });
  }
  function celebrateCritical(name, damage) {
    let notice = document.querySelector('.battle-critical-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'battle-critical-notice';
      notice.setAttribute('role', 'status');
      document.body.append(notice);
    }
    const result = document.createElement('div');
    result.className = 'battle-critical-result';
    const title = document.createElement('strong');
    title.textContent = '暴击';
    const detail = document.createElement('span');
    detail.textContent = [name, '+' + damage + ' 损伤'].filter(Boolean).join(' · ');
    result.append(title, detail);
    notice.replaceChildren(result);
    window.setTimeout(() => result.remove(), 2000);
  }

  function recapMarkup(recap) {
    if (!recap) return '';
    const { escape, heroPortrait } = window.ATO_HERO_CATALOG;
    const spotlight = recap.heroes.find(hero => hero.id === recap.mvp);
    const total = recap.heroes.reduce((sum, hero) => sum + (hero.damage ?? 0), 0);
    return '<section class="room-battle-recap"><h3>第 ' + recap.battleNumber + ' 场 · 战斗称号</h3>'
      + '<p>' + escape(recap.apostle) + ' · 第 ' + recap.round + ' 轮结束'
      + (spotlight ? ' · ' + (recap.spotlights ? '全场最佳 ' : '本场特别提名 ') + escape(spotlight.name) : '') + '</p>'
      + '<p class="room-damage-recap"><strong>小队造成 ' + total + ' 损伤</strong></p>'
      + '<ul>' + recap.heroes.map(hero => {
        const portrait = heroPortrait(hero);
        const metrics = [hero.damage == null ? '' : '损伤 ' + hero.damage,
          hero.criticals ? '暴击 ' + hero.criticals + ' 次' : '', '投掷 ' + hero.rolls, '赞同 ' + hero.likes, '表态 ' + hero.feedback].filter(Boolean);
        return '<li>' + (portrait ? '<img alt="" src="../hero/assets/' + escape(portrait) + '">' : '')
          + '<div><strong>' + escape(hero.name) + ' · ' + escape(hero.title) + '</strong>'
          + (hero.reason ? '<div>' + escape(hero.reason) + '</div>' : '')
          + '<small>' + metrics.join(' · ') + '</small></div></li>';
      }).join('') + '</ul></section>';
  }

  window.ATO_SQUAD_LINK = { read, save, forget, recentHost, listedHost, home, link, request, connect, watchSocket, language, validId, validKey, sharedOrigin, recapMarkup, celebrateCritical };
})();
