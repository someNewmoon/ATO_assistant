(() => {
  const api = window.ATO_SQUAD_LINK;
  const { escape: e, heroPortrait } = window.ATO_HERO_CATALOG;
  const inventory = window.ATO_GEAR_INVENTORY;
  let englishLoading;
  window.ATO_LOAD_ENGLISH = () => {
    if (englishLoading) return;
    const load = name => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '../assets/' + name + '.js';
      script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error('英文术语加载失败')); };
      document.head.append(script);
    });
    englishLoading = Promise.all(['english-terms','english-ui'].map(load)).then(() => load('english-language'))
      .then(() => window.ATO_LANGUAGE?.refresh()).catch(() => { englishLoading = null; });
  };
  const query = new URLSearchParams(location.search);
  const id = query.get('squad');
  const fragment = new URLSearchParams(location.hash.slice(1));
  const invite = fragment.get('invite') || '';
  const quick = query.get('quick') === '1';
  const transfer = fragment.get('member');
  if (api.validKey(transfer)) history.replaceState(null, '', api.link('/aibp/squad', id));
  let credentials = api.validKey(transfer) ? { token: transfer } : api.read(id);
  let claimOptions = [];
  let room, actor, stop, pending = false, language, renderKey;
  const status = document.querySelector('#squadStatus');
  const content = document.querySelector('#squadContent');
  const phaseLabel = document.querySelector('#squadPhase');
  const phases = { story: '读剧情', prep: '备战', battle: '决战' };
  const stats = { danger: ['凶险', 'danger'], fate: ['命运', 'fate'], rage: ['怒气', 'rage'] };
  const skills = { courage: '勇气', wisdom: '智慧', will: '意志', endurance: '耐力', cunning: '狡黠', fury: '力量' };
  const squadURL = () => api.link('/aibp/squad', id);
  function battleURL(role) {
    const url = new URL(role === 'host' ? '/aibp/' : '/aibp/room', location.origin);
    url.searchParams.set('battle', id);
    if (role === 'host' && room.board?.apostle) url.searchParams.set('apostle', room.board.apostle);
    return url.href;
  }
  const storyURL = () => api.link('/story/', id);
  const ownSeat = () => actor.role === 'host' ? room.squad.hostSeat : actor.seat;
  const show = message => { status.textContent = message; };
  const button = (action, label, value = '') => '<button type="button" data-action="' + action + '" data-value="' + e(value) + '">' + label + '</button>';
  const anchor = (href, label, extra = '') => '<a class="squad-action" href="' + e(href) + '"' + extra + '>' + label + '</a>';

  function applyLanguage(value) {
    if (language === value) return;
    language = value;
    api.language(value);
  }

  function portrait(hero) {
    const path = heroPortrait(hero);
    return path ? '<img src="../hero/assets/' + e(path) + '" alt="">' : '';
  }

  function loadoutText(titan, gear) {
    return '<small class="squad-sub">' + e(titan || '未分配泰坦') + ' · '
      + (gear.length ? gear.map(item => e(item.name) + (item.count > 1 ? ' ×' + item.count : '')).join('、') : '未分配装备') + '</small>';
  }

  function choice(hero, seat, kit) {
    return '<label class="squad-choice"><input type="radio" name="seat" value="' + seat + '" required'
      + (hero.taken && !hero.reclaimable ? ' disabled' : '') + '><span class="squad-hero">' + portrait(hero) + '<span><strong>' + e(hero.name)
      + (hero.reclaimable ? ' · 可接管' : hero.taken ? ' · 已认领' : '') + '</strong><br>' + loadoutText(kit?.titan, kit?.gear || []) + '</span></span></label>';
  }

  function lobby(data) {
    applyLanguage(data.language || 'official');
    claimOptions = data.heroes;
    phaseLabel.textContent = '认领英雄';
    content.innerHTML = '<section class="squad-panel"><h2>' + e(data.title) + '</h2><form class="squad-form" data-form="join">'
      + '<label>玩家名 <input required name="player" maxlength="32" autocomplete="nickname"></label><fieldset class="squad-choices"><legend>选择自己的英雄</legend>'
      + data.heroes.map((hero, seat) => choice(hero, seat, data.kits?.[seat])).join('') + '</fieldset>'
      + '<button type="submit"' + (data.heroes.every(hero => hero.taken && !hero.reclaimable) ? ' disabled' : '') + '>认领并加入</button></form></section>';
  }

  function kitSummary(seat) {
    const kit = room.squad.loadouts[seat];
    const titan = inventory.loadoutTitan(room.squad.titans.find(t => t.id === kit.titanId), kit.titanPanelId);
    return { titan: titan && inventory.titanLabel(titan),
      gear: Object.entries(kit.gear).map(([id, count]) => ({ name: room.squad.gear.find(item => item.id === id)?.name || id, count })) };
  }

  function hostControls() {
    const squad = room.squad;
    const projection = credentials.keys?.viewer && api.link('/ss/', id, 'view', credentials.keys.viewer, true);
    const prep = squad.phase === 'prep';
    return '<section class="squad-panel squad-stack"><h2>房主操作</h2><div class="squad-row">'
      + (credentials.keys?.invite ? button('invite', '复制小队邀请') : '')
      + (projection ? anchor(projection, '打开共享投屏', ' target="_blank" rel="noopener"') : '')
      + (squad.phase !== 'battle' ? button('visibility', room.publicLobby ? '关闭快速加入' : '开放快速加入', !room.publicLobby) : '')
      + (squad.phase === 'story' ? anchor(storyURL(), '打开故事书') + button('phase', '开启备战', 'prep') : '')
      + (prep ? anchor(api.link('/aibp/', id), '选择骇物并开战') + button('phase', '返回读剧情', 'story') : '')
      + (squad.phase === 'battle' ? anchor(battleURL(actor.role), '打开战斗主控台') : '')
      + button('disband', '解散小队') + '</div>'
      + (squad.phase === 'story' ? '<details data-story-input><summary>手动投屏段落</summary><form data-form="story" class="squad-form">'
        + '<label>标题 <input name="title" maxlength="240" placeholder="故事段落"></label>'
        + '<label>正文 <textarea name="text" required maxlength="24000" rows="6"></textarea></label>'
        + '<button type="submit">投到共享屏幕</button></form></details>' : '') + '</section>';
  }

  function heroMarkup(hero, kit) {
    return '<div class="squad-hero">' + portrait(hero) + '<div><h3>' + e(hero.name) + '</h3><small class="squad-sub">'
      + e(hero.player || '待认领') + '</small></div></div>' + loadoutText(kit.titan, kit.gear);
  }

  function prepForm(seat) {
    const squad = room.squad;
    const kit = squad.loadouts[seat];
    const options = squad.titans.map(titan => '<option value="' + e(titan.id) + '"' + (titan.id === kit.titanId ? ' selected' : '')
      + '>' + e(inventory.titanLabel(titan)) + ' · 库存 ' + titan.count + (titan.crippled ? ' · 残废' : '') + '</option>').join('');
    const panels = inventory.DREAMWALKER_PANELS.map(panel => '<option value="' + e(panel.id) + '"'
      + (panel.id === kit.titanPanelId ? ' selected' : '') + '>' + e(panel.name) + '</option>').join('');
    const gear = squad.gear.filter(item => item.count || kit.gear[item.id]).map(item => '<label><span>' + e(item.name)
      + ' <small class="squad-sub">库存 ' + item.count + '</small></span><input name="gear:' + e(item.id) + '" type="number" min="0" max="'
      + Math.min(99, Math.max(kit.gear[item.id] || 0, item.count)) + '" value="' + (kit.gear[item.id] || 0) + '"></label>').join('');
    return '<section class="squad-panel"><h2>我的备战</h2><form data-form="kit" class="squad-form" data-base="' + e(JSON.stringify(kit))
      + '"><label>泰坦 <select name="titanId"><option value="">未分配</option>' + options + '</select></label>'
      + '<label data-titan-panel>梦行者面板 <select name="titanPanelId"><option value="">默认</option>' + panels + '</select></label>'
      + '<details><summary>装备数量</summary><div class="squad-gear">' + (gear || '<p>军械库暂无装备。</p>') + '</div></details>'
      + '<p class="squad-sub">旧忆沿用英雄记录。保存后的配装供本小队下一场战斗使用。</p><button type="submit">保存配装</button></form></section>';
  }

  function storyStats(hero) {
    return '<h3>当前状态</h3><div class="squad-stats">' + Object.entries(stats).map(([key, [label, icon]]) => {
      const value = hero.storyStats?.[key] || 0;
      const step = (delta, mark, disabled) => '<button type="button" data-action="stat" data-key="' + key
        + '" data-value="' + delta + '" aria-label="' + (delta < 0 ? '减少' : '增加') + label + '"'
        + (disabled ? ' disabled' : '') + '>' + mark + '</button>';
      return '<div><span><img src="../hero/assets/tri_' + icon + '.png" alt=""> ' + label + '</span><div>'
        + step(-1, '−', value === 0) + '<output>' + value + '</output>' + step(1, '+', value >= 999) + '</div></div>';
    }).join('') + '</div>';
  }

  function rollForm() {
    return '<section class="squad-panel"><h2>检定与掷骰</h2><form data-form="roll" class="squad-form">'
      + '<label>用途 <select name="kind"><option value="check">剧情检定</option><option value="10">普通 d10</option><option value="6">普通 d6</option></select></label>'
      + '<div class="squad-field-grid" data-check-fields><label>英雄属性 <select name="skill"><option value="">无</option>'
      + Object.entries(skills).map(([value, label]) => '<option value="' + value + '">' + label + '</option>').join('')
      + '</select></label><label>难度 <input name="target" type="number" min="1" max="99" value="6" required></label>'
      + '<label>额外修正 <input name="modifier" type="number" min="-99" max="99" value="0" required></label></div>'
      + '<label data-dice-count hidden>骰子数量 <input name="count" type="number" value="1" min="1" max="6" required></label>'
      + '<button type="submit">投掷并同步</button></form></section>';
  }

  function rollLine(roll) {
    const adjustment = roll.bonus + roll.modifier;
    const raw = roll.values.join(' + ');
    const total = adjustment ? raw + (adjustment > 0 ? ' + ' : ' − ') + Math.abs(adjustment) : raw;
    return '<strong>' + e(roll.hero) + '</strong>' + (roll.replaces ? '命运重掷 · ' : '') + e(roll.skill || (roll.target !== null ? '检定' : 'd' + roll.sides))
      + ' · ' + e(total) + ' → ' + roll.sum + (roll.target !== null ? ' / ' + roll.target + ' · ' + (roll.success ? '成功' : '失败') : '');
  }

  function render() {
    if (room.closed) {
      stop?.();
      api.forget(id);
      phaseLabel.textContent = '已解散';
      content.innerHTML = '<p>这个小队已解散。</p>' + anchor('/aibp/squads', '返回联机小队');
      return;
    }
    const squad = room.squad, seat = ownSeat();
    phaseLabel.textContent = phases[squad.phase];
    const key = JSON.stringify([squad.phase, squad.hostSeat, squad.battleNumber, room.title, room.publicLobby,
      room.heroes.map(hero => hero.player), squad.loadouts[seat]]);
    if (renderKey !== key) {
      renderKey = key;
      const isHost = actor.role === 'host';
      const hero = room.heroes[seat];

      const personal = hero ? '<section class="squad-panel">' + heroMarkup(hero, kitSummary(seat))
        + '<dl class="squad-attrs">' + Object.entries(skills).map(([key, name]) => '<div><dt>' + name + '</dt><dd>' + hero.skills[key] + '</dd></div>').join('')
        + '</dl>' + (squad.phase !== 'battle' ? '<div data-story-stats></div>' : '') + '</section>' : '';
      const claim = isHost && squad.phase !== 'battle' ? '<details class="squad-panel"' + (seat === null ? ' open' : '') + '><summary>房主席位</summary><form data-form="host-seat" class="squad-form">'
        + '<fieldset class="squad-choices"><legend>房主也可认领一个英雄</legend>'
        + room.heroes.map((hero, index) => choice({ ...hero, taken: Boolean(hero.player), reclaimable: Boolean(hero.player) && index !== seat }, index, kitSummary(index))).join('')
        + '</fieldset><button type="submit">认领或接管英雄</button></form></details>' : '';
      const fight = squad.phase === 'battle' && !isHost ? '<section class="squad-panel">' + anchor(battleURL(actor.role), '进入当前战斗') + '</section>' : '';
      content.innerHTML = '<div class="squad-stack"><h2>' + e(room.title) + '</h2>'
        + (isHost ? hostControls() : button('transfer', '复制我的席位链接')) + claim + personal + fight
        + (hero && squad.phase !== 'battle' ? rollForm() : '') + (hero && squad.phase === 'prep' ? prepForm(seat) : '')
        + (isHost && seat !== null ? '<details class="squad-roster"><summary>查看小队席位</summary><ul class="squad-log" data-roster></ul></details>' : '')
        + '<section class="squad-panel"><h2>队伍记录</h2><ol class="squad-log" data-team-log></ol></section></div>';
      syncFields();
    }
    const statePanel = content.querySelector('[data-story-stats]');
    if (statePanel) {
      const next = storyStats(room.heroes[seat]);
      if (statePanel.dataset.state !== next) {
        const active = statePanel.contains(document.activeElement) ? document.activeElement.dataset : null;
        statePanel.innerHTML = next;
        statePanel.dataset.state = next;
        if (active?.key) statePanel.querySelector('[data-key="' + active.key + '"][data-value="' + active.value + '"]')?.focus({ preventScroll: true });
      }
    }
    const roster = content.querySelector('[data-roster]');
    if (roster) roster.innerHTML = room.heroes.map((hero, index) => '<li>' + heroMarkup(hero, kitSummary(index)) + '</li>').join('');
    const log = content.querySelector('[data-team-log]');
    const latest = squad.checks.find(roll => roll.seat === seat);
    log.innerHTML = squad.checks.map(roll => '<li>' + rollLine(roll)
      + (roll === latest && latest.target !== null && !latest.replaces && squad.phase !== 'battle'
        ? ' ' + button('reroll', '命运 +1 并重掷', latest.id) : '') + '</li>').join('') || '<li>暂无检定或掷骰。</li>';
    window.ATO_LANGUAGE?.refresh();
  }

  function syncFields() {
    const roll = content.querySelector('[data-form="roll"]');
    if (roll) {
      const checking = roll.elements.kind.value === 'check';
      roll.querySelector('[data-check-fields]').hidden = !checking;
      roll.querySelector('[data-dice-count]').hidden = checking;
      for (const field of roll.querySelectorAll('[data-check-fields] input,[data-check-fields] select')) field.disabled = !checking;
      roll.elements.count.disabled = checking;
    }
    const kit = content.querySelector('[data-form="kit"]');
    if (kit) {
      const selected = room.squad.titans.find(t => t.id === kit.elements.titanId.value);
      const dreamwalker = inventory.titanType(selected)?.id === 'dreamwalker';
      kit.querySelector('[data-titan-panel]').hidden = !dreamwalker;
      kit.elements.titanPanelId.disabled = !dreamwalker;
    }
  }

  function accept(data) {
    if (data.room.id !== id || (room && data.room.revision <= room.revision)) return;
    room = data.room;
    actor = data.actor;
    if (!room.squad || !['host', 'player'].includes(actor.role)) throw new Error('这个链接不属于联机小队成员。');
    applyLanguage(room.squad.language);
    render();
  }

  async function action(type, fields = {}) {
    const data = await api.request(id, 'action', credentials.token, { id: crypto.randomUUID(), type, ...fields });
    accept(data);
  }

  async function run(task) {
    if (pending) return;
    pending = true;
    try { await task(); show(''); }
    catch (error) { show(error.message); }
    finally { pending = false; }
  }

  function startSocket() {
    stop?.();
    stop = api.connect(id, credentials.token, accept, show);
  }

  content.addEventListener('change', syncFields);
  content.addEventListener('click', event => {
    const node = event.target.closest('button[data-action]');
    if (!node) return;
    const { action: name, value } = node.dataset;
    void run(async () => {
      if (name === 'stat') return action('squad-stat', { seat: ownSeat(), key: node.dataset.key, delta: Number(value) });
      if (name === 'reroll') return action('squad-reroll', { seat: ownSeat(), roll: value });
      if (name === 'disband') {
        if (window.confirm('解散这个小队？所有成员和当前投屏都会退出，战役存档仍会保留。')) await action('squad-disband');
        return;
      }
      if (name === 'phase') return action('squad-phase', { phase: value });
      if (name === 'visibility') return action('public-lobby', { value: value === 'true' });
      const link = name === 'invite' ? api.link('/aibp/squad', id, 'invite', credentials.keys.invite, true)
        : api.link('/aibp/squad', id, 'member', credentials.token, true);
      try { await navigator.clipboard.writeText(link); node.textContent = '已复制'; }
      catch { window.prompt('复制链接', link); }
    });
  });

  content.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.target, fields = new FormData(form);
    const pick = fields.get('seat');
    void run(async () => {
      if (form.dataset.form === 'join') {
        // Retain the candidate key through retries, since joining is idempotent for a given key.
        const reclaim = claimOptions[Number(pick)]?.reclaimable === true;
        if (reclaim && !window.confirm('接管这个英雄？原席位链接会立即失效。')) return;
        const token = credentials?.token || crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
        credentials = { token };
        api.save(id, credentials);
        const data = await api.request(id, 'join', invite, { quick, seat: Number(pick), player: fields.get('player'), playerKey: token, reclaim });
        history.replaceState(null, '', squadURL());
        accept(data);
        startSocket();
        return;
      }
      if (form.dataset.form === 'story') return action('squad-story', { story: {
        title: fields.get('title') || '故事段落', text: fields.get('text'),
      } });
      if (form.dataset.form === 'host-seat') {
        const seat = Number(pick);
        const reclaim = Boolean(room.heroes[seat]?.player) && seat !== ownSeat();
        if (!reclaim || window.confirm('让房主接管这个英雄？原席位链接会立即失效。')) {
          return action('squad-host-seat', { seat, reclaim });
        }
        return;
      }
      const seat = ownSeat();
      if (form.dataset.form === 'kit') {
        const gear = Object.fromEntries([...fields].filter(([key, value]) => key.startsWith('gear:') && Number(value) > 0)
          .map(([key, value]) => [key.slice(5), Number(value)]));
        return action('squad-kit', { seat, base: JSON.parse(form.dataset.base), kit: {
          titanId: fields.get('titanId'), titanPanelId: fields.get('titanPanelId'), gear,
        } });
      }
      const check = fields.get('kind') === 'check';
      return action('squad-roll', { seat, sides: check ? 10 : Number(fields.get('kind')), count: check ? 1 : Number(fields.get('count')),
        target: check ? Number(fields.get('target')) : null, skill: fields.get('skill'), modifier: Number(fields.get('modifier')) });
    });
  });

  window.addEventListener('pagehide', () => { stop?.(); });
  window.addEventListener('pageshow', event => { if (event.persisted && room) startSocket(); });
  void run(async () => {
    if (!credentials && !invite && !quick) {
      const owner = (await api.home().catch(() => null))?.squad;
      if (owner?.id === id) credentials = owner.credentials;
    }
    if (credentials?.token) {
      try {
        accept(await api.request(id, 'state', credentials.token));
        if (room.closed) return;
        api.save(id, credentials);
        startSocket();
        if (actor.role === 'host') void api.home({ id, credentials }).catch(() => {});
        return;
      } catch (error) {
        if (!invite && !quick) throw error;
        if (error.status === 401) {
          credentials = null;
          api.forget(id);
        }
      }
    }
    if (!invite && !quick) throw new Error('请打开小队邀请，或使用之前认领席位的浏览器。');
    const data = await api.request(id, 'lobby', invite, { quick });
    if (!data.squad) throw new Error('这个邀请属于单场战斗。');
    lobby(data);
  });
})();
