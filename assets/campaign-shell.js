(() => {
  const traumaIcon = '<path d="M15.5 3H6a2 2 0 0 0-2 2v11m15.5-10H9a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2Z"/><path d="M15 8.8 11.8 14h3l-1.5 4.2 4.4-5.9h-3.1Z"/>';
  const squadIcon = '<circle cx="12" cy="7" r="2.7"/><path d="M7.4 20v-2.4a4.6 4.6 0 0 1 9.2 0V20M6.5 8.3a2.1 2.1 0 1 0-2.2 3.3M17.5 8.3a2.1 2.1 0 1 1 2.2 3.3M5.5 14a3.8 3.8 0 0 0-3 3.8v1.6M18.5 14a3.8 3.8 0 0 1 3 3.8v1.6"/>';

  function createSidebar(links) {
    const sidebar = document.createElement('aside');
    sidebar.className = 'art-sidebar';
    sidebar.innerHTML = '<div class="art-sidebar-brand">ATO</div>'
      + '<a class="art-sidebar-tab art-sidebar-home" href="/#dashboard" data-page-router-ignore="true"><span aria-hidden="true">▦</span>主控台</a>'
      + '<a class="art-sidebar-tab art-sidebar-settings" href="/#settings" data-page-router-ignore="true"><span aria-hidden="true">⚙</span>设置</a>';
    sidebar.querySelector('.art-sidebar-settings').before(links);
    return sidebar;
  }

  function setSidebarIcon(link, paths) {
    if (!link) return;
    const icon = document.createElement('span');
    icon.className = 'art-sidebar-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    link.querySelector('.nav-icon')?.remove();
    link.prepend(icon);
  }

  function mountModuleSidebar() {
    const modules = [
      { path: '/record', label: '阿尔戈号', icon: 'argo', cycle: true },
      { path: '/hero', label: '英雄', icon: 'argonauts', cycle: true },
      { path: '/aibp', label: '骇物', icon: 'evolution', cycle: true },
      { path: '/technology', label: '科技', icon: 'technology' },
      { path: '/map', label: '地图', icon: 'map', cycle: true },
      { path: '/story', label: '剧情书', icon: 'story', cycle: true },
      { path: '/theatre', label: '幻忆剧场', glyph: '<path d="M3 4h18v5H3zm0 10h18v6H3zm4-10v16m10-16v16"/><path d="M3 9v5m18-5v5"/>', cycle: true },
      { path: '/aibp/trauma', label: '创伤牌库', glyph: traumaIcon, direct: true },
      { path: '/aibp/squads', label: '联机小队', glyph: squadIcon, direct: true }
    ];
    const path = location.pathname.replace(/\/+$/, '').replace(/\/index\.html$/, '').replace(/\.html$/, '');
    const activePath = path === '/aibp/squad' ? '/aibp/squads' : path;
    if (window.top !== window || (path !== '/briefing' && !modules.some(module => module.path === activePath))) return;

    const nav = document.createElement('nav');
    nav.className = 'art-module-links';
    nav.setAttribute('aria-label', '战役工具');
    const links = modules.map(module => {
      const link = document.createElement('a');
      link.className = 'art-sidebar-tab';
      link.textContent = module.label;
      if (module.direct) link.dataset.pageRouterIgnore = 'true';
      if (activePath === '/story' && ['/record', '/hero'].includes(module.path)) link.dataset.storySideRecord = 'true';
      if (module.path === activePath) link.setAttribute('aria-current', 'page');
      if (module.glyph) setSidebarIcon(link, module.glyph);
      if (module.icon) {
        const icon = document.createElement('span');
        icon.className = 'art-sidebar-mask';
        icon.setAttribute('aria-hidden', 'true');
        icon.style.setProperty('--art-icon-src', `url("/assets/icons/${module.icon}.svg")`);
        link.prepend(icon);
      }
      nav.append(link);
      return link;
    });

    function updateLinks() {
      const candidates = [
        document.body.dataset.cycle,
        new URLSearchParams(location.search).get('cycle')
      ];
      let theatreUnlocked = false;
      try {
        candidates.push(localStorage.getItem('ato-theme-cycle-v1'));
      } catch {}
      const cycle = candidates.find(candidate => /^c[1-5]$/.test(candidate ?? '')) || 'c1';
      try {
        theatreUnlocked = localStorage.getItem(`ato-art-theatre-${cycle}`) === 'open';
      } catch {}
      modules.forEach((module, index) => {
        const url = new URL(module.path + (module.direct ? '' : '/index.html'), location.origin);
        if (module.cycle) url.searchParams.set('cycle', cycle);
        if (module.path === '/story') url.searchParams.set('book', cycle);
        const voyage = window.ATO_VOYAGE;
        links[index].href = links[index].dataset.storySideRecord && voyage?.current()
          ? voyage.storyRecordUrl(url.href) : url.pathname + url.search;
        if (module.path === '/theatre') links[index].hidden = activePath !== '/theatre' && !theatreUnlocked;
      });
    }

    document.body.classList.add('art-module-shell');
    document.body.prepend(createSidebar(nav));
    new MutationObserver(updateLinks).observe(document.body, { attributes: true, attributeFilter: ['data-cycle'] });
    window.addEventListener('storage', event => {
      if (event.key === 'ato-theme-cycle-v1' || event.key?.startsWith('ato-art-theatre-')) updateLinks();
    });
    updateLinks();
  }

  function installDateTrack(panel, list) {
    const controls = document.createElement('div');
    controls.className = 'art-date-controls';
    controls.innerHTML = '<button type="button" class="secondary" data-dashboard-readonly-allowed aria-label="向前浏览日期" aria-controls="dateTrackList">‹</button>'
      + '<button type="button" class="secondary" data-dashboard-readonly-allowed aria-controls="dateTrackList">定位今日</button>'
      + '<button type="button" class="secondary" data-dashboard-readonly-allowed aria-label="向后浏览日期" aria-controls="dateTrackList">›</button>';
    panel.querySelector('.panel-head').append(controls);
    const [previous, today, next] = controls.querySelectorAll('button');

    function centerCurrent(current, behavior = 'instant') {
      const offset = current.getBoundingClientRect().left - list.getBoundingClientRect().left;
      list.scrollTo({ left: list.scrollLeft + offset - (list.clientWidth - current.offsetWidth) / 2, behavior });
    }

    previous.addEventListener('click', () => list.scrollBy({ left: -list.clientWidth * 0.8, behavior: 'auto' }));
    next.addEventListener('click', () => list.scrollBy({ left: list.clientWidth * 0.8, behavior: 'auto' }));
    today.addEventListener('click', () => {
      const current = list.querySelector('[aria-current="date"]');
      if (current) centerCurrent(current, 'auto');
    });

    let lastDate;
    function syncTrack() {
      if (!list.clientWidth) return;
      const current = list.querySelector('[aria-current="date"]');
      controls.hidden = !current;
      if (!current) {
        lastDate = undefined;
        return;
      }
      const date = document.body.dataset.cycle + ':' + current.querySelector('.date-track-day')?.textContent;
      if (date === lastDate) return;
      lastDate = date;
      centerCurrent(current);
    }

    const observer = new MutationObserver(syncTrack);
    observer.observe(list, { childList: true });
    const resizeObserver = new ResizeObserver(syncTrack);
    resizeObserver.observe(list);
    syncTrack();
  }

  function makeFloatingLog(section, notes) {
    const dock = document.createElement('details');
    dock.className = 'art-log-dock';
    const summary = document.createElement('summary');
    const title = section.querySelector('h2');
    summary.append(...title.childNodes);
    summary.setAttribute('aria-controls', notes.id);
    notes.setAttribute('aria-labelledby', 'art-log-label');
    summary.id = 'art-log-label';
    const body = section.querySelector('.panel-body');
    dock.append(summary, body);
    section.remove();
    dock.addEventListener('toggle', () => {
      if (dock.open) notes.scrollTop = notes.scrollHeight;
    });
    return dock;
  }

  const shell = document.querySelector('#appShell');
  const navigation = shell?.querySelector('.dashboard-navigation');
  const links = navigation?.querySelector('.record-links');
  const account = shell?.querySelector('.session-card')?.closest('section.panel');
  const preferences = shell?.querySelector('.misc-settings-panel');
  const grid = account?.closest('.grid');
  const updates = shell?.querySelector('.app-updates');
  if (!links || !account || !preferences || !grid || !updates) {
    mountModuleSidebar();
    return;
  }
  const stack = account.parentElement;

  const status = links.querySelector('#campaignSaveStatus');
  if (status) navigation.prepend(status);
  setSidebarIcon(links.querySelector('[data-online-trauma]'), traumaIcon);
  setSidebarIcon(links.querySelector('[data-online-squads]'), squadIcon);

  const sidebar = createSidebar(links);
  const home = sidebar.querySelector('.art-sidebar-home');
  const settingsLink = sidebar.querySelector('.art-sidebar-settings');
  home.href = '#dashboard';
  settingsLink.href = '#settings';
  shell.prepend(sidebar);
  grid.classList.add('art-dashboard-content');

  const theatre = links.querySelector('#theatreLink');
  if (theatre) {
    function updateTheatreAvailability() {
      const cycle = document.body.dataset.cycle;
      if (shell.hidden || !/^c[1-5]$/.test(cycle ?? '')) return;
      try {
        const key = `ato-art-theatre-${cycle}`;
        if (theatre.hidden) localStorage.removeItem(key);
        else localStorage.setItem(key, 'open');
      } catch {}
    }
    const theatreObserver = new MutationObserver(updateTheatreAvailability);
    theatreObserver.observe(theatre, { attributes: true, attributeFilter: ['hidden'] });
    theatreObserver.observe(shell, { attributes: true, attributeFilter: ['hidden'] });
    theatreObserver.observe(document.body, { attributes: true, attributeFilter: ['data-cycle'] });
    updateTheatreAvailability();
  }

  const settings = document.createElement('section');
  settings.className = 'art-settings-view';
  settings.setAttribute('aria-labelledby', 'art-settings-heading');
  settings.innerHTML = '<header class="art-settings-heading"><h1 id="art-settings-heading">设置</h1></header>'
    + '<div class="art-settings-panels"></div>';
  settings.querySelector('.art-settings-panels').append(account, preferences);
  settings.append(updates);
  grid.after(settings);
  shell.classList.add('art-dashboard-shell');

  const dateList = grid.querySelector('#dateTrackList');
  const datePanel = dateList?.closest('section.panel');
  if (datePanel) {
    grid.prepend(datePanel);
    installDateTrack(datePanel, dateList);
  }
  const notes = grid.querySelector('#notesInput');
  const logPanel = notes?.closest('section.panel');
  if (logPanel) grid.append(makeFloatingLog(logPanel, notes));
  if (!stack.children.length) stack.remove();

  function renderView() {
    const showSettings = location.hash === '#settings';
    shell.dataset.artView = showSettings ? 'settings' : 'dashboard';
    settings.hidden = !showSettings;
    home.toggleAttribute('aria-current', !showSettings);
    settingsLink.toggleAttribute('aria-current', showSettings);
    (showSettings ? settingsLink : home).setAttribute('aria-current', 'page');
  }

  for (const link of [home, settingsLink]) {
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (location.hash !== link.hash) history.pushState(null, '', link.hash);
      renderView();
      window.scrollTo(0, 0);
    });
  }
  window.addEventListener('popstate', renderView);
  window.addEventListener('hashchange', renderView);
  renderView();
})();
