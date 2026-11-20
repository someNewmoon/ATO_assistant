window.ATO_MOUNT_NEMESIS_TOOL = function mountNemesisTool(root, options) {
  const endpoint = `${root}api/campaign-state.php`;
  const session = window.ATO_CAMPAIGN_SESSION.create();
  const mapSync = typeof BroadcastChannel === "function" ? new BroadcastChannel("ato-map-sync-v1") : null;
  const panel = document.createElement("dialog");
  panel.className = "campaign-nemesis-tool";
  panel.setAttribute("aria-labelledby", "campaignNemesisToolTitle");
  panel.innerHTML = `<form>
    <h2 id="campaignNemesisToolTitle">推进宿敌</h2>
    <p>探索卡以外的来源每次结算 1 枚标记。战斗中触发的标记在本场战斗结束后结算。</p>
    <p data-nemesis-context></p>
    <p data-nemesis-preview></p>
    <label hidden>选择宿敌现身的已探索板块 <select aria-label="选择宿敌现身的板块"></select></label>
    <div data-nemesis-map></div>
    <label data-nemesis-battle-ended hidden><input type="checkbox"> 本场战斗已结束</label>
    <p role="status"></p>
    <div data-nemesis-actions>
      <button type="submit" data-nemesis-confirm hidden>结算 1 枚标记</button>
      <a data-nemesis-battle hidden>打开宿敌战斗</a>
      <button type="button" data-nemesis-close autofocus>关闭</button>
    </div>
  </form>`;
  document.body.append(panel);
  const form = panel.querySelector("form");
  const context = panel.querySelector("[data-nemesis-context]");
  const preview = panel.querySelector("[data-nemesis-preview]");
  const map = panel.querySelector("[data-nemesis-map]");
  const select = panel.querySelector("select");
  const battleEnded = panel.querySelector("input");
  const confirm = panel.querySelector("[data-nemesis-confirm]");
  const close = panel.querySelector("[data-nemesis-close]");
  const battle = panel.querySelector("[data-nemesis-battle]");
  const status = panel.querySelector("[role=status]");
  let snapshot, plan, fromBattle, busy = false, request = 0;

  const profileSection = (section, profileId) => section?.users || section?.accounts
    ? section.users?.[profileId] || section.accounts?.[profileId] || {} : section || {};

  async function read() {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (response.status === 401) throw new Error("请先登录主控台。");
    const payload = session.accept(await response.json());
    if (!response.ok || !payload.ok) throw new Error("读取战役档案失败，请重试。");
    const { sections, sectionRevisions } = payload.campaign;
    const profileId = sections.dashboard?.activeProfileId;
    const profile = sections.dashboard?.profiles?.[profileId];
    const cycle = profile?.activeCycleId;
    const state = profile?.cycles?.[cycle]?.state;
    if (!state || state.day == null || state.day === "") throw new Error("请先在主控台打开一个战役档案。");
    const current = { profileId, cycle, state, revisions: sectionRevisions,
      mapState: profileSection(sections.map, profileId), record: profileSection(sections.record, profileId) };
    options.assertTarget?.(current, payload.user?.id);
    return current;
  }

  function updateChoice() {
    confirm.disabled = busy || (!select.parentElement.hidden && !select.value)
      || (fromBattle && !battleEnded.checked);
    for (const tile of map.querySelectorAll("[data-candidate-tile]")) {
      tile.setAttribute("aria-pressed", String(tile.dataset.candidateTile === select.value));
    }
  }

  function display() {
    if (plan.mode === "spawn") {
      preview.textContent = plan.candidates[0].distance === 4
        ? "宿敌将现身在距阿尔戈号正好 4 格的板块。"
        : `没有正好 4 格的候选。最远的可达已探索板块距阿尔戈号 ${plan.candidates[0].distance} 格。`;
      select.replaceChildren(new Option("请选择", ""),
        ...plan.candidates.map(tile => new Option(tile.label && tile.label !== tile.id ? `${tile.id} · ${tile.label}` : tile.id, tile.id)));
      if (plan.candidates.length === 1) select.value = plan.candidates[0].id;
      select.parentElement.hidden = false;
      const mini = options.renderSpawnMap?.(plan.cycle, plan.layout, plan.candidates, id => {
        select.value = id;
        updateChoice();
      });
      if (mini) map.append(mini);
    } else if (plan.mode === "track") {
      preview.textContent = plan.position == null ? "泰坦 X 现身，追踪指示物放在 7。"
        : `泰坦 X 追踪指示物 ${plan.position} → ${plan.track}。${plan.adjacent ? " 航行模型将随机放到阿尔戈号相邻板块。" : ""}`;
    } else {
      const { before, after, encounter, destination } = plan.movement;
      preview.textContent = encounter
        ? `距离 ${before} → ${after} 格。宿敌与阿尔戈号相遇，须在触发步骤结束时结算宿敌战斗。`
        : `宿敌移动 ${plan.origin} → ${destination}。距阿尔戈号 ${before} → ${after} 格。`;
    }
    confirm.hidden = false;
    battleEnded.parentElement.hidden = !fromBattle;
    updateChoice();
  }

  close.addEventListener("click", () => panel.close());
  panel.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  select.addEventListener("change", updateChoice);
  battleEnded.addEventListener("change", updateChoice);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || confirm.hidden || confirm.disabled) return;
    const spawnTile = select.value;
    busy = true;
    map.inert = true;
    close.disabled = select.disabled = battleEnded.disabled = true;
    updateChoice();
    status.textContent = "正在保存…";
    try {
      await options.beforeRead?.();
      options.assertTarget?.(snapshot, session.accountId);
      const mapState = structuredClone(snapshot.mapState);
      const saved = mapState.cycles[snapshot.cycle];
      saved.tokens ||= {};
      saved.adversaryIntroduced = true;
      let message = preview.textContent;
      let href = "";
      if (plan.mode === "spawn") {
        saved.tokens.AD = spawnTile;
        message = `宿敌已现身在 ${spawnTile}，距阿尔戈号 ${plan.candidates[0].distance} 格。`;
      } else if (plan.mode === "track") {
        saved.titanXTrackPosition = plan.track;
        if (plan.adjacent) {
          const tile = plan.adjacent[Math.floor(Math.random() * plan.adjacent.length)];
          saved.tokens.AD = tile.id;
          message = `泰坦 X 追踪指示物 ${plan.position} → ${plan.track}，航行模型位于 ${tile.id}。`;
        } else if (plan.position == null) {
          saved.tokens.AD = "";
        }
      } else {
        saved.tokens.AD = plan.movement.encounter ? "" : plan.movement.destination;
        if (plan.movement.encounter) {
          const target = window.ATO_NEMESIS_BATTLE.targetFor(snapshot.cycle, snapshot.record);
          if (!target) throw new Error("找不到当前宿敌的战斗入口，请核对记录表。");
          href = `${root}story/index.html?${new URLSearchParams(target)}`;
          window.ATO_NEMESIS_BATTLE.recordEncounter(saved, snapshot.state.day, href);
        }
      }
      const { map: mapRevision, dashboard, record } = snapshot.revisions;
      const response = await fetch(`${endpoint}?action=import-sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: snapshot.profileId, expectedAccountId: session.accountId,
          expectedRevisions: { map: mapRevision, dashboard, record }, sections: { map: mapState },
        }),
      });
      const payload = session.accept(await response.json());
      if (payload.code === "SAVE_CONFLICT") throw new Error("地图或战役进度已更新。请关闭窗口后重新读取。");
      if (!response.ok || !payload.ok) throw new Error("未能确认保存。请重新打开工具核对地图进度。");
      mapSync?.postMessage({ source: "map", profileId: snapshot.profileId, revision: payload.sections.map });
      if (href) {
        battle.href = href;
        battle.hidden = false;
        message = "已记录宿敌相遇并移除模型。触发步骤结束时打开战斗。";
      }
      status.textContent = message;
      if (options.onMapSaved) void options.onMapSaved().catch(() => {});
    } catch (error) {
      status.textContent = error.message;
    } finally {
      confirm.hidden = true;
      busy = false;
      map.inert = false;
      close.disabled = false;
      close.focus();
    }
  });

  return async function openPanel() {
    const id = ++request;
    fromBattle = /\/aibp(?:\/|$)/.test(location.pathname)
      || new URLSearchParams(location.search).get("chapter") === "battle";
    snapshot = null;
    confirm.hidden = battle.hidden = select.parentElement.hidden = battleEnded.parentElement.hidden = true;
    select.disabled = battleEnded.disabled = battleEnded.checked = false;
    map.replaceChildren();
    context.textContent = preview.textContent = "";
    status.textContent = "正在读取当前战役…";
    panel.showModal();
    try {
      await options.beforeRead?.();
      const current = await read();
      if (!panel.open || id !== request) return;
      snapshot = current;
      const day = String(current.state.day);
      context.textContent = `${current.cycle.toUpperCase()} · ${/^\d+$/.test(day) ? `第 ${day} 天` : day}`;
      plan = window.ATO_EXPLORATION_PURSUIT.outsideMarker({ cycleId: current.cycle, mapState: current.mapState });
      status.textContent = plan.ok ? "" : plan.message;
      if (plan.ok) display();
    } catch (error) {
      if (id === request) status.textContent = error.message;
    }
  };
};
