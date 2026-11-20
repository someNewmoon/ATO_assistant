window.ATO_MOUNT_HERO_TOOL = function mountHeroTool(root, options) {
  const endpoint = `${root}api/campaign-state.php`;
  const session = window.ATO_CAMPAIGN_SESSION.create();
  const { heroDisplayName, heroPortrait } = window.ATO_HERO_CATALOG;
  const sync = typeof BroadcastChannel === "function" ? new BroadcastChannel("ato-hero-mnemos-sync-v1") : null;
  const stats = [
    ["fury", "怒气", "tri_rage.png"],
    ["fate", "命运", "tri_fate.png"],
    ["danger", "凶险", "tri_danger.png"],
  ];
  const valueOf = (hero, key) => Math.max(0, parseInt(hero.triskelion?.[key], 10) || 0);
  const panel = document.createElement("dialog");
  panel.className = "campaign-hero-tool";
  panel.setAttribute("aria-labelledby", "campaignHeroToolTitle");
  panel.innerHTML = `<form>
    <h2 id="campaignHeroToolTitle">英雄状态</h2>
    <fieldset class="hero-tool-roster" aria-label="当前队伍三幅节"></fieldset>
    <p role="status"></p>
    <footer>
      <a href="${root}hero/index.html">打开英雄页</a>
      <button type="button" data-hero-close autofocus>关闭</button>
      <button type="submit" disabled>确认保存</button>
    </footer>
  </form>`;
  document.body.append(panel);
  const form = panel.querySelector("form");
  const roster = panel.querySelector("fieldset");
  const status = panel.querySelector("[role=status]");
  const close = panel.querySelector("[data-hero-close]");
  const submit = panel.querySelector("[type=submit]");
  const fields = [];
  let snapshot, busy = false, request = 0;

  async function read() {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (response.status === 401) throw new Error("请先登录主控台。");
    const payload = session.accept(await response.json());
    if (!response.ok || !payload.ok || !session.accountId) throw new Error("读取英雄记录失败，请重试。");
    const { sections, sectionRevisions } = payload.campaign;
    const section = sections.heroes;
    const profiles = section?.users || section?.accounts;
    const profileId = profiles ? sections.dashboard?.activeProfileId : undefined;
    if (profiles && !profileId) throw new Error("请先在主控台打开一个战役档案。");
    const state = profiles ? profiles[profileId] : section;
    return { profileId, state, revisions: sectionRevisions };
  }

  function updateSubmit() {
    submit.disabled = busy || !fields.some(field => field.after !== field.before);
    close.textContent = submit.disabled ? "关闭" : "取消";
  }

  function render(heroes) {
    for (const hero of heroes) {
      const card = document.createElement("section");
      const identity = document.createElement("header");
      identity.className = "hero-tool-identity";
      const title = document.createElement("h3");
      title.textContent = heroDisplayName(hero);
      if (hero.customName || hero.playerName && !hero.argonaut) title.dataset.userContent = "";
      const portrait = document.createElement("span");
      portrait.className = "hero-tool-portrait";
      portrait.setAttribute("aria-hidden", "true");
      const artwork = heroPortrait(hero);
      if (artwork) {
        const image = document.createElement("img");
        image.alt = "";
        image.addEventListener("error", () => image.remove(), { once: true });
        image.src = `${root}hero/assets/${artwork}`;
        portrait.append(image);
      }
      identity.append(portrait, title);
      card.append(identity);
      const grid = document.createElement("div");
      grid.className = "hero-tool-stats";
      for (const [key, label, file] of stats) {
        const value = valueOf(hero, key);
        const field = { heroId: hero.id, key, before: value, after: value };
        fields.push(field);
        const cell = document.createElement("div");
        cell.dataset.heroStat = key;
        const name = document.createElement("div");
        const icon = document.createElement("img");
        icon.src = `${root}hero/assets/${file}`;
        icon.alt = "";
        name.append(icon, label);
        const controls = document.createElement("div");
        controls.className = "hero-tool-controls";
        const output = document.createElement("output");
        const makeButton = (text, delta) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = text;
          button.setAttribute("aria-label", `${title.textContent} · ${label} ${delta > 0 ? "+1" : "−1"}`);
          button.addEventListener("click", () => {
            field.after = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, field.after + delta));
            update();
            updateSubmit();
          });
          return button;
        };
        const minus = makeButton("−", -1);
        const plus = makeButton("+", 1);
        function update() {
          minus.disabled = field.after === 0;
          plus.disabled = field.after >= Number.MAX_SAFE_INTEGER;
          output.textContent = field.after === field.before ? String(field.after) : `${field.before} → ${field.after}`;
          output.classList.toggle("hero-tool-changed", field.after !== field.before);
        }
        update();
        controls.append(minus, output, plus);
        cell.append(name, controls);
        grid.append(cell);
      }
      card.append(grid);
      roster.append(card);
    }
  }

  close.addEventListener("click", () => panel.close());
  panel.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submit.disabled || !snapshot) return;
    busy = close.disabled = roster.disabled = true;
    updateSubmit();
    status.textContent = "正在保存…";
    try {
      await options.beforeHeroRead?.();
      const latest = await read();
      if (snapshot.profileId !== latest.profileId) throw new Error("战役档案已切换，请关闭并重新打开。");
      const state = structuredClone(latest.state || {});
      const changes = fields.filter(field => field.after !== field.before);
      for (const { heroId, key, before, after } of changes) {
        const hero = state.heroes?.find(entry => entry.id === heroId);
        if (!hero || valueOf(hero, key) !== before) {
          throw new Error("该英雄的状态已在其他页面更新，请关闭并重新打开。");
        }
        if (!hero.triskelion || typeof hero.triskelion !== "object" || Array.isArray(hero.triskelion)) {
          hero.triskelion = {};
        }
        hero.triskelion[key] = after;
      }
      const { heroes, dashboard } = latest.revisions;
      const expectedRevisions = latest.profileId ? { heroes, dashboard } : { heroes };
      const response = await fetch(`${endpoint}?action=import-sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedAccountId: session.accountId, expectedRevisions,
          userId: latest.profileId, sections: { heroes: state } }),
      });
      const payload = session.accept(await response.json());
      if (payload.code === "SAVE_CONFLICT") throw new Error("保存期间英雄记录已更新，可以重试保存。");
      if (!response.ok || !payload.ok) throw new Error("未能确认保存，请重新打开后核对英雄状态。");
      sync?.postMessage({ type: "hero-state-updated", revision: payload.sections.heroes });
      panel.close();
      if (!sync && options.onHeroSaved) void options.onHeroSaved().catch(() => {});
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = close.disabled = roster.disabled = false;
      updateSubmit();
    }
  });

  return async function openPanel() {
    const id = ++request;
    snapshot = null;
    fields.length = 0;
    roster.replaceChildren();
    updateSubmit();
    status.textContent = "正在读取英雄记录…";
    panel.showModal();
    try {
      await options.beforeHeroRead?.();
      const current = await read();
      if (!panel.open || id !== request) return;
      snapshot = current;
      const heroes = Array.isArray(current.state?.heroes)
        ? current.state.heroes.filter(hero => typeof hero?.id === "string" && hero.id) : [];
      render(heroes);
      status.textContent = heroes.length ? "" : "当前队伍还没有英雄，可在英雄页唤醒。";
    } catch (error) {
      if (id === request) status.textContent = error.message;
    }
  };
};
