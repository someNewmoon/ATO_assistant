(() => {
  const panel = document.querySelector("#storyMainRecord");
  if (!panel || new URLSearchParams(location.search).has("squad")) return;

  const endpoint = "../api/campaign-state.php?section=dashboard";
  const session = window.ATO_CAMPAIGN_SESSION.create();
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("ato-dashboard-sync-v1") : null;
  const fields = panel.querySelector("fieldset");
  const count = panel.querySelector("[data-main-record-count]");
  const status = panel.querySelector("[role=status]");
  const checks = Array.from({ length: 8 }, (_, index) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = `0014:${index + 1}`;
    input.setAttribute("aria-label", `第 ${index + 1} 格`);
    const number = document.createElement("span");
    number.textContent = index + 1;
    label.append(input, number);
    fields.append(label);
    return input;
  });
  let current;
  let saving;
  let reading = 0;
  let refreshAfterSave = false;

  function render() {
    const values = current?.state.mainStoryConstants || {};
    for (const [index, input] of checks.entries()) {
      input.checked = Boolean(values[input.value] || (index === 0 && values["0014"]));
    }
    count.textContent = current ? `已标注 ${checks.filter(input => input.checked).length} / ${checks.length}` : "";
    fields.disabled = !current || Boolean(saving);
  }

  async function read(message = "") {
    if (panel.hidden) return;
    if (saving) {
      refreshAfterSave = true;
      return;
    }
    const request = ++reading;
    fields.disabled = true;
    if (!current) status.textContent = "正在读取定数框…";
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (panel.hidden || request !== reading) return;
      if (response.status === 401) throw new Error("登录主控台后可调整定数框。");
      const payload = session.accept(await response.json());
      if (panel.hidden || request !== reading) return;
      if (!response.ok || !payload.ok) throw new Error("读取失败，请重新打开段落重试。");
      const archive = payload.state;
      const profile = archive?.profiles?.[archive.activeProfileId];
      const state = profile?.cycles?.c1?.state;
      if (!state || profile.activeCycleId !== "c1") throw new Error("请在主控台选择循环 I 的存档。");
      const voyage = window.ATO_VOYAGE?.current();
      if (voyage && (voyage.accountId !== session.accountId || voyage.profileId !== archive.activeProfileId
          || voyage.cycle !== "c1" || voyage.day !== String(state.day))) {
        throw new Error("原航行的存档或日期已变更，请从当前主控台重新打开。");
      }
      current = { archive, state, revision: payload.revision };
      status.textContent = message;
    } catch (error) {
      if (request !== reading) return;
      current = null;
      status.textContent = error.message;
    } finally {
      if (request === reading) render();
    }
  }

  async function save(slot, checked) {
    const { archive, revision } = current;
    const next = structuredClone(archive);
    const state = next.profiles[next.activeProfileId].cycles.c1.state;
    const values = state.mainStoryConstants ||= {};
    if (values["0014"]) values["0014:1"] = true;
    delete values["0014"];
    if (checked) values[slot] = true;
    else delete values[slot];
    state.mainStoryConstantsActive = checked ? slot
      : values[state.mainStoryConstantsActive] ? state.mainStoryConstantsActive
      : checks.find(input => values[input.value])?.value || null;
    state.mainStoryConstantsDay ||= `c1:${Math.max(0, Number(state.day || 0))}`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "dashboard", state: next, expectedRevision: revision, expectedAccountId: session.accountId }),
      });
      const payload = session.accept(await response.json());
      if (payload.code === "SAVE_CONFLICT") {
        refreshAfterSave = true;
        throw new Error("存档已在别处更新，请核对后再勾选。");
      }
      if (!response.ok || !payload.ok) throw new Error("定数框未保存，请重试。");
      current = { archive: next, state, revision: payload.revision };
      channel?.postMessage({ revision: payload.revision });
      status.textContent = "已存档";
      return true;
    } catch (error) {
      if (session.changed) current = null;
      status.textContent = error.message;
      return false;
    }
  }

  fields.addEventListener("change", async event => {
    const input = event.target;
    if (!checks.includes(input) || saving || !current) return;
    status.textContent = "正在保存…";
    fields.disabled = true;
    saving = save(input.value, input.checked);
    await saving;
    saving = null;
    render();
    if (refreshAfterSave) {
      refreshAfterSave = false;
      await read(status.textContent);
    }
  });
  channel?.addEventListener("message", ({ data }) => {
    if (current && data?.revision <= current.revision) return;
    void read(status.textContent === "已存档" ? status.textContent : "");
  });
  window.addEventListener("focus", () => void read(status.textContent === "已存档" ? status.textContent : ""));

  window.ATO_STORY_MAIN_RECORD = {
    show(entry, text) {
      const visible = entry?.key === "c1-3-19";
      if (visible) {
        // Keep the original text for projection and narration. Hide the OCR box row in the reader.
        for (const row of text.querySelectorAll("p")) {
          if (/^(?:[囗□☐]\s*){8}$/.test(row.textContent.trim())) row.hidden = true;
        }
      }
      if (panel.hidden === !visible) return;
      panel.hidden = !visible;
      if (visible) void read();
    },
    flush() { return saving || true; },
  };
})();
