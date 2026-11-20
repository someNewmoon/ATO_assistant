window.ATO_MOUNT_QUICK_SETTLEMENT = function mountQuickSettlement(options = {}) {
  const root = options.root || "../";
  const conflictHelp = "请放弃暂存改动并重新读取。";
  const panel = document.createElement("dialog");
  panel.id = "storySettlement";
  panel.setAttribute("aria-labelledby", "storySettlementTitle");
  panel.innerHTML = `<form novalidate>
        <header>
          <h2 id="storySettlementTitle">剧情结算</h2>
          <button type="button" data-settlement-close autofocus>收起</button>
          <p id="storySettlementContext"></p>
        </header>
        <fieldset aria-label="剧情结算数值"></fieldset>
        <footer>
          <section id="storySettlementBill" aria-labelledby="storySettlementBillTitle" hidden>
            <h3 id="storySettlementBillTitle">本次变更</h3>
            <ul aria-live="polite"></ul>
          </section>
          <p role="status"></p>
          <a id="storySettlementRecord" href="#" target="_blank" rel="noopener">打开记录表</a>
          <div class="story-settlement-save-actions">
            <button type="button" data-settlement-reset hidden>放弃暂存改动</button>
            <button type="submit" disabled>确认保存</button>
          </div>
        </footer>
      </form>`;
  document.body.appendChild(panel);
  const title = panel.querySelector("#storySettlementTitle");
  title.textContent = options.title || "剧情结算";
  const close = panel.querySelector("[data-settlement-close]");
  const reset = panel.querySelector("[data-settlement-reset]");
  const form = panel.querySelector("form");
  const fields = panel.querySelector("fieldset");
  const status = panel.querySelector("[role=status]");
  const context = panel.querySelector("#storySettlementContext");
  const submit = panel.querySelector("[type=submit]");
  const session = window.ATO_CAMPAIGN_SESSION.create();
  const effects = window.ATO_EXPLORATION_EFFECT_RULES;
  const endpoint = `${root}api/campaign-state.php`;
  const recordSync = typeof BroadcastChannel === "function" ? new BroadcastChannel("ato-record-sync-v1") : null;
  const dashboardSync = typeof BroadcastChannel === "function" ? new BroadcastChannel("ato-dashboard-sync-v1") : null;
  const entries = new Map();
  const bill = panel.querySelector("#storySettlementBill");
  let displayed;
  let busy = false;
  let loadId = 0;

  const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const number = value => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
  const starts = { c1: 0, c2: 20, c3: 40, c4: 60, c5: 80 };
  const rewardTracks = {
    "hope-story": { track: "story", field: "progress", label: "希望 · 主线" },
    "hope-inward": { track: "inwardOdyssey", field: "progress", label: "希望 · 内部之旅" },
    doom: { track: "doom", field: "doom", label: "灾厄 · 当前灾厄卡" },
  };

  // Faction IDs, labels, and ranges follow the diplomacy rows in record/index.html.
  const factions = {
    c1: [
      ["minoians", "米诺斯人", -10, 10],
      ["labyrinthians", "迷宫徒", -10, 10],
      ["hornsworn", "角誓者", -10, 10],
    ],
    c2: [
      ["helots", "希洛人", 0, 15],
      ["cyclopes", "独眼巨人", 0, 15],
      ["symmachy", "邦联同盟", 0, 15],
    ],
    c3: [
      ["sunheirs", "太阳后裔", -10, 10],
      ["delphians", "德尔菲人", -10, 10],
      ["twilightWatch", "暮光守望", -10, 10],
    ],
    c4: [
      ["wasters", "浪费者", -10, 10],
      ["aristotelians", "亚里士多德远征军", -10, 10],
      ["cloudThieves", "云贼", -10, 10],
    ],
    c5: [
      ["followersOfArete", "阿瑞特追随者", -10, 10],
      ["cycladeanProtectorate", "保护国", -10, 10],
      ["outcastVanguard", "弃民先锋", -10, 10],
    ],
  };

  function currentKnowledge(state, record, cycle) {
    const old = object(state.cardCounters);
    let knowledge = number(state.cardTracks?.inwardOdyssey?.position ?? old.inwardOdyssey ?? old.inwardOdysseyCount) || starts[cycle];
    const receipts = state.exploration?.trackReceiptsByCycle?.[cycle] || {};
    for (const tx of record.explorationTrackTransactions || []) {
      if (tx.cycleId === cycle && tx.type === "knowledge" && !receipts[tx.id]) {
        knowledge = Math.max(starts[cycle], knowledge + tx.amount);
      }
    }
    return knowledge;
  }

  function markerTrack(state, cycle, key) {
    const { track, field, label } = rewardTracks[key];
    const saved = state.cardTracks?.[track];
    const old = state.cardCounters;
    const position = number(saved?.position ?? old?.[track] ?? old?.[`${track}Count`]);
    const physical = state.cardTracks && state.cardTracksVersion !== 2;
    const data = window.ATO_STORY_DOOM_DATA;
    const cards = data.cycles?.[cycle]?.[`${track}Steps`];
    const step = physical && position ? 2 * position - 1 : position;
    const card = cards?.[Math.min(step, cards.length) - 1];
    const rule = data.tokenRule(cycle, track, track === "inwardOdyssey" ? position : card, field);
    const remove = rule.gainMode === "remove";
    return { track, field, label: card ? `${label} ${card.label}` : label, rule, remove, count: number(saved?.[field]) };
  }

  function describe(campaign) {
    const dashboard = object(campaign.sections.dashboard);
    const profileId = dashboard.activeProfileId;
    const profile = dashboard.profiles?.[profileId];
    const cycle = profile?.activeCycleId;
    const state = profile?.cycles?.[cycle]?.state;
    if (!state || !Object.hasOwn(starts, cycle)) throw new Error("请先在主控台打开一个战役档案。");
    const recordSection = object(campaign.sections.record);
    const record = object(recordSection.users || recordSection.accounts
      ? recordSection.users?.[profileId] || recordSection.accounts?.[profileId] : recordSection);
    return { campaign, dashboard, profileId, profile, cycle, state, record, knowledge: currentKnowledge(state, record, cycle) };
  }

  async function read() {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (response.status === 401) throw new Error("请先登录主控台。");
    const payload = session.accept(await response.json());
    if (!response.ok || !payload.ok) throw new Error("读取战役档案失败，请重试。");
    const snapshot = describe(payload.campaign);
    options.assertTarget?.(snapshot, payload.user?.id);
    return snapshot;
  }

  function addGroup(label) {
    const group = document.createElement("section");
    const title = document.createElement("h3");
    title.textContent = label;
    group.append(title);
    fields.append(group);
    return group;
  }

  function signed(value) {
    return value > 0 ? `+${value}` : String(value);
  }

  function renderBill() {
    const list = bill.querySelector("ul");
    list.replaceChildren();
    for (const { label, baseline, after, format, previous } of entries.values()) {
      if (after === baseline) continue;
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = label;
      const total = document.createElement("strong");
      total.dataset.delta = after > baseline ? "gain" : "loss";
      total.textContent = `${previous} → ${format(after)}（${signed(after - baseline)}）`;
      item.append(name, total);
      list.appendChild(item);
    }
    const count = list.children.length;
    bill.hidden = !count;
    options.onDraftCount?.(count);
    reset.hidden = !count;
    reset.disabled = busy;
    submit.disabled = busy || bill.hidden || session.changed;
  }

  function addRow(group, key, label, baseline, min, max, { ranges, unrecorded = false, direction = 1, locked = false, hint } = {}) {
    const row = document.createElement("div");
    row.className = "story-settlement-row";
    row.dataset.settlementKey = key;
    const name = document.createElement("strong");
    name.textContent = label;
    const preview = document.createElement("output");
    const chips = new Map();
    const scale = document.createElement("div");
    const format = ranges ? signed : String;
    const previous = unrecorded ? "未记录" : format(baseline);
    const entry = { baseline, label, after: baseline, format, previous };
    entries.set(key, entry);

    function stepButton(delta) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = delta > 0 ? "+1" : "−1";
      button.setAttribute("aria-label", `${label} ${button.textContent}`);
      button.addEventListener("click", () => {
        entry.after = Math.max(min, Math.min(max, entry.after + direction * delta));
        refresh(true);
        renderBill();
      });
      return button;
    }
    const minus = stepButton(-1);
    const plus = stepButton(1);
    const header = document.createElement("div");
    header.className = "story-settlement-row-head";
    const controls = document.createElement("div");
    controls.className = "story-settlement-controls";
    controls.append(minus, preview, plus);
    header.append(name, controls);
    row.append(header);
    if (hint) {
      const note = document.createElement("p");
      note.className = "story-settlement-hint";
      note.textContent = hint;
      row.appendChild(note);
    }

    if (ranges) {
      const icon = document.createElement("img");
      icon.src = `${root}record/assets/ally/${key.toUpperCase()}.png`;
      icon.alt = "";
      icon.width = 20;
      icon.height = 20;
      icon.addEventListener("error", () => icon.remove());
      name.prepend(icon);
      scale.className = "story-settlement-scale";
      scale.tabIndex = 0;
      scale.setAttribute("aria-label", `${label}好感度轨道`);
      const lane = document.createElement("div");
      lane.className = "story-settlement-lane";
      lane.style.setProperty("--steps", max - min + 1);
      for (const [index, [start, caption]] of ranges.entries()) {
        const marker = document.createElement("span");
        marker.className = "story-settlement-range";
        marker.textContent = caption;
        marker.style.gridColumn = `${start - min + 1} / span ${(ranges[index + 1]?.[0] ?? max + 1) - start}`;
        lane.appendChild(marker);
      }
      for (let value = min; value <= max; value++) {
        const chip = document.createElement("span");
        chip.className = "story-settlement-chip";
        chip.textContent = signed(value);
        chips.set(value, chip);
        lane.appendChild(chip);
      }
      scale.appendChild(lane);
      row.appendChild(scale);
    }
    group.append(row);

    function refresh(center = false) {
      const value = entry.after;
      const changed = value !== baseline;
      preview.textContent = changed ? `${previous} → ${format(value)}` : previous;
      preview.dataset.changed = String(changed);
      minus.disabled = locked || (direction > 0 ? value <= min : value >= max);
      plus.disabled = locked || (direction > 0 ? value >= max : value <= min);
      for (const [score, chip] of chips) {
        chip.classList.toggle("current", !unrecorded && score === baseline);
        chip.classList.toggle("proposed", changed && score === value);
      }
      if (center && chips.has(value)) {
        const chip = chips.get(value);
        scale.scrollLeft += chip.getBoundingClientRect().left - scale.getBoundingClientRect().left
          - (scale.clientWidth - chip.clientWidth) / 2;
      }
    }
    refresh();
    if (ranges) requestAnimationFrame(() => refresh(true));
  }

  function initialShipValue(record, cycle, key) {
    if (key === "fate" || key === "strangers" || (key === "crew" && cycle === "c2" && record.cycleStats?.c2?.crewCounters)) return undefined;
    const stored = record.cycleStats?.[cycle]?.[key];
    const legacy = !record.cycle || record.cycle === cycle ? record[key] : undefined;
    return (stored ?? legacy) == null ? effects.statBounds({}, cycle, key).value : undefined;
  }

  function render(snapshot) {
    const { profile, profileId, cycle, state, record, knowledge } = snapshot;
    context.textContent = `${profile.name || profileId} · 循环 ${["I", "II", "III", "IV", "V"][Number(cycle[1]) - 1]} · 第 ${state.day ?? "—"} 天`;
    fields.replaceChildren();
    entries.clear();
    const diplomacy = addGroup("阵营好感度");
    const ranges = cycle === "c2" ? [[0, "隐藏 −1"], [3, "怀疑 0"], [7, "友善 +1"], [12, "结盟 +2"]]
      : [[-10, cycle === "c5" ? "归顺 −3" : "开战 −3"], [-9, "恶劣 −2"], [-4, "交恶 −1"], [0, "中立 0"], [4, "友善 +1"], [8, "结盟 +2"]];
    for (const [key, label, min, max] of factions[cycle]) {
      const value = record.diplomacy?.[`${cycle}-${key}`];
      addRow(diplomacy, key, label, Number(value || 0), min, max, { ranges, unrecorded: value == null || value === "" });
    }
    const ship = addGroup("阿尔戈号");
    for (const [key, label] of [["hull", "船体"], ["crew", "船员"], ["fate", "命运"]]) {
      const { value, min, max } = effects.statBounds(record, cycle, key);
      addRow(ship, key, label, initialShipValue(record, cycle, key) ?? value, min, max);
    }
    addRow(ship, "knowledge", "知识", knowledge, starts[cycle], Number.MAX_SAFE_INTEGER);
    const supplies = addGroup("基础资源");
    if (cycle === "c1") {
      const { value, min, max } = effects.statBounds(record, cycle, "strangers");
      addRow(supplies, "strangers", "陌路人", value, min, max);
    }
    const dreamwalkers = effects.basicDreamwalkers(record).reduce((sum, titan) => sum + number(titan.count), 0);
    addRow(supplies, "dreamwalkers", "未命名梦行者", dreamwalkers, 0, Number.MAX_SAFE_INTEGER);
    const markers = addGroup("希望与灾厄");
    for (const key of Object.keys(rewardTracks)) {
      const target = markerTrack(state, cycle, key);
      const hint = !target.rule.allowed ? target.rule.note
        : target.remove ? "按当前卡面规则，登记希望时移除进展。" : "";
      addRow(markers, key, target.label, target.count, target.remove ? 0 : target.count,
        target.remove ? target.count : Number.MAX_SAFE_INTEGER,
        { direction: target.remove ? -1 : 1, locked: !target.rule.allowed, hint });
    }
    if (number(state.storyRewards?.hope) || number(state.storyRewards?.doom)) {
      const note = document.createElement("p");
      note.className = "story-settlement-hint";
      note.textContent = "此前暂存的标记可在主控台对应步骤放置。";
      markers.appendChild(note);
    }
    document.querySelector("#storySettlementRecord").href = `${root}record/index.html?cycle=${cycle}`;
  }

  function writeKnowledge(snapshot, value) {
    const { state, cycle, record, knowledge } = snapshot;
    if (!state.cardTracks) state.cardTracksVersion = 2;
    state.cardTracks = object(state.cardTracks);
    const track = state.cardTracks.inwardOdyssey = object(state.cardTracks.inwardOdyssey);
    state.inwardResolvedThrough ??= knowledge;
    track.position = value;
    const exploration = state.exploration = object(state.exploration);
    const byCycle = exploration.trackReceiptsByCycle = object(exploration.trackReceiptsByCycle);
    const receipts = byCycle[cycle] = object(byCycle[cycle]);
    for (const tx of record.explorationTrackTransactions || []) {
      if (tx.cycleId === cycle && tx.type === "knowledge") receipts[tx.id] = true;
    }
  }

  function buildSections(snapshot, changes) {
    const { cycle, record, state, dashboard } = snapshot;
    const sections = {};
    const deltas = [];
    for (const [key, { before, after }] of changes) {
      if (Object.hasOwn(rewardTracks, key)) {
        const target = markerTrack(state, cycle, key);
        if (!target.rule.allowed || before !== target.count || (target.remove ? after > before : after < before)) {
          throw new Error("卡面计数已变化，请重新确认标记去向。");
        }
        if (!state.cardTracks) state.cardTracksVersion = 2;
        state.cardTracks = object(state.cardTracks);
        const track = state.cardTracks[target.track] = object(state.cardTracks[target.track]);
        track[target.field] = after;
        sections.dashboard = dashboard;
      } else if (key === "knowledge") {
        writeKnowledge(snapshot, after);
        sections.dashboard = dashboard;
      } else if (["hull", "crew", "fate", "strangers"].includes(key)) {
        const initial = initialShipValue(record, cycle, key);
        if (initial !== undefined) {
          record.cycleStats = object(record.cycleStats);
          record.cycleStats[cycle] = object(record.cycleStats[cycle]);
          record.cycleStats[cycle][key] = String(initial);
        }
        deltas.push({ type: key, amount: after - before });
      } else if (key === "dreamwalkers") {
        effects.setBasicDreamwalkerCount(record, after);
        sections.record = record;
      } else {
        record.diplomacy = object(record.diplomacy);
        record.diplomacy[`${cycle}-${key}`] = String(after);
        sections.record = record;
      }
    }
    if (deltas.length) {
      const result = effects.apply(record, cycle, deltas);
      if (result.changes.length !== deltas.length
          || result.changes.some(({ type, amount }) => amount !== changes.get(type).after - changes.get(type).before)) {
        throw new Error("阿尔戈号数值超出当前轨道范围。");
      }
      sections.record = result.record;
    }
    return sections;
  }

  async function loadPanel() {
    const requestId = ++loadId;
    displayed = null;
    fields.replaceChildren();
    entries.clear();
    renderBill();
    context.textContent = "";
    status.textContent = "正在读取当前战役…";
    submit.disabled = true;
    if (!panel.open) panel.showModal();
    try {
      await options.beforeRead?.();
      const snapshot = await read();
      if (!panel.open || requestId !== loadId) return;
      render(snapshot);
      displayed = snapshot;
      status.textContent = "";
      renderBill();
    } catch (error) {
      if (requestId === loadId) status.textContent = error.message;
    }
  }

  reset.addEventListener("click", () => void loadPanel());
  close.addEventListener("click", () => panel.close());
  panel.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !displayed) return;
    busy = true;
    fields.disabled = true;
    submit.disabled = true;
    close.disabled = true;
    reset.disabled = true;
    try {
      const changes = new Map([...entries].filter(([, entry]) => entry.after !== entry.baseline)
        .map(([key, entry]) => [key, { before: entry.baseline, after: entry.after }]));
      if (!changes.size) { status.textContent = "没有需要保存的改动。"; return; }
      await options.beforeRead?.();
      const snapshot = await read();
      const initial = displayed;
      if (snapshot.profileId !== initial.profileId || snapshot.cycle !== initial.cycle
          || String(snapshot.state.day) !== String(initial.state.day)
          || ["dashboard", "record"].some(key => snapshot.campaign.sectionRevisions[key] !== initial.campaign.sectionRevisions[key])) {
        throw new Error(`战役进度已更新。${conflictHelp}`);
      }
      if (changes.has("hope-story")) {
        const target = markerTrack(snapshot.state, snapshot.cycle, "hope-story");
        if (target.remove && target.rule.gainCondition === "lastVisitedCity"
            && !window.confirm("确认当前板块是最后访问的城市？按当前主线卡规则，登记希望会移除相应数量的进展。")) return;
      }
      options.assertTarget?.(snapshot, session.accountId);
      const sections = buildSections(snapshot, changes);
      const response = await fetch(`${endpoint}?action=import-sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: snapshot.profileId,
          expectedAccountId: session.accountId,
          expectedRevisions: {
            dashboard: snapshot.campaign.sectionRevisions.dashboard,
            record: snapshot.campaign.sectionRevisions.record,
          },
          sections,
        }),
      });
      const payload = session.accept(await response.json());
      if (payload.code === "SAVE_CONFLICT") throw new Error(`战役进度已更新。${conflictHelp}`);
      if (!response.ok || !payload.ok) throw new Error(`未能保存。${conflictHelp}`);
      if (sections.record) recordSync?.postMessage({ revision: payload.sections.record });
      if (sections.dashboard) dashboardSync?.postMessage({ revision: payload.sections.dashboard });
      displayed = null;
      const saved = await read();
      render(saved);
      displayed = saved;
      await options.onSaved?.(sections);
      status.textContent = `已保存 ${changes.size} 项。`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      close.disabled = false;
      busy = false;
      fields.disabled = false;
      renderBill();
      if (!displayed) submit.disabled = true;
    }
  });
  return function openPanel() {
    if (displayed && !bill.hidden) panel.showModal();
    else return loadPanel();
  };
};
