(() => {
  const tabs = [...document.querySelectorAll('.record-tabs [role="tab"]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));

  function select(index, updateUrl = false) {
    tabs.forEach((tab, position) => {
      const selected = position === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[position].hidden = !selected;
    });
    if (!updateUrl) return;
    const url = new URL(location.href);
    if (index === 1) url.searchParams.set('tab', 'titans');
    else url.searchParams.delete('tab');
    if (url.href !== location.href) history.pushState(null, '', url);
  }

  function syncFromUrl() {
    select(new URLSearchParams(location.search).get('tab') === 'titans' ? 1 : 0);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index, true));
    tab.addEventListener('keydown', event => {
      const moves = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: tabs.length - 1 };
      if (!Object.hasOwn(moves, event.key)) return;
      event.preventDefault();
      const next = (moves[event.key] + tabs.length) % tabs.length;
      select(next, true);
      tabs[next].focus();
    });
  });
  window.addEventListener('popstate', syncFromUrl);
  syncFromUrl();
})();
