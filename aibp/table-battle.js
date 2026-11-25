(() => {
  const route = new URL(location.href);
  if (['battle', 'squad', 'theatreBattle'].some(key => route.searchParams.has(key))) {
    document.getElementById('newCampaignButton').hidden = true;
    return;
  }

  const squadLink = window.ATO_SQUAD_LINK;
  const deck = window.AIBP_TABLE_DECK;
  const voyage = window.ATO_VOYAGE;
  const start = document.getElementById('newCampaignButton');
  const resume = document.getElementById('continueCampaignBattle');
  const entryStatus = document.getElementById('campaignBattleStatus');
  const bar = document.getElementById('tableBattleBar');
  const prep = document.getElementById('tableBattlePrep');
  const cards = document.getElementById('tableBattleCards');
  const panel = document.getElementById('viewer');
  const status = bar.querySelector('[data-table-status]');
  const controls = Object.fromEntries([...bar.querySelectorAll('[data-table-action]')]
    .map(button => [button.dataset.tableAction, button]));
  let context, battle, busy = false;

  function activeVoyage() {
    return voyage?.read(battle?.voyage) || voyage?.current();
  }

  const returnToVoyage = document.createElement('a');
  returnToVoyage.textContent = '返回航行';
  returnToVoyage.hidden = true;
  returnToVoyage.dataset.pageRouterIgnore = 'true';
  returnToVoyage.addEventListener('click', event => {
    event.preventDefault();
    void voyage.navigate(returnToVoyage.href);
  });
  controls.finish.after(returnToVoyage);

  async function readContext() {
    const [response, home] = await Promise.all([
      fetch('../api/campaign-state.php?section=dashboard', { cache: 'no-store', signal: AbortSignal.timeout(8000) }),
      squadLink.home().catch(error => {
        if ([401, 404, 501].includes(error.status)) return null;
        throw error;
      })
    ]);
    if (!response.ok && ![401, 404].includes(response.status)) throw Error('暂时无法读取当前战役存档，请重试。');
    const data = response.ok ? await response.json() : null;
    if (response.ok && !data?.ok) throw Error('暂时无法确认当前战役存档。');
    const accountId = data?.user?.id || '';
    const profileId = data?.state?.activeProfileId || 'default';
    const activeCycle = data?.state?.profiles?.[profileId]?.activeCycleId || data?.state?.activeCycleId || '';
    const linkedId = route.searchParams.get('storySquad');
    const linked = squadLink.validId(linkedId) && squadLink.read(linkedId);
    const squad = home?.squad || (squadLink.validKey(linked?.token) ? { id: linkedId, credentials: linked } : null);
    const key = 'ato-aibp-table-current:' + JSON.stringify([accountId, profileId]);
    const day = data?.state?.profiles?.[profileId]?.cycles?.[activeCycle]?.state?.day;
    if (!squad) return { key, accountId, profileId, activeCycle, day };
    const { room, actor } = await squadLink.request(squad.id, 'state', squad.credentials.token);
    const online = !room.closed && room.squad ? { ...squad, room, actor } : null;
    return { key, accountId, profileId, activeCycle, day, online };
  }

  function saved(key) {
    const raw = localStorage.getItem(key);
    try {
      const entry = JSON.parse(raw);
      if (squadLink.validId(entry?.id) && ['play', 'loot', 'settled'].includes(entry.stage)) return entry;
    } catch { /* Ignore old or incomplete entries. */ }
    return null;
  }

  function store(entry) {
    localStorage.setItem(context.key, JSON.stringify(entry));
  }

  function showStage() {
    const stage = battle.stage;
    document.body.dataset.tableBattle = stage;
    controls.cards.hidden = stage === 'settled';
    controls.panel.hidden = stage === 'settled';
    controls.settle.hidden = stage === 'settled';
    controls.settle.textContent = stage === 'loot' ? '查看战利品' : '结束桌战';
    controls.resume.hidden = stage !== 'loot';
    controls.finish.hidden = stage === 'play';
    controls.finish.textContent = stage === 'loot' ? '结束（不入账）' : (battle.returnTo ? '返回战后剧情' : '结束并返回');
    returnToVoyage.hidden = !activeVoyage();
    if (!returnToVoyage.hidden) returnToVoyage.href = voyage.returnUrl(activeVoyage());
    cards.inert = stage !== 'play';
    panel.inert = stage !== 'play';
    status.textContent = {
      play: '',
      loot: '确认本场结果与战利品后入账，也可返回牌桌更正。',
      settled: '本场桌战已结束。'
    }[stage];
  }

  function setStage(stage, result) {
    if (saved(context.key)?.id !== battle.id) throw Error('当前桌战已在另一个页面变更，请刷新查看。');
    const next = { ...battle, stage, ...(result && { result }) };
    store(next);
    battle = next;
    if (result && battle.voyage) voyage.settle(activeVoyage(), 'table-' + battle.id, result);
    showStage();
  }

  async function openTable(entry) {
    const source = voyage?.current();
    if (source?.encounter && source.id !== entry.voyage) throw Error('另有一场桌战，需先结束该场战斗。');
    if (entry.voyage && !voyage.bind(voyage.read(entry.voyage), 'table-' + entry.id)) {
      throw Error('无法确认桌战对应的遭遇。');
    }
    if (entry.voyage && entry.result) voyage.settle(voyage.read(entry.voyage), 'table-' + entry.id, entry.result);
    await deck.activate(entry);
    battle = entry;
    const url = new URL(location.href);
    url.searchParams.set('tableBattle', entry.id);
    url.hash = entry.boss;
    history.replaceState(null, '', url);
    start.hidden = true;
    resume.hidden = true;
    document.body.classList.add('sidebar-collapsed');
    bar.hidden = false;
    showStage();
  }

  function goOnline(online, selection) {
    squadLink.save(online.id, online.credentials);
    const active = online.room.squad.phase === 'battle';
    const source = voyage?.current();
    if (source?.encounter && (online.actor.role !== 'host' || (active && online.room.squad.voyage !== source.id))) {
      throw Error('请由房主从遭遇开启对应战斗。当前小队战斗无法登记到此遭遇。');
    }
    if (online.actor.role !== 'host') {
      location.assign(squadLink.link(active ? '/aibp/room' : '/aibp/squad', online.id));
      return;
    }
    const target = new URL(location.href);
    for (const key of ['tableBattle', 'storySquad', 'squad', 'battle', 'startLevel']) target.searchParams.delete(key);
    target.searchParams.set(active ? 'battle' : 'squad', online.id);
    target.searchParams.set('apostle', active ? online.room.board.apostle : selection.boss);
    if (!active) target.searchParams.set('startLevel', String(selection.level));
    target.hash = '';
    location.assign(target);
  }

  async function routeBattle(continueOnly = false) {
    context = await readContext();
    const current = saved(context.key);
    const source = voyage?.current();
    if (source && (source.accountId !== context.accountId || source.profileId !== context.profileId
        || source.cycle !== context.activeCycle || String(context.day) !== source.day)) throw Error('来源战役已变更，请返回航行。');
    if (context.online?.room.squad.phase === 'battle') return goOnline(context.online);
    if (current?.voyage === source?.id && source?.result && current?.stage === 'settled') return openTable(current);
    if (current && current.stage !== 'settled') return openTable(current);
    if (continueOnly) {
      resume.hidden = true;
      entryStatus.textContent = '当前没有进行中的战斗。';
      return;
    }
    const selection = await deck.selection();
    const online = context.online;
    if (online) {
      if (online.actor.role === 'host' && online.room.squad.phase === 'story') {
        await squadLink.request(online.id, 'action', online.credentials.token, {
          id: crypto.randomUUID(), type: 'squad-phase', phase: 'prep'
        });
      }
      return goOnline(online, selection);
    }
    prep.querySelector('[data-table-boss]').textContent = selection.label;
    prep.returnValue = 'cancel';
    prep.showModal();
    prep.addEventListener('close', () => {
      if (prep.returnValue === 'setup') {
        document.getElementById('battleMapControl').scrollIntoView({ block: 'start' });
      }
      if (prep.returnValue === 'start') void run(async () => {
        const latest = await readContext();
        if (latest.key !== context.key) throw Error('战役存档已切换，请重新准备。');
        context = latest;
        if (context.online) return routeBattle();
        const begin = async () => {
          const existing = saved(context.key);
          if (existing && existing.stage !== 'settled') return openTable(existing);
          const entry = { ...selection, id: crypto.randomUUID().replaceAll('-', ''),
            stage: 'play', returnTo: voyage.storyUrl(), ...(source?.encounter && { voyage: source.id }) };
          store(entry);
          await openTable(entry);
        };
        if (navigator.locks) await navigator.locks.request(context.key, begin);
        else await begin();
      });
    }, { once: true });
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    start.disabled = resume.disabled = true;
    entryStatus.textContent = '';
    try {
      await action();
    } catch (error) {
      (battle ? status : entryStatus).textContent = error.message || '战斗页面暂时无法操作，请重试。';
    } finally {
      busy = false;
      start.disabled = resume.disabled = false;
    }
  }

  function finish() {
    if (battle.stage === 'loot') {
      if (!window.confirm('确认结束本场桌战，本次战利品不写入记录表？')) return;
      setStage('settled', 'skip');
      if (activeVoyage()) return voyage.navigate(voyage.returnUrl(activeVoyage()));
    }
    const url = new URL(location.href);
    url.searchParams.delete('tableBattle');
    location.assign(battle.returnTo || url);
  }

  controls.cards.addEventListener('click', () => cards.scrollIntoView({ block: 'start' }));
  controls.panel.addEventListener('click', () => {
    const expanded = controls.panel.getAttribute('aria-expanded') === 'true';
    controls.panel.setAttribute('aria-expanded', String(!expanded));
    document.body.toggleAttribute('data-table-show-panel', !expanded);
    if (!expanded) panel.scrollIntoView({ block: 'nearest' });
  });
  controls.settle.addEventListener('click', () => void run(async () => {
    if (battle.stage === 'play' && deck.hasPending()) throw Error('请先处理当前待结算的牌或观星，再结束桌战。');
    setStage('loot');
    await window.openAibpLoot();
  }));
  controls.resume.addEventListener('click', () => void run(() => setStage('play')));
  controls.finish.addEventListener('click', () => void run(finish));
  resume.addEventListener('click', () => void run(() => routeBattle(true)));

  window.addEventListener('storage', event => {
    if (event.key !== context?.key) return;
    const current = saved(context.key);
    if (!battle) return void run(refresh);
    if (current?.id === battle.id) {
      battle = current;
      showStage();
    } else {
      // Another tab has already moved on to the next battle.
      cards.inert = panel.inert = true;
      controls.settle.disabled = controls.resume.disabled = true;
      status.textContent = '本场桌战已在另一个页面结束，请刷新。';
    }
  });

  window.AIBP_TABLE_BATTLE = {
    launch: () => run(routeBattle),
    settlement() {
      if (!battle || battle.stage !== 'loot') return null;
      if (saved(context.key)?.id !== battle.id || saved(context.key)?.stage !== 'loot') {
        throw Error('本场结算已在另一个页面变更，请刷新。');
      }
      if (!context.accountId) throw Error('请从已登录的战役存档开启桌战后入账。');
      return { id: 'table-' + battle.id, accountId: context.accountId, userId: context.profileId,
        activeCycle: context.activeCycle };
    },
    settled() {
      if (battle?.stage === 'loot' && saved(context.key)?.id === battle.id) setStage('settled', 'loot');
    }
  };

  async function refresh() {
    context = await readContext();
    const current = saved(context.key);
    const onlineActive = context.online?.room.squad.phase === 'battle';
    if (battle) return;
    if (route.searchParams.get('tableBattle') === current?.id && !onlineActive) return openTable(current);
    resume.hidden = !(onlineActive || (current && current.stage !== 'settled'));
    if (route.searchParams.has('tableBattle')) {
      entryStatus.textContent = '当前存档没有这场实体桌战。';
      if (voyage?.current()?.encounter) start.hidden = true;
    }
  }

  window.addEventListener('focus', () => { if (!battle) void run(refresh); });
  void run(refresh);
})();
