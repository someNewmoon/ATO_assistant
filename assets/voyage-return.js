(() => {
  const key = id => 'ato-voyage:' + id;
  const validId = id => /^[0-9a-f-]{36}$/.test(id || '');
  const route = new URL(location.href);

  function read(id) {
    if (!validId(id)) return null;
    try {
      const entry = JSON.parse(localStorage.getItem(key(id)));
      return entry?.id === id ? entry : null;
    } catch {
      return null;
    }
  }

  function write(entry) {
    localStorage.setItem(key(entry.id), JSON.stringify(entry));
    return entry;
  }

  function create(fields, id = crypto.randomUUID()) {
    return read(id) || write({ ...fields, id });
  }

  function current() {
    return read(route.searchParams.get('voyage'));
  }

  function carry(href, entry) {
    const url = new URL(href, location.href);
    if (url.origin === location.origin && entry) url.searchParams.set('voyage', entry.id);
    return url.href;
  }

  function resumeUrl(entry) {
    const table = /^table-([0-9a-f]{32})$/.exec(entry?.battle || '');
    const online = /^online-([0-9a-f]{32})-\d+$/.exec(entry?.battle || '');
    if (!table && !online) return '';
    const url = new URL('/aibp/index.html', location.origin);
    if (entry.story) url.searchParams.set('storyReturn', entry.story);
    url.searchParams.set(table ? 'tableBattle' : 'battle', (table || online)[1]);
    return carry(url.href, entry);
  }

  function returnUrl(entry = current()) {
    const url = new URL('/index.html', location.origin);
    if (entry) url.searchParams.set('returnVoyage', entry.id);
    return url.href;
  }

  function storyUrl(value = route.searchParams.get('storyReturn')) {
    if (!value) return '';
    const url = new URL(value, location.href);
    if (url.origin !== location.origin || !/^\/story\/(?:index\.html)?$/.test(url.pathname)) return '';
    const allowed = ['book', 'cycle', 'chapter', 'encounter', 'entry', 'key', 'squad'];
    for (const name of [...url.searchParams.keys()]) if (!allowed.includes(name)) url.searchParams.delete(name);
    return url.pathname + url.search;
  }

  function bind(entry, battle) {
    const latest = read(entry?.id);
    if (!latest?.encounter || (latest.battle && latest.battle !== battle)) return false;
    if (!latest.battle) write({ ...latest, battle, story: storyUrl() });
    return true;
  }

  function settle(entry, battle, result) {
    const latest = read(entry?.id);
    if (!latest?.encounter || latest.battle !== battle) return false;
    if (!latest.result) write({ ...latest, result });
    return true;
  }

  function navigate(href, insideGesture = false) {
    if (window.ATO_PAGE_ROUTER?.focusOrNavigate) {
      return window.ATO_PAGE_ROUTER.focusOrNavigate(href, { insideGesture });
    }
    location.assign(href);
  }

  function wireReturn(selector, beforeReturn = async () => true) {
    const entry = current();
    if (!entry) return;
    for (const anchor of document.querySelectorAll(selector)) {
      anchor.href = returnUrl(entry);
      anchor.textContent = '返回航行';
      anchor.addEventListener('click', async event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        try {
          if (!await beforeReturn()) throw new Error('当前修改尚未保存，请重试。');
          await navigate(anchor.href);
        } catch (error) {
          window.alert(error.message);
        }
      });
    }
  }

  window.ATO_VOYAGE = { read, create, current, carry, resumeUrl, returnUrl, storyUrl, bind, settle, navigate, wireReturn };
})();
