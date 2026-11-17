(function () {
  function create(mount, send) {
    let room, actor, control, map, stamp = "", overlayStamp = "";
    const reference = document.getElementById("battleMapControl");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "room-board-load";
    open.textContent = "载入当前骇物版图";
    open.addEventListener("click", () => {
      const layout = window.getAibpBoardSetup?.();
      if (!layout) return;
      send({ type: "board-setup", ...layout, layoutRevision: room.board?.layoutRevision });
    });

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
        openImageZoom: window.openAibpBoardImage,
        getMap: () => map,
        getApostle: () => room.board.apostle,
        getLevel: () => room.board.level,
        titanNames: () => room.heroes.map(({ titan, name }) =>
          window.ATO_GEAR_INVENTORY.dreamwalkerPanel(titan)?.name || titan?.name || name),
        titanRoster: () => room.heroes.map(hero => hero.titan),
        heroPortraits: () => room.heroes.map(hero => {
          const path = window.ATO_HERO_CATALOG.heroPortrait(hero);
          return path && '../hero/assets/' + path;
        }),
        canEditBoard: canEdit, canMoveTitan: canMove,
        allowTacticalControls: actor.role !== "viewer",
        tacticalOnly: actor.role !== "host",
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
          send({ type: "board-move", seat, point, from: room.board.map.pieces.titans[seat], speed });
        },
        onLosChange() {
          if (!canEdit()) return;
          const overlay = overlayConfig(control.getLosSnapshot());
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
        room = nextRoom;
        actor = nextActor;
        mount.hidden = !room.board && !canEdit();
        mount.classList.toggle("room-tactical-read-only", actor.role === "viewer" || room.closed);
        open.hidden = !canEdit();
        if (open.parentNode !== mount) mount.append(open);
        if (!room.board) return;
        const stateKey = JSON.stringify([room.board, actor.role, room.closed]);
        if (stateKey === stamp) return;
        stamp = stateKey;
        map = room.board.map;
        const existing = Boolean(control);
        if (!existing) setup();
        if (actor.role === "player" && existing && previous?.apostle === room.board.apostle) control.render();
        else {
          const snapshot = actor.role === "player" ? {
            ...room.board.los, mode: "titan-move", selectedTitan: actor.seat,
          } : room.board.los;
          control.applyTacticalSnapshot(snapshot);
          overlayStamp = JSON.stringify(overlayConfig(control.getLosSnapshot()));
        }
      },
      render() {
        if (control) control.render();
      },
    };
  }

  window.BattleRoomBoard = { create };
})();
