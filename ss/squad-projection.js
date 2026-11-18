(() => {
  const id = new URLSearchParams(location.search).get('squad');
  if (!id) return;
  const api = window.ATO_SQUAD_LINK;
  const token = new URLSearchParams(location.hash.slice(1)).get('view');
  if (!api?.validId(id) || !api.validKey(token)) {
    showUnavailable('请使用房主提供的小队投屏链接。');
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'squad-check-overlay';
  overlay.setAttribute('aria-live', 'polite');
  const prep = document.createElement('p');
  prep.className = 'squad-projection-prep';
  prep.textContent = '小队备战中';
  prep.hidden = true;
  const fight = document.createElement('iframe');
  fight.className = 'squad-projection-battle';
  fight.title = '决战投屏';
  fight.hidden = true;
  document.body.append(prep, fight, overlay);
  let latestRevision = -1, battleNumber = -1, stop, preference;
  const seen = new Set();

  function showRoll(roll) {
    const item = document.createElement('article');
    if (roll.success === false) item.dataset.failed = '';
    const title = document.createElement('strong');
    title.textContent = roll.hero + ' · ' + (roll.replaces ? '命运重掷 · ' : '') + (roll.skill || (roll.target !== null ? '检定' : 'd' + roll.sides));
    const result = document.createElement('span');
    const modifier = roll.bonus + roll.modifier;
    result.textContent = roll.values.join(' + ') + (modifier ? ' ' + (modifier > 0 ? '+ ' : '− ') + Math.abs(modifier) : '')
      + ' → ' + roll.sum + (roll.target !== null ? ' / ' + roll.target + ' · ' + (roll.success ? '成功' : '失败') : '');
    item.append(title, result);
    overlay.append(item);
    while (overlay.children.length > 3) overlay.firstElementChild.remove();
    setTimeout(() => item.remove(), 7500);
  }

  function update({ room, actor }) {
    if (actor?.role !== 'viewer' || !room?.squad || room.revision <= latestRevision) return;
    const { phase, story, checks, cycle, language, battleNumber: nextBattle } = room.squad;
    latestRevision = room.revision;
    if (room.closed) {
      stop?.();
      fight.removeAttribute('src');
      fight.hidden = true;
      prep.hidden = true;
      overlay.replaceChildren();
      showUnavailable('小队已解散。');
      return;
    }
    if (language !== preference) { preference = language; api.language(language); }
    applySecondScreenTheme({ cycleId: cycle });
    if (phase === 'battle') {
      prep.hidden = true;
      fight.hidden = false;
      overlay.replaceChildren();
      if (battleNumber !== nextBattle) {
        battleNumber = nextBattle;
        const url = new URL(api.link('/aibp/room', id, 'view', token));
        url.searchParams.set('embed', '1');
        fight.src = url.href;
      }
    } else {
      if (!fight.hidden) fight.removeAttribute('src');
      fight.hidden = true;
      prep.hidden = phase !== 'prep';
      openStory({ story, cycleId: cycle });
      for (const roll of checks.slice().reverse()) {
        if (seen.has(roll.id) || Date.now() - roll.at > 9000) continue;
        seen.add(roll.id);
        showRoll(roll);
      }
    }
    if (seen.size > 120) for (const key of seen) {
      if (!checks.some(roll => roll.id === key)) seen.delete(key);
    }
  }

  function connect() {
    stop?.();
    let connected = false, stopped = false, reading = false, timer;
    async function readState() {
      timer = null;
      reading = true;
      try {
        const data = await api.request(id, 'state', token, undefined, { timeout: 22000 });
        if (stopped) return;
        if (data.actor.role !== 'viewer' || !data.room.squad) throw new Error('请打开正确的小队投屏链接。');
        update(data);
      } catch (error) {
        if (stopped) return;
        if (error.status === 401 || error.status === 403 || error.status === 404) {
          showUnavailable(error.message);
          stop?.();
          return;
        }
        if (latestRevision < 0) showUnavailable('正在重连小队投屏…');
      } finally {
        reading = false;
        if (!stopped && !connected) timer = setTimeout(readState, 4500);
      }
    }
    const close = api.connect(id, token, update, message => {
      connected = !message;
      if (connected) {
        clearTimeout(timer);
        timer = null;
      } else if (!timer && !reading) {
        timer = setTimeout(readState, 1000);
      }
    }, { timeout: 22000 });
    stop = () => {
      stopped = true;
      clearTimeout(timer);
      close();
    };
    void readState();
  }

  connect();
  window.addEventListener('pagehide', () => stop?.());
  window.addEventListener('pageshow', event => { if (event.persisted) connect(); });
})();
