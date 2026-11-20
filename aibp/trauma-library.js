(() => {
  const endpoint = '/api/campaign-state.php?action=trauma-library';
  const { TRAUMA_DECKS: decks } = window.ATO_GEAR_INVENTORY;
  const library = document.querySelector('[data-library]');
  const cards = document.querySelector('[data-cards]');
  const tabs = document.querySelector('[data-decks]');
  const status = document.querySelector('#squadStatus');
  const reload = document.querySelector('[data-reload]');
  let saved;
  let selected = 'light';
  let busy = false;

  function render() {
    library.querySelector('[data-save-name]').textContent = saved.saveName + ' · 故事集 ' + saved.cycle.slice(1);
    const counts = {};
    for (const card of saved.catalog) {
      if (card.enabled && !card.threshold && card.id !== 'AM0360') counts[card.deck] = (counts[card.deck] || 0) + 1;
    }
    tabs.replaceChildren(...Object.entries(decks).map(([deck, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.deck = deck;
      button.setAttribute('aria-pressed', String(deck === selected));
      button.textContent = label + ' · ' + (counts[deck] || 0);
      return button;
    }));
    const duplicates = new Map();
    for (const card of saved.catalog) duplicates.set(card.name, (duplicates.get(card.name) || 0) + 1);
    cards.replaceChildren(...saved.catalog.filter(card => card.deck === selected).map(card => {
      const row = document.createElement('article');
      row.className = 'squad-gear-card';
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.card = card.id;
      input.checked = card.enabled;
      input.disabled = Boolean(card.threshold);
      label.append(input, card.name + (duplicates.get(card.name) > 1 ? ' · ' + card.id.split('_').pop().toUpperCase() : ''));
      row.append(label);
      if (card.art) {
        const image = document.createElement('img');
        image.src = './images/trauma/' + encodeURIComponent(card.art);
        image.alt = '';
        image.loading = 'lazy';
        image.setAttribute('data-gear-image', '');
        row.append(image);
      }
      if (card.threshold || card.id === 'AM0360') {
        const rule = document.createElement('small');
        rule.className = 'squad-sub';
        rule.textContent = '凶险达到 ' + (card.threshold || 21) + ' 时按规则加入';
        row.append(rule);
      }
      return row;
    }));
    library.hidden = false;
  }

  async function read(change) {
    const response = await fetch(endpoint, {
      cache: 'no-store', signal: AbortSignal.timeout(12000),
      ...(change && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 401 ? '请先从主控台登录，再打开创伤牌库。' : data.error);
    return data;
  }

  async function load() {
    if (busy) return;
    busy = true;
    reload.hidden = true;
    try {
      saved = await read();
      render();
      status.textContent = '';
    } catch (error) {
      library.hidden = !saved;
      status.textContent = error.message;
      reload.hidden = false;
    } finally { busy = false; }
  }

  tabs.addEventListener('click', event => {
    const deck = event.target.closest('[data-deck]')?.dataset.deck;
    if (!deck || busy) return;
    selected = deck;
    render();
    tabs.querySelector('[aria-pressed="true"]').focus();
  });

  cards.addEventListener('change', async event => {
    const { card } = event.target.dataset;
    if (!card || busy) return;
    busy = true;
    cards.inert = true;
    status.textContent = '正在保存…';
    try {
      const { account, profile, cycle, revision } = saved;
      saved = await read({ expectedAccountId: account, profile, cycle, revision, card, enabled: event.target.checked });
      status.textContent = '已保存到「' + saved.saveName + '」';
    } catch (error) {
      status.textContent = error.message;
      reload.hidden = false;
    } finally {
      busy = false;
      cards.inert = false;
      render();
      cards.querySelector('[data-card="' + CSS.escape(card) + '"]')?.focus({ preventScroll: true });
    }
  });

  reload.addEventListener('click', load);
  void load();
})();
