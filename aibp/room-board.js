(function () {
  function create(mount, send) {
    let room, actor, control, panel, settings, map, stamp = "", overlayStamp = "";
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
      settings.hidden = !canEdit();
      const settingsSummary = document.createElement("summary");
      settingsSummary.textContent = "版图与地形设置";
      const layoutOptions = panel.querySelector(".battle-map-head-actions");
      const terrainTools = panel.querySelectorAll(".battle-map-side > [data-board-host-only]:not([data-battle-map-los-control])");
      settings.append(settingsSummary, layoutOptions, ...terrainTools, open);
      panel.querySelector(".battle-map-side").append(settings);
      const terrainMode = panel.querySelector('[data-board-mode=""]');
      terrainMode.hidden = !canEdit();
      terrainMode.addEventListener("click", () => { settings.open = true; });
      panel.querySelector(".battle-movement-actions").append(finishTurn);
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
        getTitanMovement: (seat, forced) => (forced ? room.board.forcedTitanMoves : room.board.titanMoves)?.[seat],
        onTitanEndMove(seat, move, forced) {
          send({ type: "board-end-move", seat, move: move.id, forced });
        },
        onTitanUndoMove(seat, move, forced) {
          send({ type: "board-undo-move", seat, move: move.id, forced });
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
        onTitanMove(seat, point, speed, move, forced) {
          send({ type: "board-move", seat, point, from: room.board.map.pieces.titans[seat],
            speed, move: move?.id ?? null, forced });
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
        const livingRoster = room.heroes.map(hero => hero.condition === 'dead' ? null : hero.name);
        const nextBoardStamp = room.board === previous ? boardStamp : JSON.stringify(room.board);
        const stateKey = JSON.stringify([actor.role, room.closed, room.turn?.phase, room.priorityTarget, room.turn?.aiTarget, room.turn?.aiMovement, livingRoster]);
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
        if (control) control.render();
      },
    };
  }

  window.BattleRoomBoard = { create };
})();
