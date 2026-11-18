(() => {
  const id = new URLSearchParams(location.search).get('squad');
  if (!id) return;
  const api = window.ATO_SQUAD_LINK;
  const token = new URLSearchParams(location.hash.slice(1)).get('view');
  if (!api?.validId(id) || !api.validKey(token)) {
    showUnavailable('请使用房主提供的小队投屏链接。');
    return;
  }
  const overlay = document.createElement('section');
  overlay.className = 'squad-check-overlay';
  overlay.setAttribute('aria-label', '最近掷骰');
  const controls = document.createElement('div');
  controls.className = 'squad-roll-controls';
  overlay.append(controls);
  const dice = window.ATO_ROOM_DICE;
  const cards = Object.fromEntries(Object.entries({ story: '剧情掷骰', battle: '战斗掷骰' }).map(([kind, label]) => {
    const storageKey = 'ato-projection-roll-' + kind;
    let visible = true;
    try { visible = localStorage.getItem(storageKey) !== 'hidden'; } catch { /* Optional preference. */ }
    const toggle = document.createElement('button');
    toggle.type = 'button';
    const panel = document.createElement('article');
    panel.id = 'squad-latest-' + kind;
    panel.setAttribute('aria-live', 'polite');
    let latest;
    function sync() {
      toggle.setAttribute('aria-pressed', String(visible));
      toggle.textContent = label + ' · ' + (visible ? '显示' : '隐藏');
      panel.hidden = !visible || !latest;
    }
    toggle.setAttribute('aria-controls', panel.id);
    toggle.onclick = () => {
      visible = !visible;
      try { localStorage.setItem(storageKey, visible ? 'visible' : 'hidden'); } catch { /* Optional preference. */ }
      sync();
    };
    const update = entries => {
      const next = entries.length ? JSON.stringify(entries) : null;
      if (next !== latest) {
        latest = next;
        panel.replaceChildren();
        panel.toggleAttribute('data-failed', entries[0]?.roll.success === false);
        for (const { content } of entries) {
          const item = document.createElement('div');
          item.className = 'squad-roll-entry';
          const heading = document.createElement('strong');
          const result = document.createElement('span');
          const path = window.ATO_HERO_CATALOG?.heroPortrait(content.hero);
          if (path) {
            const image = document.createElement('img');
            image.className = 'squad-roll-avatar';
            image.src = '../hero/assets/' + path;
            image.alt = '';
            heading.append(image);
          }
          heading.append(label + ' · ' + content.title);
          result.textContent = content.result;
          const faces = document.createElement('div');
          faces.className = 'squad-roll-faces';
          faces.innerHTML = content.faces.map(die => dice.faceMarkup(die, '../aibp/room-dice-art/')).join('');
          item.append(heading, faces, result);
          const groups = (content.reactions || []).filter(group => group.people.length);
          if (groups.length) {
            const votes = document.createElement('div');
            votes.className = 'squad-roll-votes';
            for (const { icon, label, people } of groups) {
              const group = document.createElement('span');
              group.className = 'squad-roll-vote-group';
              group.setAttribute('aria-label', label + ' ' + people.length);
              group.append(icon);
              for (const { hero, name } of people) {
                const voter = document.createElement('span');
                voter.className = 'squad-roll-voter';
                voter.title = name;
                voter.setAttribute('aria-label', name);
                const path = window.ATO_HERO_CATALOG?.heroPortrait(hero);
                if (path) {
                  const image = document.createElement('img');
                  image.src = '../hero/assets/' + path;
                  image.alt = '';
                  voter.append(image);
                } else voter.textContent = [...name][0] || '';
                group.append(voter);
              }
              votes.append(group);
            }
            item.append(votes);
          }
          panel.append(item);
        }
      }
      sync();
    };
    controls.append(toggle);
    overlay.append(panel);
    sync();
    return [kind, update];
  }));
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
  function storyRoll(roll, heroes) {
    if (!roll || !dice) return null;
    const modifier = roll.bonus + roll.modifier;
    const score = roll.values.join(' + ') + (modifier ? ' ' + (modifier > 0 ? '+ ' : '− ') + Math.abs(modifier) : '');
    return {
      faces: dice.storyFaces(roll), hero: heroes[roll.seat],
      title: roll.hero + ' · ' + (roll.replaces ? '命运重掷 · ' : '') + (roll.skill || (roll.target !== null ? '检定' : 'd' + roll.sides)),
      result: score + ' → ' + roll.sum + (roll.target !== null ? ' / ' + roll.target + ' · ' + (roll.success ? '成功' : '失败') : ''),
    };
  }

  function battleRoll(roll, heroes, hostSeat) {
    if (!roll || !dice) return null;
    return { hero: heroes[roll.seat], faces: roll.dice, title: roll.hero + ' · ' + (dice.modes[roll.mode]?.name || '掷骰') + ' · 第 ' + roll.round + ' 轮',
      result: dice.rollSummary(roll), reactions: dice.reactionGroups(roll, heroes, hostSeat) };
  }

  function update({ room, actor }) {
    if (actor?.role !== 'viewer' || !room?.squad || room.revision <= latestRevision) return;
    const { phase, story, checks, cycle, language, lastBattleRoll, hostSeat, battleNumber: nextBattle } = room.squad;
    latestRevision = room.revision;
    if (room.closed) {
      stop?.();
      fight.removeAttribute('src');
      fight.hidden = true;
      prep.hidden = true;
      overlay.hidden = true;
      showUnavailable('小队已解散。');
      return;
    }
    const latestStory = checks[0];
    const rolls = room.rolls?.length ? room.rolls : phase !== 'battle' && lastBattleRoll ? [lastBattleRoll] : [];
    const battle = dice?.latestByHero(rolls, room.lastBattleRollId) || [];
    cards.story(dice && latestStory ? [{ roll: latestStory, content: storyRoll(latestStory, room.heroes) }] : []);
    cards.battle(battle.map(roll => ({ roll, content: battleRoll(roll, room.heroes, hostSeat) })));
    if (language !== preference) { preference = language; api.language(language); }
    applySecondScreenTheme({ cycleId: cycle });
    if (phase === 'battle') {
      prep.hidden = true;
      fight.hidden = false;
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
