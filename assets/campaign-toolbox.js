(function () {
  if (new URLSearchParams(location.search).get("second") === "1") return;

  const script = document.currentScript;
  const root = new URL("../", script.src).href;
  const options = window.ATO_CAMPAIGN_TOOLBOX_OPTIONS || {};
  const tooltip = document.createElement("details");
  tooltip.className = "campaign-toolbox";
  tooltip.open = !script.hasAttribute("data-start-collapsed")
    && !(script.hasAttribute("data-start-collapsed-on-mobile") && window.matchMedia("(max-width: 640px)").matches);
  tooltip.innerHTML = `<summary>工具箱 <span data-toolbox-draft hidden></span></summary>
    <div class="campaign-toolbox-menu">
      <button type="button" data-tool="settlement" aria-haspopup="dialog">阿尔戈号快捷结算</button>
      <button type="button" data-tool="nemesis" aria-haspopup="dialog">推进宿敌</button>
      <button type="button" data-tool="heroes" aria-haspopup="dialog">英雄状态</button>
      <p role="status" hidden></p>
    </div>`;
  if (options.before) options.before.before(tooltip);
  else (options.container || document.body).append(tooltip);
  const summary = tooltip.querySelector("summary");
  const draft = tooltip.querySelector("[data-toolbox-draft]");
  const status = tooltip.querySelector("[role=status]");
  const buttons = [...tooltip.querySelectorAll("[data-tool]")];
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = `${root}story/assets/quick-settlement.css?v=20261124-hero-status`;
  if (!document.querySelector('link[href*="quick-settlement.css"]')) document.head.append(style);

  function load(path, api) {
    if (window[api]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = root + path;
      script.onload = () => window[api] ? resolve() : reject(new Error("工具未能初始化，请重试。"));
      script.onerror = () => {
        script.remove();
        reject(new Error("工具加载失败，请重试。"));
      };
      document.head.append(script);
    });
  }

  let openSettlement, openNemesis, openHeroes;
  async function initialize(tool) {
    const session = load("assets/campaign-session.js?v=20260917", "ATO_CAMPAIGN_SESSION");
    if (tool === "settlement") {
      await Promise.all([
        session,
        load("assets/story-doom-card-data.js", "ATO_STORY_DOOM_DATA"),
        load("assets/exploration-card-effects.js", "ATO_EXPLORATION_EFFECT_RULES"),
        load("story/assets/quick-settlement.js?v=20261120-toolbox", "ATO_MOUNT_QUICK_SETTLEMENT"),
      ]);
      return openSettlement ||= window.ATO_MOUNT_QUICK_SETTLEMENT({
        root, title: "阿尔戈号快捷结算", beforeRead: options.beforeRead,
        assertTarget: options.assertTarget, onSaved: options.onSettlementSaved,
        onDraftCount(count) {
          draft.hidden = !count;
          draft.textContent = count ? `· ${count} 项未保存` : "";
        },
      });
    }
    if (tool === "heroes") {
      await Promise.all([
        session,
        load("hero/hero-catalog.js?v=20261117-battle-polish", "ATO_HERO_CATALOG"),
        load("assets/campaign-hero-tool.js?v=20261124-hero-status", "ATO_MOUNT_HERO_TOOL"),
      ]);
      return openHeroes ||= window.ATO_MOUNT_HERO_TOOL(root, options);
    }
    await Promise.all([
      session,
      load("map/map-data.js?v=20260730-cycle-labels", "ATO_MAP_DATA"),
      load("map/nemesis-path.js?v=20261120-toolbox", "ATO_NEMESIS_PATH"),
      load("map/nemesis-battle.js?v=20261120-toolbox", "ATO_NEMESIS_BATTLE"),
      load("assets/exploration-pursuit.js?v=20261120-toolbox", "ATO_EXPLORATION_PURSUIT"),
      load("assets/campaign-nemesis-tool.js?v=20261120-toolbox", "ATO_MOUNT_NEMESIS_TOOL"),
    ]);
    return openNemesis ||= window.ATO_MOUNT_NEMESIS_TOOL(root, options);
  }

  tooltip.addEventListener("click", async event => {
    const button = event.target.closest("[data-tool]");
    if (!button || button.disabled) return;
    tooltip.open = true;
    status.hidden = true;
    buttons.forEach(item => { item.disabled = true; });
    try {
      const open = await initialize(button.dataset.tool);
      if (!tooltip.open) return;
      await open();
    } catch (error) {
      status.textContent = error.message;
      status.hidden = false;
      tooltip.open = true;
    } finally {
      buttons.forEach(item => { item.disabled = false; });
    }
  });

  tooltip.addEventListener("keydown", event => {
    if (event.key === "Escape" && tooltip.open) {
      tooltip.open = false;
      summary.focus();
      event.stopPropagation();
    }
  });
})();
