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
  function link(path, id, field, key, share = false) {
    const url = new URL(path, share ? sharedOrigin() : location.origin);
    url.searchParams.set(path === '/aibp/room' ? 'battle' : 'squad', id);
    if (key) url.hash = new URLSearchParams({ [field]: key });
    return url.href;
  }
  async function request(id, route, token, body) {
    if (!validId(id)) throw new Error('小队链接无效。');
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch('/api/battle-room/' + id + '/' + route, {
      cache: 'no-store', signal: AbortSignal.timeout(12000), headers,
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
  function connect(id, token, receive, status) {
    const url = new URL('/api/battle-room/' + id + '/socket', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket, timer, stopped = false, delay = 1000;
    function open() {
      socket = new WebSocket(url, ['ato-battle-v1', token]);
      const timeout = setTimeout(() => socket.close(), 12000);
      socket.onopen = () => { clearTimeout(timeout); delay = 1000; status?.(''); };
      socket.onmessage = event => receive(JSON.parse(event.data));
      socket.onclose = () => {
        clearTimeout(timeout);
        if (stopped) return;
        status?.('连接中断，正在重连…');
        timer = setTimeout(open, delay);
        delay = Math.min(delay * 2, 15000);
      };
    }
    if (validId(id) && validKey(token)) open();
    return () => { stopped = true; clearTimeout(timer); socket?.close(); };
  }
  function language(value) {
    const apply = () => window.ATO_LANGUAGE?.set(value, false);
    if (window.ATO_LANGUAGE) apply();
    else document.addEventListener('DOMContentLoaded', apply, { once: true });
  }
  window.ATO_SQUAD_LINK = { read, save, link, request, connect, language, validId, validKey, sharedOrigin };
})();
