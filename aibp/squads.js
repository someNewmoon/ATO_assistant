(() => {
  const api = window.ATO_SQUAD_LINK;
  const { activeHeroes, escape: e, heroDisplayName, heroPortrait } = window.ATO_HERO_CATALOG;
  const content = document.querySelector('#squadContent');
  const status = document.querySelector('#squadStatus');
  const show = message => { status.textContent = message; };
  const link = (id, title) => '<a class="squad-action primary" href="' + e(api.link('/aibp/squad', id)) + '">' + e(title) + '</a>';

  function remember({ id, credentials }) {
    api.save(id, credentials);
    return id;
  }

  async function start() {
    try {
      const home = await api.home();
      const recent = api.recentHost();
      if (home.squad) {
        show('');
        content.innerHTML = '<section class="squad-panel squad-stack"><h2>' + e(home.squad.title) + '</h2><p class="squad-sub">房主 '
          + e(home.hostName) + ' · 存档 ' + e(home.saveName) + '</p>' + link(remember(home.squad), '进入小队') + '</section>';
        if (recent?.id === home.squad.id) void api.home(recent).catch(() => {});
        return;
      }
      if (recent) {
        try {
          await api.home(recent);
          return start();
        } catch (error) {
          if ([401, 404].includes(error.status)) api.forget(recent.id);
          else if (error.status !== 409) throw error;
        }
      }
      const response = await fetch('/api/campaign-state.php', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('无法读取当前存档。');
      const { campaign } = await response.json();
      const heroes = activeHeroes(campaign);
      const language = campaign.sections.dashboard?.profiles?.[campaign.sections.dashboard?.activeProfileId]?.termLanguage || 'official';
      api.language(language);
      show('');
      if (!heroes.length) {
        content.innerHTML = '<section class="squad-panel"><p>请先到<a href="/hero/">英雄管理</a>添加参战英雄。</p></section>';
        return;
      }
      content.innerHTML = '<section class="squad-panel squad-stack"><h2>创建小队</h2><p class="squad-sub">房主 '
        + e(home.hostName) + ' · 存档 ' + e(home.saveName) + '</p><form class="squad-form" data-create>'
        + '<label>小队名称 <input name="title" maxlength="80" required value="' + e(home.saveName) + '"></label>'
        + '<fieldset class="squad-choices"><legend>选择 1 至 4 位英雄</legend>'
        + heroes.map((hero, index) => {
          const portrait = heroPortrait(hero);
          return '<label class="squad-choice"><input type="checkbox" name="heroIds" value="' + e(hero.id)
            + '"' + (index < 4 ? ' checked' : '') + '><span class="squad-hero">'
            + (portrait ? '<img src="../hero/assets/' + e(portrait) + '" alt="">' : '') + '<span data-user-content>'
            + e(heroDisplayName(hero)) + '</span></span></label>';
        }).join('')
        + '</fieldset><label class="squad-row"><span><input name="publicLobby" type="checkbox" checked> 开放从登录页快速加入</span></label>'
        + '<button type="submit">创建小队</button></form></section>';
      window.ATO_LANGUAGE?.refresh();
      content.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        const heroIds = fields.getAll('heroIds');
        if (heroIds.length < 1 || heroIds.length > 4) { show('请选择 1 至 4 位英雄。'); return; }
        const button = form.querySelector('button');
        button.disabled = true;
        show('正在创建小队…');
        try {
          const result = await fetch('/api/battle-room/create', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ squad: true, title: fields.get('title'), heroIds, language, publicLobby: fields.has('publicLobby') }),
            signal: AbortSignal.timeout(15000),
          });
          const data = await result.json();
          if (!result.ok) throw new Error(data.error || '创建失败。');
          const id = remember({ id: data.room.id, credentials: { token: data.keys.host, keys: data.keys } });
          location.assign(api.link('/aibp/squad', id));
        } catch (error) {
          show(error.message);
          button.disabled = false;
        }
      });
    } catch (error) {
      if (error.status === 401) {
        show('请先在主控台登录，再管理小队。');
        content.innerHTML = '<a class="squad-action" href="/">打开主控台</a>';
        return;
      }
      show(error.message);
    }
  }

  void start();
})();
