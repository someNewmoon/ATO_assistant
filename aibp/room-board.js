(function () {
  function create(mount, send) {
    let room, actor, control, map, stamp = "", overlayStamp = "";
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
    const target = document.createElement("label");
    target.append("首要目标 ");
    const targetSelect = document.createElement("select");
    target.append(targetSelect);
    const lock = document.createElement("label");
    const lockInput = document.createElement("input");
    lockInput.type = "checkbox";
    lock.append(lockInput, " 锁定标记");
    const confirm = () => {
      if (targetSelect.value !== "") send({ type: "priority-target", seat: Number(targetSelect.value), locked: lockInput.checked });
    };
    targetSelect.addEventListener("change", confirm);
    lockInput.addEventListener("change", confirm);
    const undo = document.createElement("div");
    toolbar.append(target, lock, undo);
    mount.prepend(toolbar);

    const canEdit = () => actor?.role === "host" && !room.closed;
    const canMove = seat => !room.closed && (canEdit() || (actor.role === "player" && actor.seat === seat));
    const overlayConfig = ({ active, mode, selectedTitan, weaponControls, titanSpeeds, elevated }) => ({
      active, mode, selectedTitan, weaponControls, titanSpeeds, elevated,
    });

    function setup() {
      const panel = reference.cloneNode(true);
      panel.id = "roomBattleMapControl";
      panel.querySelector("[data-battle-map-los-control]").hidden = true;
      for (const node of panel.querySelectorAll("[data-board-host-only], .battle-map-head-actions")) {
        if (!canEdit()) node.hidden = true;
      }
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
        getTitanMovement: seat => room.board.titanMoves?.[seat],
        onTitanEndMove(seat) {
          const move = room.board.titanMoves?.[seat];
          if (move) send({ type: "board-end-move", seat, move: move.id });
        },
        getApostleTrail: () => room.board.lastApostleMove,
        titanNames: () => room.heroes.map(({ titan, name }) =>
          window.ATO_GEAR_INVENTORY.dreamwalkerPanel(titan)?.name || titan?.name || name),
        titanRoster: () => room.heroes.map(hero => hero.titan),
        priorityTarget: () => room.priorityTarget?.seat,
        heroPortraits: () => room.heroes.map(hero => {
          const path = window.ATO_HERO_CATALOG.heroPortrait(hero);
          return path && '../hero/assets/' + path;
        }),
        canEditBoard: canEdit, canMoveTitan: canMove,
        allowTacticalControls: actor.role !== "viewer", alwaysRenderPieces: true,
        setMap(next) {
          if (!canEdit()) return;
          map = next;
          send({ type: "board-layout", map: next, keepTitans: Boolean(next.pieces),
            layoutRevision: room.board.layoutRevision });
        },
        onApostleMove(point) {
          send({ type: "board-apostle-move", point, from: room.board.map.pieces.apostle });
        },
        onApostleFace(facing) {
          send({ type: "board-face", facing });
        },
        onTitanMove(seat, point, speed) {
          send({ type: "board-move", seat, point, from: room.board.map.pieces.titans[seat],
            speed, move: room.board.titanMoves?.[seat]?.id ?? null });
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

    return {
      sync(nextRoom, nextActor) {
        const previous = room?.board;
        const previousBattle = room?.squad?.battleNumber;
        room = nextRoom;
        actor = nextActor;
        mount.hidden = !room.board && !canEdit();
        mount.classList.toggle("room-tactical-read-only", actor.role === "viewer" || room.closed);
        open.hidden = !canEdit();
        if (open.parentNode !== mount) mount.append(open);
        if (!room.board) { toolbar.hidden = true; return; }
        const stateKey = JSON.stringify([room.board, actor.role, room.closed, room.priorityTarget, room.heroes.map(hero => hero.condition)]);
        if (stateKey === stamp) return;
        stamp = stateKey;
        target.hidden = !canEdit();
        lock.hidden = !canEdit();
        const living = room.heroes.flatMap((hero, seat) => hero.condition === 'dead' ? [] : [new Option(hero.name, seat)]);
        targetSelect.replaceChildren(...living);
        targetSelect.value = room.priorityTarget?.seat ?? '';
        lockInput.checked = room.priorityTarget?.locked === true;
        lockInput.disabled = !living.length;
        const buttons = Object.values(room.board.titanMoves || {}).filter(move => canMove(move.seat)).map(move => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "撤回上一步 · " + room.heroes[move.seat].name;
          button.addEventListener("click", () => {
            send({ type: "board-undo-move", seat: move.seat, move: move.id });
          });
          return button;
        });
        undo.replaceChildren(...buttons);
        toolbar.hidden = !canEdit() && !buttons.length;
        map = room.board.map;
        const existing = Boolean(control);
        if (!existing) setup();
        if (actor.role === "player" && existing && previous?.apostle === room.board.apostle
            && previousBattle === room.squad?.battleNumber) control.render();
        else {
          const snapshot = actor.role === "player" ? {
            ...room.board.los, active: false, mode: "", selectedTitan: actor.seat,
          } : room.board.los;
          control.applyTacticalSnapshot(snapshot);
          overlayStamp = JSON.stringify(overlayConfig(control.getLosSnapshot({ keepTactics: true })));
        }
      },
      render() {
        if (control) control.render();
      },
    };
  }

  window.BattleRoomBoard = { create };
})();
