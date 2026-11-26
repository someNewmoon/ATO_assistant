(() => {
  const directionLabel = { 0: "上", 90: "右", 180: "下", 270: "左" };
  const cellLabel = point => point.column + " 列 " + point.row + " 行";

  function create(mount, send, getState, triggerButton, receipt) {
    const rules = window.ATO_FORCED_MOVEMENT;
    const { escape } = window.ATO_HERO_CATALOG;
    const dialog = document.createElement("dialog");
    dialog.className = "room-forced-dialog";
    dialog.setAttribute("aria-labelledby", "roomForcedEffectTitle");
    dialog.innerHTML = '<form><header><h3 id="roomForcedEffectTitle">非主动移动</h3>'
      + '<button type="button" data-forced-close>取消</button></header>'
      + '<div class="room-forced-fields"><label>效果<select name="kind">'
      + Object.entries(rules.names).map(([id, label]) => '<option value="' + id + '">' + label + '</option>').join("")
      + '</select></label><label>来源<select name="source"></select></label>'
      + '<label>受影响模型<select name="target"></select></label>'
      + '<label>有效格数<input name="amount" type="number" min="0" max="32" step="1" required inputmode="numeric"></label>'
      + '<label data-forced-direction>方向<select name="direction"><option value="">按站位推导</option>'
      + rules.directions.map(dir => '<option value="' + dir.id + '">按牌面朝' + dir.label + '</option>').join("")
      + '</select></label></div><div data-forced-attack-range hidden class="room-forced-fields">'
      + '<label>本次攻击范围<select name="attackType"><option value="melee">近战 · 相邻</option>'
      + '<option value="ranged">按距离</option><option value="zone">按牌面核对指定区域</option></select></label>'
      + '<label data-forced-attack-distance hidden>最近<input name="attackMin" type="number" min="1" max="32" value="1"></label>'
      + '<label data-forced-attack-distance hidden>最远<input name="attackRange" type="number" min="1" max="32" value="1"></label>'
      + '</div><p data-forced-rule></p><label data-forced-exception hidden>'
      + '<input type="checkbox" name="exception">牌面明确允许本次绝对击退减免</label>'
      + '<label data-forced-city hidden><input type="checkbox" name="wartimeCity">受影响城市为交战状态，视为障碍</label>'
      + '<label data-forced-boundary hidden><input type="checkbox" name="terrainBoundary">按牌面将边界地形作为版图边界</label>'
      + '<div data-forced-preview></div><p data-forced-status role="status" aria-live="polite"></p>'
      + '<footer><button type="button" data-forced-reset hidden>重选路线</button>'
      + '<button type="submit" data-forced-confirm disabled>确认并同步</button></footer></form>';
    mount.append(dialog);
    const form = dialog.querySelector("form");
    const fields = form.elements;
    const preview = form.querySelector("[data-forced-preview]");
    const status = form.querySelector("[data-forced-status]");
    const help = form.querySelector("[data-forced-rule]");
    const submit = form.querySelector("[data-forced-confirm]");
    const cancel = form.querySelector("[data-forced-close]");
    const reset = form.querySelector("[data-forced-reset]");
    let trigger = "manual", opener, choices, pendingId, previewAction, recordedError, displayedEffect;

    function modelLabel(room, seat) {
      return seat === "apostle" ? "骇物" : room.heroes[seat]?.name || "泰坦";
    }

    function eventList(room, result) {
      const named = (item, label) => '<li>' + escape(modelLabel(room, item.model)) + ' · ' + escape(label)
        + '（' + cellLabel(item.point) + '）</li>';
      const events = [
        ...result.collisions.map(item => named(item, "冲撞，按牌面结算凶险和击倒")),
        ...result.displaced.map(item => named({ model: item.model, point: item.to }, "移位")),
        ...result.events.map(item => named(item, item.message)),
        ...result.endSeats.map(seat => named({ model: seat, point: result.positions?.titans[seat]
          || room.board.map.pieces.titans[seat] }, "骇物落点重叠，核对绝对击退")),
      ];
      return events.length ? '<ul class="room-forced-events">' + events.join("") + '</ul>' : '';
    }

    function pathMarkup(room, result, who, id) {
      const path = result[who + "Path"];
      return '<div><strong>' + (who === "source" ? "来源" : "目标") + ' · ' + escape(modelLabel(room, id))
        + '</strong><span>' + cellLabel(path[0]) + ' → ' + cellLabel(path.at(-1)) + '</span>'
        + '<small>' + (path.length - 1) + ' 格</small></div>';
    }

    function mapMarkup(result) {
      const markers = (path, who) => path.map((point, index) =>
        '<span class="room-forced-marker ' + who + '" aria-hidden="true" style="left:'
        + (point.column - .5) * 5 + '%;top:' + (14.5 - point.row) / .14 + '%">'
        + (index || (who === "source" ? "源" : "目")) + '</span>').join("");
      return '<div class="room-forced-grid" aria-hidden="true">'
        + markers(result.sourcePath, "source") + markers(result.targetPath, "target") + '</div>';
    }

    function selected(element) {
      return element.value === "apostle" ? "apostle" : element.value === "" ? null : Number(element.value);
    }

    function populate(field, roster, selectedId) {
      const ids = roster.map(([id]) => String(id));
      const previous = String(selectedId ?? field.value);
      const signature = JSON.stringify(roster);
      if (field.dataset.roster !== signature) {
        field.dataset.roster = signature;
        field.replaceChildren(new Option("请选择", ""), ...roster.map(([id, label]) => new Option(label, id)));
      }
      field.value = ids.includes(previous) ? previous : "";
    }

    function render() {
      const { room, actor } = getState();
      triggerButton.hidden = !room?.board || room.closed || actor?.role === "viewer";
      renderReceipt(room, actor);
      if (!dialog.open || !room?.board) return;
      const roster = [["apostle", "骇物"], ...room.heroes.flatMap((hero, index) => hero.condition === "dead" ? [] : [[index, hero.name]])];
      populate(fields.source, roster);
      populate(fields.target, roster);
      for (const element of form.querySelectorAll("select,input")) {
        element.disabled = Boolean(pendingId) || element === fields.kind && trigger === "collision";
      }
      const kind = fields.kind.value;
      const absolute = kind === "absolute";
      if (absolute) fields.source.value = "apostle";
      form.querySelector("[data-forced-exception]").hidden = !absolute;
      form.querySelector("[data-forced-direction]").hidden = kind !== "knockback";
      const withRange = trigger === "ai" && kind === "knockback";
      form.querySelector("[data-forced-attack-range]").hidden = !withRange;
      for (const label of form.querySelectorAll("[data-forced-attack-distance]")) {
        label.hidden = !withRange || fields.attackType.value !== "ranged";
      }
      form.querySelector("[data-forced-city]").hidden = !room.board.map.terrain.some(tile => tile.name === "City");
      form.querySelector("[data-forced-boundary]").hidden = !room.board.map.terrain.some(tile => /^(?:Black Glacier|Track Tile|Trench)/.test(tile.name));
      help.textContent = absolute ? "仅用于骇物落点内的泰坦。按骇物移速和加成填入格数。只有牌面明确说明时才可减免。"
        : trigger === "bp" && kind === "knockback" ? "部位牌骇物响应的击退只影响相邻攻击者。"
          : "请按牌面和减免填写有效格数。冲撞及地形牌上的额外效果在结果中提示。";
      const effect = {
        kind, source: selected(fields.source), target: selected(fields.target), amount: fields.amount.valueAsNumber,
        trigger, direction: kind === "knockback" ? fields.direction.value : "", choices,
        wartimeCity: fields.wartimeCity.checked, terrainBoundary: fields.terrainBoundary.checked,
        ...(absolute && { absoluteException: fields.exception.checked }),
        ...(withRange && { attackRange: fields.attackType.value === "zone" ? "zone" : fields.attackType.value === "ranged" ? fields.attackRange.valueAsNumber : 1,
          attackMin: fields.attackType.value === "ranged" ? fields.attackMin.valueAsNumber : 1 }),
      };
      let result;
      if (effect.source !== null && effect.target !== null && Number.isFinite(effect.amount)) {
        result = rules.validActor(actor, effect) ? rules.plan(room, effect, window.BattleTerrain, window.BattleLOS)
          : { error: "队员只能处理自己参与的移动。" };
      }
      previewAction = result && !result.error && !result.pending ? { effect, stamp: rules.stamp(room, effect) } : null;
      submit.disabled = !previewAction || Boolean(pendingId);
      cancel.disabled = Boolean(pendingId);
      reset.hidden = !choices.length;
      reset.disabled = Boolean(pendingId);
      status.textContent = recordedError || (pendingId ? "正在同步版图…" : result?.error || "");
      if (!result || result.error) {
        preview.replaceChildren();
        return;
      }
      const selection = result.pending
        ? '<div class="room-forced-choice" role="group" aria-label="' + result.pending.type + '"><strong>' + result.pending.type + '</strong>'
          + result.pending.options.map(option => '<button type="button" data-forced-option="' + option.id + '">'
            + option.label + ' · ' + cellLabel(option.point) + '</button>').join("") + '</div>' : '';
      preview.innerHTML = '<div class="room-forced-paths">' + pathMarkup(room, result, "source", effect.source)
        + pathMarkup(room, result, "target", effect.target) + '</div>'
        + (kind === "push" && effect.source === "apostle" ? '<p>骇物朝向 · ' + (directionLabel[result.positions.apostle.facing] || "原朝向") + '</p>' : '')
        + '<p>使用 ' + result.used + ' / ' + effect.amount + ' 格</p>'
        + (result.deaths.length ? '<p>确认将记录死亡。如有救生索等牌面例外，请先取消并按牌面结算。</p>' : '')
        + mapMarkup(result) + (result.sourcePath.length > 1 || result.targetPath.length > 1
          ? '<details><summary>逐格路线</summary><p>来源 · ' + result.sourcePath.map(cellLabel).join(" → ")
            + '</p><p>目标 · ' + result.targetPath.map(cellLabel).join(" → ") + '</p></details>' : '')
        + selection + eventList(room, result);
    }

    function renderReceipt(room, actor) {
      const last = room?.board?.lastForcedEffect;
      if (last === displayedEffect) return;
      displayedEffect = last;
      receipt.hidden = !last;
      if (!last) { receipt.replaceChildren(); return; }
      const absoluteButtons = actor.role === "host" ? last.endSeats : last.endSeats.filter(seat => seat === actor.seat);
      receipt.innerHTML = '<strong>上次非主动移动 · ' + rules.names[last.kind] + '</strong>'
        + '<div class="room-forced-paths">' + pathMarkup(room, last, "source", last.source)
        + pathMarkup(room, last, "target", last.target) + '</div>' + eventList(room, last)
        + (room.closed || actor.role === "viewer" ? '' : absoluteButtons.filter(seat => room.heroes[seat]?.condition !== "dead").map(seat =>
          '<button type="button" data-forced-context="collision" data-forced-seat="' + seat + '">结算 '
          + escape(modelLabel(room, seat)) + ' 的绝对击退</button>').join(""));
    }

    function restoreFocus() {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else if (opener?.dataset.forcedContext) mount.closest('#battleRoom')
        ?.querySelector('[data-forced-context="' + opener.dataset.forcedContext + '"]')?.focus({ preventScroll: true });
    }
    cancel.addEventListener("click", () => dialog.close());
    dialog.addEventListener("cancel", event => { if (pendingId) event.preventDefault(); });
    dialog.addEventListener("close", restoreFocus);
    form.addEventListener("input", () => {
      choices = [];
      recordedError = "";
      render();
    });
    preview.addEventListener("click", event => {
      const direction = event.target.closest("[data-forced-option]")?.dataset.forcedOption;
      if (!direction || pendingId) return;
      choices = [...choices, direction];
      render();
      preview.querySelector("[data-forced-option]")?.focus({ preventScroll: true });
    });
    reset.addEventListener("click", () => { choices = []; recordedError = ""; render(); });
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!previewAction || pendingId) return;
      pendingId = crypto.randomUUID();
      send({ id: pendingId, type: "board-forced-effect", ...previewAction });
      render();
    });

    return {
      open(context = {}, button = triggerButton) {
        const { room, actor } = getState();
        if (!room?.board || room.closed || actor.role === "viewer" || dialog.open) return false;
        form.reset();
        choices = [];
        recordedError = "";
        opener = button;
        trigger = context.trigger || "manual";
        fields.kind.value = trigger === "collision" ? "absolute" : "knockback";
        fields.kind.disabled = trigger === "collision";
        const roster = [["apostle", "骇物"], ...room.heroes.flatMap((hero, index) => hero.condition === "dead" ? [] : [[index, hero.name]])];
        populate(fields.source, roster, "apostle");
        populate(fields.target, roster, context.seat ?? (actor.role === "player" ? actor.seat : ""));
        const speed = window.BattleTerrain.getApostleProfile(room.board.apostle, room.board.level)?.speed;
        if (trigger === "collision" && Number.isInteger(speed) && speed <= 32) fields.amount.value = speed;
        if (trigger === "ai" && Number.isInteger(context.range) && context.range > 1) {
          fields.attackType.value = "ranged";
          fields.attackRange.value = context.range;
        }
        dialog.showModal();
        render();
        fields.amount.focus();
        return true;
      },
      render,
      resolve(id, error) {
        if (pendingId !== id) return;
        pendingId = null;
        if (!error && dialog.open) dialog.close();
        else {
          recordedError = error;
          choices = [];
          render();
        }
      },
    };
  }

  window.ATO_FORCED_MOVEMENT_UI = { create };
})();
