(() => {
  const directionLabel = { 0: "上", 90: "右", 180: "下", 270: "左" };

  function create(mount, send, getState, triggerButton, receipt, showPreview, returnToDice) {
    const rules = window.ATO_FORCED_MOVEMENT;
    const { escape } = window.ATO_HERO_CATALOG;
    const editor = document.createElement("section");
    editor.className = "room-forced-editor";
    editor.hidden = true;
    editor.setAttribute("aria-labelledby", "roomForcedEffectTitle");
    editor.innerHTML = '<form><header><h3 id="roomForcedEffectTitle">非主动移动</h3>'
      + '<button type="button" data-forced-close>取消</button></header>'
      + '<div class="room-forced-fields"><label>效果<select name="kind">'
      + Object.entries(rules.names).map(([id, label]) => '<option value="' + id + '">' + label + '</option>').join("")
      + '</select></label><label>来源<select name="source"></select></label>'
      + '<label>受影响模型<select name="target"></select></label>'
      + '<div class="room-forced-amount" role="group" aria-label="有效格数"><span>有效格数</span>'
      + '<div><button type="button" data-forced-less aria-label="减少有效格数">−</button>'
      + '<output aria-label="有效格数" data-forced-amount>—</output>'
      + '<button type="button" data-forced-more aria-label="增加有效格数">+</button></div></div>'
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
      + '<footer>'
      + '<button type="submit" data-forced-confirm disabled>确认并同步</button></footer></form>';
    const form = editor.querySelector("form");
    const fields = form.elements;
    const preview = form.querySelector("[data-forced-preview]");
    const status = form.querySelector("[data-forced-status]");
    const help = form.querySelector("[data-forced-rule]");
    const submit = form.querySelector("[data-forced-confirm]");
    const cancel = form.querySelector("[data-forced-close]");
    const less = form.querySelector("[data-forced-less]");
    const more = form.querySelector("[data-forced-more]");
    const amountOutput = form.querySelector("[data-forced-amount]");
    let amount, suspendedTurn, boardStamp, previewMarkup;
    let trigger = "manual", bpResponseId, opener, choices, pendingId, previewAction, recordedError, displayedEffect;

    function modelLabel(room, seat) {
      return seat === "apostle" ? "骇物" : room.heroes[seat]?.name || "泰坦";
    }

    function cellLabel(room, id, point) {
      const size = id === "apostle" ? window.BattleTerrain.getApostleProfile(room.board.apostle, room.board.level)?.size ?? 1 : 1;
      const { column, row } = rules.upperLeft(point, size);
      return column + " 列 " + row + " 行" + (size > 1 ? "（左上占格）" : "");
    }

    function eventList(room, result) {
      const named = (item, label) => '<li>' + escape(modelLabel(room, item.model)) + ' · ' + escape(label)
        + '（' + cellLabel(room, item.model, item.point) + '）</li>';
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
        + '</strong><span>' + cellLabel(room, id, path[0]) + ' → ' + cellLabel(room, id, path.at(-1)) + '</span>'
        + '<small>' + (path.length - 1) + ' 格</small></div>';
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
      if (editor.hidden) return;
      if (triggerButton.hidden) { close(); return; }
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
          : "请按牌面和减免调整有效格数。冲撞及地形牌上的额外效果在结果中提示。";
      const effect = {
        kind, source: selected(fields.source), target: selected(fields.target), amount,
        trigger, direction: kind === "knockback" ? fields.direction.value : "",
        ...(trigger === "bp" && { bpResponseId }),
        wartimeCity: fields.wartimeCity.checked, terrainBoundary: fields.terrainBoundary.checked,
        ...(absolute && { absoluteException: fields.exception.checked }),
        ...(withRange && { attackRange: fields.attackType.value === "zone" ? "zone" : fields.attackType.value === "ranged" ? fields.attackRange.valueAsNumber : 1,
          attackMin: fields.attackType.value === "ranged" ? fields.attackMin.valueAsNumber : 1 }),
      };
      const nextStamp = rules.stamp(room, effect);
      if (nextStamp !== boardStamp) choices = [];
      boardStamp = nextStamp;
      effect.choices = choices;
      let result;
      if (effect.source !== null && effect.target !== null && Number.isFinite(effect.amount)) {
        const error = !rules.validActor(actor, effect) ? "队员只能处理自己参与的移动。"
          : trigger === "bp" ? rules.bpResponseError(room, effect) : "";
        result = error ? { error } : rules.plan(room, effect, window.BattleTerrain, window.BattleLOS);
      }
      previewAction = result && !result.error && !result.pending ? { effect, stamp: rules.stamp(room, effect) } : null;
      submit.disabled = !previewAction || Boolean(pendingId);
      cancel.disabled = Boolean(pendingId);
      amountOutput.value = amount ?? "—";
      less.disabled = Boolean(pendingId) || amount == null || amount === 0;
      more.disabled = Boolean(pendingId) || amount === 32;
      status.textContent = recordedError || (pendingId ? "正在同步版图…" : result?.error || "");
      showPreview({ effect, result: result?.error ? null : result });
      if (!result || result.error) {
        if (previewMarkup) preview.replaceChildren();
        previewMarkup = "";
        return;
      }
      const selection = result.decisions.map((decision, step) =>
        '<div class="room-forced-choice" role="group" aria-label="' + decision.type + '"><strong>' + decision.type + '</strong>'
        + (decision === result.pending ? '<small class="room-forced-board-hint">版图上的金色箭头是本格可选方向。</small>' : '')
        + decision.options.map(option => '<button type="button" data-forced-step="' + step + '" data-forced-option="' + option.id
          + '" aria-pressed="' + (choices[step] === option.id) + '"' + (pendingId ? ' disabled' : '') + '>'
          + '<span aria-hidden="true" class="room-forced-choice-check">✓ </span>' + option.label + ' · ' + cellLabel(room, decision.model, option.point) + '</button>').join("") + '</div>').join("");
      const nextMarkup = selection + '<div class="room-forced-paths">' + pathMarkup(room, result, "source", effect.source)
        + pathMarkup(room, result, "target", effect.target) + '</div>'
        + (kind === "push" && effect.source === "apostle" ? '<p>骇物朝向 · ' + (directionLabel[result.positions.apostle.facing] || "原朝向") + '</p>' : '')
        + '<p>使用 ' + result.used + ' / ' + effect.amount + ' 格'
        + (kind === "push" && result.approachSteps ? ' · 其中接近 ' + result.approachSteps + ' 格' : '') + '</p>'
        + (result.deaths.length ? '<p>确认将记录死亡。如有救生索等牌面例外，请先取消并按牌面结算。</p>' : '')
        + (result.sourcePath.length > 1 || result.targetPath.length > 1
          ? '<details><summary>逐格路线</summary><p>来源 · ' + result.sourcePath.map(point => cellLabel(room, effect.source, point)).join(" → ")
            + '</p><p>目标 · ' + result.targetPath.map(point => cellLabel(room, effect.target, point)).join(" → ") + '</p></details>' : '')
        + eventList(room, result);
      if (nextMarkup !== previewMarkup) {
        preview.innerHTML = nextMarkup;
        previewMarkup = nextMarkup;
      }
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

    function close() {
      editor.hidden = true;
      showPreview(null);
      if (suspendedTurn?.isConnected) suspendedTurn.open = true;
      suspendedTurn = null;
      const button = opener?.isConnected ? opener : opener?.dataset.forcedContext && mount.closest("#battleRoom")
        ?.querySelector('[data-forced-context="' + opener.dataset.forcedContext + '"]');
      if (button) {
        if (button.closest("#room-dice")) returnToDice?.();
        if (button !== triggerButton) button.scrollIntoView({ block: "nearest" });
        button.focus({ preventScroll: true });
      }
    }

    function resetPreview() {
      choices = [];
      recordedError = "";
      render();
    }
    cancel.addEventListener("click", close);
    editor.addEventListener("keydown", event => {
      if (event.key === "Escape" && !pendingId) {
        event.preventDefault();
        close();
      }
    });
    form.addEventListener("input", resetPreview);
    less.addEventListener("click", () => { amount -= 1; resetPreview(); });
    more.addEventListener("click", () => { amount = (amount ?? 0) + 1; resetPreview(); });
    preview.addEventListener("click", event => {
      const button = event.target.closest("[data-forced-option]");
      if (!button || pendingId) return;
      const { forcedOption: direction, forcedStep } = button.dataset;
      const step = Number(forcedStep);
      if (step > choices.length || choices[step] === direction) return;
      choices = [...choices.slice(0, step), direction];
      render();
      preview.querySelector('[data-forced-step="' + step + '"][aria-pressed="true"]')?.focus({ preventScroll: true });
    });
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!previewAction || pendingId) return;
      pendingId = crypto.randomUUID();
      send({ id: pendingId, type: "board-forced-effect", ...previewAction });
      render();
    });

    return {
      editor,
      open(context = {}, button = triggerButton) {
        const { room, actor } = getState();
        if (!room?.board || room.closed || actor.role === "viewer" || !editor.hidden) return false;
        form.reset();
        choices = [];
        recordedError = "";
        opener = button;
        suspendedTurn = mount.closest("#battleRoom")?.querySelector(".room-turn-window[open]");
        if (suspendedTurn) suspendedTurn.open = false;
        trigger = context.trigger || "manual";
        const response = trigger === "bp" ? rules.bpResponse(room) : null;
        bpResponseId = response?.id;
        fields.kind.value = trigger === "collision" ? "absolute" : "knockback";
        fields.kind.disabled = trigger === "collision";
        const roster = [["apostle", "骇物"], ...room.heroes.flatMap((hero, index) => hero.condition === "dead" ? [] : [[index, hero.name]])];
        populate(fields.source, roster, "apostle");
        populate(fields.target, roster, response?.seat ?? context.seat ?? (actor.role === "player" ? actor.seat : ""));
        const speed = window.BattleTerrain.getApostleProfile(room.board.apostle, room.board.level)?.speed;
        amount = trigger === "collision" && Number.isInteger(speed) && speed <= 32 ? speed : null;
        if (trigger === "ai" && Number.isInteger(context.range) && context.range > 1) {
          fields.attackType.value = "ranged";
          fields.attackRange.value = context.range;
        }
        editor.hidden = false;
        render();
        more.focus({ preventScroll: true });
        return true;
      },
      render,
      resolve(id, error) {
        if (pendingId !== id) return;
        pendingId = null;
        if (editor.hidden) return;
        if (!error) close();
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
