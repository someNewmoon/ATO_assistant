(function () {
  function create(mount, send, actions) {
    let room, actor, control, panel, settings, map, stamp = "", overlayStamp = "";
    const actionPanel = document.createElement("section");
    actionPanel.className = "room-titan-actions";
    actionPanel.setAttribute("aria-label", "泰坦行动");
    actionPanel.hidden = true;
    const { escape } = window.ATO_HERO_CATALOG;
    let actionMarkup = "";
    const reference = document.getElementById("battleMapControl")
      || document.getElementById("battleRoomBoardTemplate")?.content.querySelector("#battleMapControl");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "room-board-load";
    open.textContent = "载入当前骇物版图";
    open.addEventListener("click", () => {
      const layout = window.getAibpBoardSetup?.();
      if (!layout) return;
      send({ type: "board-setup", ...layout, layoutRevision: room.board?.layoutRevision });
    });

    const toolbar = document.createElement("div");
    toolbar.className = "room-board-turn-tools";
    const targetLabel = document.createElement("strong");
    targetLabel.textContent = "首要目标";
    const targets = document.createElement("div");
    targets.className = "room-seat-tabs";
    targets.setAttribute("role", "group");
    targets.setAttribute("aria-label", "首要目标");
    const lock = document.createElement("button");
    lock.type = "button";
    lock.textContent = "锁定标记";
    lock.dataset.priorityLock = "";
    lock.addEventListener("click", () => {
      if (!canEdit() || !Number.isInteger(room.priorityTarget?.seat)) return;
      send({ type: "priority-target", seat: room.priorityTarget.seat, locked: !room.priorityTarget.locked });
    });
    toolbar.append(targetLabel, targets, lock);
    mount.prepend(toolbar);

    const canEdit = () => actor?.role === "host" && !room.closed;
    const canMove = seat => !room.closed && room.heroes[seat]?.condition !== "dead" && (canEdit() || (actor.role === "player" && actor.seat === seat));
    const activeAttack = () => actions.inProgress(room.turn);
    const canMoveNormally = seat => room.turn?.phase === "titans" && (room.turn.seat === seat || room.turn.seat === null)
      && !room.turn.finished.includes(seat) && !room.turn.actions?.movementUsed && !activeAttack() && !room.turn.aiSignatureId;

    function renderActions() {
      const turn = room.turn;
      const bonus = turn?.bonusAttack;
      const seat = bonus?.seat ?? turn?.seat;
      const ownsBonus = bonus && !room.closed && (actor.role === "host" || actor.role === "player" && actor.seat === seat);
      actionPanel.hidden = !room.board || (bonus ? !ownsBonus
        : turn?.phase !== "titans" || !Number.isInteger(seat) || !canMove(seat));
      if (actionPanel.hidden) return;
      const activeMove = room.board.titanMoves?.[seat];
      const weapon = actions.weapon(seat);
      const attack = bonus || turn.actions?.attack;
      const canMoveHere = !turn.actions?.movementUsed && !activeAttack() && !turn.aiSignatureId;
      const legacy = !actions.tracked(seat);
      const canUseAttack = !legacy && !attack && !activeMove && !turn.aiSignatureId;
      const lockedWeapon = Boolean(attack && attack.stage !== "select");
      const weapons = actions.weapons(seat).map(item => {
        const src = actions.weaponArt(item.id);
        return '<button type="button" class="room-board-weapon" data-action-weapon="' + escape(item.id)
          + '" aria-pressed="' + (item.id === weapon?.id) + '"' + (lockedWeapon || !item.ready ? ' disabled' : '') + '>'
          + (src ? '<img src="' + escape(src) + '" alt="" decoding="async">' : '')
          + '<span>' + escape(item.name) + '</span>' + (item.ready ? '' : '<small>未回正</small>') + '</button>';
      }).join('');
      const range = weapon?.range;
      const rangeLabel = range ? actions.rangeLabel(range) : '';
      const manual = weapon?.manual && !lockedWeapon ? (weapon.printedRange
        ? '<details class="room-weapon-range-options" data-weapon="' + escape(weapon.id) + '"><summary>按条件调整射程</summary>' : '')
        + '<div class="room-turn-range"><label>牌面射程 <select data-action-range>'
        + '<option value="">选择牌面射程…</option>'
        + ['melee', 'reach', 'ranged'].map(kind => '<option value="' + kind + '"' + (range?.kind === kind ? ' selected' : '') + '>'
          + ({ melee: '近战', reach: '远触', ranged: '远程' })[kind] + '</option>').join('')
        + '</select></label><label' + (range?.kind === 'ranged' ? '' : ' hidden') + '>最小 <input data-action-min type="number" min="1" max="32" value="' + (range?.kind === "ranged" ? range.min : 2) + '"></label>'
        + '<label' + (range?.kind && range.kind !== 'melee' ? '' : ' hidden') + '>最大 <input data-action-max type="number" min="1" max="32" value="' + (range?.max > 1 ? range.max : 4) + '"></label>'
        + '<button type="button" data-action-range-confirm' + (range ? '' : ' disabled') + '>使用牌面射程</button></div>' + (weapon.printedRange ? '</details>' : '') : '';
      const legal = range && control?.weaponTarget(seat, range);
      const position = legal ? '距骇物 ' + legal.distance + ' 格 · ' + (legal.inRange ? '射程内' : '射程外')
        + ' · ' + (legal.visible ? '有视线' : '视线受阻') : '';
      const turnActions = '<div class="room-titan-action"><strong>移动</strong><small>'
        + (turn.actions?.movementUsed ? '已使用' : activeMove ? '剩余 ' + activeMove.remaining + ' / ' + activeMove.speed + ' 格' : '可用 1 次')
        + '</small><button type="button" data-action-entry="move"' + (canMoveHere ? '' : ' disabled') + '>'
        + (activeMove ? '继续移动' : '开始移动') + '</button></div>'
        + '<div class="room-titan-action"><strong>作战</strong><small>'
        + (legacy ? '按原流程结算' : attack?.stage === 'done' ? '已使用' : attack ? actions.stageLabel(attack.stage) : '可用 1 次')
        + '</small><button type="button" data-action-entry="attack"' + (canUseAttack || activeAttack() || legacy ? '' : ' disabled') + '>'
        + (attack ? '继续作战' : '查看作战') + '</button></div>';
      const bonusActions = bonus && '<div class="room-titan-action-weapon"><strong>奖励攻击 · ' + escape(room.heroes[seat].name)
        + '</strong><small>' + (lockedWeapon ? actions.stageLabel(attack.stage) : '按牌面触发，保留普通移动和作战行动。') + '</small>'
        + (lockedWeapon ? '<button type="button" data-action-entry="attack">继续奖励攻击</button>'
          : '<button type="button" class="secondary" data-action-entry="bonus-cancel">取消奖励攻击</button>') + '</div>';
      const next = (bonusActions || turnActions) + '<div class="room-titan-action-weapon"><strong>武器</strong>'
        + (weapons ? '<div class="room-board-weapon-list" role="group" aria-label="选择已装备武器">' + weapons + '</div>'
          : '<small>该英雄未装备武器。</small>')
        + (rangeLabel ? '<small>' + rangeLabel + '</small>' : '') + manual
        + (weapon && !lockedWeapon ? '<small>牌面费用与条件请手动核对。</small>' : '')
        + (position ? '<small>' + position + '</small>' : '')
        + ((bonus ? !lockedWeapon : canUseAttack) ? '<button type="button" data-action-entry="declare"'
          + (legal?.legal && weapon.ready ? '' : ' disabled') + '>'
          + (bonus ? '宣告奖励攻击' : '宣告攻击') + '</button>' : '') + '</div>'
        + (bonus ? '' : '<details class="room-titan-action-options"><summary>牌面行动</summary>'
        + '<button type="button" data-action-entry="bonus-start"' + (actions.canStartBonus(seat) ? '' : ' disabled') + '>结算奖励攻击</button>'
        + '<button type="button" data-action-entry="ability">牌面主动移动</button>'
        + '<button type="button" data-action-entry="spend-movement"' + (canMoveHere && !activeMove ? '' : ' disabled') + '>花费移动行动</button>'
        + '<button type="button" data-action-entry="spend-attack"' + (canUseAttack ? '' : ' disabled') + '>花费作战行动</button></details>');
      if (actionMarkup === next) return;
      const detailsOpen = actionPanel.querySelector(".room-titan-action-options")?.open;
      const adjustedWeapon = actionPanel.querySelector(".room-weapon-range-options[open]")?.dataset.weapon;
      const focused = actionPanel.contains(document.activeElement) && document.activeElement.dataset.actionWeapon;
      actionPanel.innerHTML = next;
      const details = actionPanel.querySelector(".room-titan-action-options");
      if (details) details.open = Boolean(detailsOpen);
      const adjustment = actionPanel.querySelector(".room-weapon-range-options");
      if (adjustment) adjustment.open = adjustedWeapon === weapon.id;
      if (focused) actionPanel.querySelector(`[data-action-weapon="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
      actionMarkup = next;
    }

    actionPanel.addEventListener("error", event => {
      if (event.target.matches(".room-board-weapon img")) event.target.remove();
    }, true);

    actionPanel.addEventListener("change", event => {
      const field = event.target;
      if (actionPanel.hidden) return;
      if (field.matches("[data-action-range]")) {
        const kind = field.value;
        actionPanel.querySelector("[data-action-min]").closest("label").hidden = kind !== "ranged";
        actionPanel.querySelector("[data-action-max]").closest("label").hidden = !["reach", "ranged"].includes(kind);
        actionPanel.querySelector("[data-action-range-confirm]").disabled = !kind;
      }
    });
    actionPanel.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button || button.disabled || actionPanel.hidden) return;
      const bonus = room.turn.bonusAttack;
      const seat = bonus?.seat ?? room.turn.seat;
      if (button.hasAttribute("data-action-weapon")) {
        actions.select(seat, button.dataset.actionWeapon);
        return;
      }
      if (button.hasAttribute("data-action-range-confirm")) {
        const kind = actionPanel.querySelector("[data-action-range]").value;
        const range = { kind, min: kind === "ranged" ? Number(actionPanel.querySelector("[data-action-min]").value) : 1,
          max: kind === "melee" ? 1 : Number(actionPanel.querySelector("[data-action-max]").value) };
        actions.selectRange(seat, range);
        return;
      }
      const entry = button.dataset.actionEntry;
      if (entry === "move" || entry === "ability") {
        control.openTitanMovement(seat, entry === "ability");
        const destination = window.matchMedia("(max-width: 640px)").matches ? grid : panel.querySelector("[data-board-tactics-info]");
        destination?.scrollIntoView({ block: "nearest" });
      } else if (entry === "attack") {
        control.openTitanAttack(seat);
        if (window.matchMedia("(max-width: 640px)").matches || activeAttack() || !actions.tracked(seat)) actions.openDice(seat);
      } else if (entry === "declare") {
        actions.declare(seat);
      } else if (entry === "bonus-start") {
        actions.startBonus(seat);
      } else if (entry === "bonus-cancel") {
        send({ type: "bonus-attack-cancel", seat, bonusId: bonus.id });
      } else if (entry?.startsWith("spend-") && window.confirm("确认按牌面花费这项行动？")) {
        send({ type: "turn-spend", seat, value: entry.slice(6) });
      }
    });

    const overlayConfig = ({ active, mode, selectedTitan, weaponControls, titanSpeeds, forced, elevated }) => ({
      active, mode, selectedTitan, weaponControls, titanSpeeds, forced, elevated,
    });

    let aiRoute, aiRouteStamp = "";
    let selectingPoint = false;
    let shownPing = null;
    let pingTimer;
    let pingStatusText = "";
    let grid;
    const pingBar = document.createElement("div");
    pingBar.className = "room-board-ping-bar";
    const pingButton = document.createElement("button");
    pingButton.type = "button";
    pingButton.textContent = "标记点位";
    const pingStatus = document.createElement("span");
    pingStatus.setAttribute("role", "status");
    const pingMarker = document.createElement("span");
    pingMarker.className = "room-board-ping";
    pingMarker.setAttribute("aria-hidden", "true");
    pingMarker.hidden = true;
    pingBar.append(pingButton, pingStatus);

    const canPing = () => Boolean(room?.board && !room.closed && ["host", "player"].includes(actor?.role));
    function renderPingStatus() {
      pingButton.setAttribute("aria-pressed", String(selectingPoint));
      grid?.classList.toggle("is-picking-point", selectingPoint);
      const label = shownPing ? shownPing.by + " · " + pingMarker.textContent : "";
      const next = selectingPoint ? "点选要标记的格子，再点按钮可取消。" : label;
      if (pingStatusText !== next) {
        pingStatusText = next;
        pingStatus.textContent = next;
      }
      pingBar.hidden = !canPing() && !label;
    }

    function showPing(ping) {
      if (shownPing?.id !== ping?.id) {
        clearTimeout(pingTimer);
        shownPing = ping?.expiresAt > Date.now() ? ping : null;
        pingMarker.hidden = !shownPing;
        if (shownPing) {
          const { COLUMNS, ROWS } = window.BattleLOS;
          const { row, column, expiresAt } = shownPing;
          pingMarker.style.left = (column - 1) / COLUMNS * 100 + "%";
          pingMarker.style.top = (ROWS - row) / ROWS * 100 + "%";
          pingMarker.textContent = String.fromCharCode(64 + row) + column;
          pingTimer = setTimeout(() => showPing(null), Math.max(0, expiresAt - Date.now()));
        }
      }
      renderPingStatus();
    }

    pingButton.addEventListener("click", () => {
      if (!canPing()) return;
      selectingPoint = !selectingPoint;
      renderPingStatus();
    });

    mount.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !selectingPoint) return;
      selectingPoint = false;
      renderPingStatus();
    });

    const finishTurn = document.createElement("button");
    finishTurn.type = "button";
    finishTurn.dataset.boardFinishTurn = "";
    finishTurn.textContent = "结束回合";
    finishTurn.addEventListener("click", () => {
      if (finishTurn.hidden) return;
      send({ type: "turn-finish", seat: room.turn.seat, round: room.round, phase: room.turn.phase });
    });

    function setup() {
      panel = reference.cloneNode(true);
      panel.id = "roomBattleMapControl";
      panel.querySelector("[data-battle-map-los-control]").hidden = true;
      settings = document.createElement("details");
      settings.className = "room-board-settings";
      settings.id = "roomBoardTerrainSettings";
      settings.hidden = !canEdit();
      const settingsSummary = document.createElement("summary");
      settingsSummary.textContent = "版图与地形设置";
      const layoutOptions = panel.querySelector(".battle-map-head-actions");
      const terrainTools = panel.querySelectorAll(".battle-map-side > [data-board-host-only]:not([data-battle-map-los-control])");
      settings.append(settingsSummary, layoutOptions, ...terrainTools, open);
      panel.querySelector(".battle-map-side").append(settings);
      const terrainMode = panel.querySelector('[data-board-mode=""]');
      terrainMode.hidden = !canEdit();
      terrainMode.setAttribute("aria-controls", settings.id);
      const syncTerrainDisclosure = () => terrainMode.setAttribute("aria-expanded", String(settings.open));
      syncTerrainDisclosure();
      settings.addEventListener("toggle", syncTerrainDisclosure);
      terrainMode.addEventListener("click", () => {
        settings.open = !settings.open;
        syncTerrainDisclosure();
      });
      panel.querySelector("[data-board-tactics]").addEventListener("click", event => {
        if (event.target.closest('[data-board-mode]:not([data-board-mode=""]), [data-board-place-boss]')) {
          settings.open = false;
        }
      });
      const tactics = panel.querySelector("[data-board-tactics]");
      const movementActions = panel.querySelector(".battle-movement-actions");
      const preview = document.createElement("button");
      preview.type = "button"; preview.dataset.boardPreviewDestination = ""; preview.hidden = true;
      const ability = document.createElement("label");
      ability.hidden = true;
      ability.innerHTML = '<input data-board-ability-move type="checkbox">牌面主动移动';
      const forced = tactics.querySelector("[data-board-forced-field]");
      forced.after(ability, preview);
      movementActions.append(finishTurn);
      tactics.before(actionPanel);
      grid = panel.querySelector("[data-battle-map-board]");
      panel.querySelector(".battle-map-head").append(pingBar);
      grid.append(pingMarker);
      mount.append(panel);
      const cards = panel.querySelector(".battle-map-cards");
      const details = document.createElement("details");
      details.className = "room-board-terrain";
      const summary = document.createElement("summary");
      summary.textContent = "地形卡";
      cards.before(details);
      details.append(summary, cards);
      cards.querySelector("h4").hidden = true;
      control = window.BattleMapControl.create({
        root: panel, assetBase: "../ss/terrain", cardAssetBase: "../ss/terrain-cards",
        openImageZoom: window.openAibpBoardImage || ((src, label) => window.ATO_BATTLE_ASSETS?.zoom(src, label)),
        getMap: () => map,
        getApostle: () => room.board.apostle,
        getLevel: () => room.board.level,
        getTitanTrail: () => room.board.lastTitanMove,
        forcedByPhase: () => room.turn?.phase === "apostle",
        normalSpeed: actions.speed,
        boardWeapon: seat => actor.role === "viewer" ? { range: room.board.los?.weapon } : actions.weapon(seat),
        canExecuteMove: (seat, forced, ability) => forced || ability || canMoveNormally(seat),
        getTitanMovement: (seat, forced, ability) =>
          (forced ? room.board.forcedTitanMoves : ability ? room.board.abilityTitanMoves : room.board.titanMoves)?.[seat],
        onTitanEndMove(seat, move, forced, ability) {
          send({ type: "board-end-move", seat, move: move.id, forced, ability });
        },
        onTitanUndoMove(seat, move, forced, ability) {
          send({ type: "board-undo-move", seat, move: move.id, forced, ability });
        },
        getApostleTrail: () => room.board.lastApostleMove,
        getApostleMovement: () => room.board.apostleMovement,
        onApostleUndoMove(move) {
          send({ type: "board-apostle-undo", move: move.id });
        },
        onApostleEndMove(move) {
          send({ type: "board-apostle-end", move: move.id });
        },
        titanNames: () => room.heroes.map(({ titan, name }) =>
          window.ATO_GEAR_INVENTORY.dreamwalkerPanel(titan)?.name || titan?.name || name),
        titanRoster: () => room.heroes.map(hero => hero.titan),
        priorityTarget: () => room.priorityTarget?.seat,
        aiTarget: () => room.turn?.aiTarget,
        aiRoute: () => aiRoute,
        pendingCollisionSeats: () => room.turn?.aiMovement?.pending ? room.turn.aiMovement.crossedSeats : [],
        deadSeats: () => room.heroes.flatMap((hero, seat) => hero.condition === "dead" ? [seat] : []),
        heroPortraits: () => room.heroes.map(hero => {
          const path = window.ATO_HERO_CATALOG.heroPortrait(hero);
          return path && '../hero/assets/' + path;
        }),
        onBoardPoint(point) {
          if (!selectingPoint || !canPing() || !point) return false;
          selectingPoint = false;
          renderPingStatus();
          send({ type: "board-ping", point });
          return true;
        },
        canEditBoard: canEdit, canMoveTitan: canMove,
        allowTacticalControls: actor.role !== "viewer", alwaysRenderPieces: true,
        setMap(next) {
          if (!canEdit()) return;
          map = next;
          send({ type: "board-layout", map: next, keepTitans: Boolean(next.pieces),
            layoutRevision: room.board.layoutRevision });
        },
        onApostleMove(point, limit) {
          send({ type: "board-apostle-move", point, from: room.board.map.pieces.apostle,
            move: room.board.apostleMovement?.id ?? null, ...(limit !== null && { speed: limit }) });
        },
        onApostleFace(facing) {
          send({ type: "board-face", facing });
        },
        onTitanMove(seat, point, speed, move, forced, ability) {
          send({ type: "board-move", seat, point, from: room.board.map.pieces.titans[seat],
            speed, move: move?.id ?? null, forced, ability });
        },
        onLosChange() {
          if (!canEdit()) return;
          const overlay = overlayConfig(control.getLosSnapshot({ keepTactics: true }));
          const next = JSON.stringify(overlay);
          if (next === overlayStamp) return;
          overlayStamp = next;
          send({ type: "board-overlay", overlay });
        },
      });
    }

    let boardStamp, livingRosterKey;
    return {
      sync(nextRoom, nextActor) {
        const previous = room?.board;
        const previousBattle = room?.squad?.battleNumber;
        const previousSeat = room?.turn?.seat;
        room = nextRoom;
        actor = nextActor;
        mount.hidden = !room.board && !canEdit();
        mount.classList.toggle("room-tactical-read-only", actor.role === "viewer" || room.closed);
        open.hidden = !canEdit();
        if (!room.board && open.parentNode !== mount) mount.append(open);
        if (settings) settings.hidden = !canEdit();
        if (!canPing() || previousBattle !== room.squad?.battleNumber || previous?.apostle !== room.board?.apostle) {
          selectingPoint = false;
        }
        pingButton.hidden = !canPing();
        showPing(room.board && !room.closed ? room.boardPing : null);
        if (!room.board) { toolbar.hidden = true; stamp = null; return; }
        const seat = room.turn?.seat;
        finishTurn.hidden = room.turn?.phase !== "titans" || !Number.isInteger(seat) || !canMove(seat);
        finishTurn.disabled = Boolean(activeAttack() || room.board.titanMoves?.[seat]
          || room.board.abilityTitanMoves?.[seat] || room.turn?.aiSignatureId);
        const livingRoster = room.heroes.map(hero => hero.condition === 'dead' ? null : hero.name);
        const nextBoardStamp = room.board === previous ? boardStamp : JSON.stringify(room.board);
        const actingSeat = room.turn?.bonusAttack?.seat ?? seat;
        const stateKey = JSON.stringify([actor.role, room.closed, room.turn, room.priorityTarget, livingRoster,
          Number.isInteger(actingSeat) ? room.heroes[actingSeat]?.gear : null, room.deckRevision, room.projection?.bpPending]);
        if (nextBoardStamp === boardStamp && stateKey === stamp) return;
        boardStamp = nextBoardStamp;
        stamp = stateKey;
        const rosterKey = JSON.stringify(livingRoster);
        if (rosterKey !== livingRosterKey) {
          const buttons = livingRoster.flatMap((name, seat) => {
            if (name === null) return [];
            const button = document.createElement("button");
            button.type = "button";
            button.dataset.prioritySeat = String(seat);
            const portrait = window.ATO_HERO_CATALOG.heroPortrait(room.heroes[seat]);
            if (portrait) {
              const image = document.createElement("img");
              image.src = "../hero/assets/" + portrait;
              image.alt = "";
              button.append(image);
            }
            button.append(name);
            button.addEventListener("click", () => {
              if (!canEdit() || room.priorityTarget?.seat === seat) return;
              send({ type: "priority-target", seat, locked: room.priorityTarget?.locked === true });
            });
            return [button];
          });
          targets.replaceChildren(...buttons);
          livingRosterKey = rosterKey;
        }
        for (const button of targets.children) {
          button.setAttribute("aria-pressed", String(Number(button.dataset.prioritySeat) === room.priorityTarget?.seat));
        }
        lock.disabled = !Number.isInteger(room.priorityTarget?.seat);
        lock.setAttribute("aria-pressed", String(room.priorityTarget?.locked === true));
        toolbar.hidden = !canEdit();
        map = room.board.map;
        const existing = Boolean(control);
        if (!existing) setup();
        if (open.parentNode !== settings) settings.append(open);
        if (actor.role === "player" && existing && previous?.apostle === room.board.apostle
            && previousBattle === room.squad?.battleNumber) control.render();
        else {
          const snapshot = actor.role === "player" ? {
            ...room.board.los, active: false, mode: "", selectedTitan: actor.seat,
          } : room.board.los;
          control.applyTacticalSnapshot(snapshot);
          overlayStamp = JSON.stringify(overlayConfig(control.getLosSnapshot({ keepTactics: true })));
        }
        if (Number.isInteger(seat) && canMove(seat) && room.board.titanMoves?.[seat] && (!previous?.titanMoves?.[seat] || !existing)) {
          control.openTitanMovement(seat);
        }
        renderActions();
        if (existing && Number.isInteger(previousSeat) && room.turn?.finished.includes(previousSeat)) {
          control.closeFinishedMovement(previousSeat);
        }
      },
      setAiRoute(route) {
        const next = JSON.stringify(route) || "";
        if (next === aiRouteStamp) return;
        aiRouteStamp = next;
        aiRoute = route;
        control?.render();
      },
      openBonusAttack(seat) {
        if (!control || actionPanel.hidden || room.turn?.bonusAttack?.seat !== seat) return false;
        control.openTitanAttack(seat);
        actionPanel.scrollIntoView({ block: "nearest" });
        return true;
      },
      openForcedMovement(seat) {
        if (!control || room.turn?.phase !== "apostle" || !canMove(seat) || !control.openTitanMovement(seat)) return false;
        const speed = panel.querySelector("[data-board-speed]");
        if (speed.disabled) panel.querySelector("[data-board-tactics-info]").scrollIntoView({ block: "center" });
        else {
          speed.scrollIntoView({ block: "center" });
          speed.focus({ preventScroll: true });
          speed.select();
        }
        return true;
      },
      render() {
        if (control) { control.render(); renderActions(); }
      },
    };
  }

  window.BattleRoomBoard = { create };
})();
