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
    let url;
    try { url = new URL(value, location.href); } catch { return ''; }
    if (url.origin !== location.origin || !/^\/story\/(?:index\.html)?$/.test(url.pathname)) return '';
    const allowed = ['book', 'cycle', 'chapter', 'module', 'encounter', 'entry', 'key', 'squad'];
    for (const name of [...url.searchParams.keys()]) if (!allowed.includes(name)) url.searchParams.delete(name);
    return url.pathname + url.search;
  }

  function storyRecordUrl(href) {
    const url = new URL(href, location.href);
    const story = storyUrl(location.href);
    if (story) url.searchParams.set('returnStory', story);
    return carry(url.href, current());
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

  function navigate(href, insideGesture = false, { sameTab = false } = {}) {
    if (!sameTab && window.ATO_PAGE_ROUTER?.focusOrNavigate) {
      return window.ATO_PAGE_ROUTER.focusOrNavigate(href, { insideGesture });
    }
    location.assign(href);
  }

  function wireReturn(selector, beforeReturn = async () => true, { toStory = false, storyReader = false } = {}) {
    const entry = current();
    const story = toStory && storyUrl(route.searchParams.get('returnStory'));
    if (!story && !entry) return;
    const href = story ? carry(story, entry) : returnUrl(entry);
    const label = story ? '保存并返回故事段落'
      : storyReader && entry.step === 'story' ? '返回航行 · 剧情'
      : storyReader && entry.step === 'explore' && entry.explorationRound ? '返回航行 · 探索' : '返回航行';
    for (const anchor of document.querySelectorAll(selector)) {
      anchor.href = href;
      anchor.textContent = label;
      anchor.hidden = false;
      const feedback = storyReader ? document.createElement('span') : null;
      if (feedback) {
        feedback.className = 'reader-voyage-feedback';
        feedback.setAttribute('role', 'status');
        feedback.hidden = true;
        anchor.after(feedback);
      }
      let returning = false;
      anchor.addEventListener('click', async event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (returning) return;
        returning = true;
        anchor.setAttribute('aria-busy', 'true');
        if (feedback) {
          feedback.hidden = false;
          feedback.textContent = '正在返回航行…';
        }
        try {
          if (!await beforeReturn()) throw new Error('当前修改尚未保存，请重试。');
          const usedDashboard = await navigate(anchor.href, false, { sameTab: !story && entry?.sameTab });
          if (feedback && usedDashboard) feedback.textContent = '主控台已收到返回请求，请切换到主控台标签页查看。';
        } catch (error) {
          if (feedback) feedback.textContent = error.message;
          else window.alert(error.message);
        } finally {
          returning = false;
          anchor.removeAttribute('aria-busy');
        }
      });
    }
  }

  window.ATO_VOYAGE = { read, create, current, carry, resumeUrl, returnUrl, storyUrl, storyRecordUrl, bind, settle, navigate, wireReturn };
})();
