(function () {
  const spriteKeys = {
    HEKATON: "hekaton", LABYRINTHAUROS: "labyrinthauros",
    ALPHA_TEMENOS: "temenos", HERMESIAN_PURSUER: "pursuer",
  };
  const svgNS = "http://www.w3.org/2000/svg";
  const accents = ["#79d1ef", "#f1c57d", "#b8df97", "#d8a8f9"];
  let nextClip = 0;

  function spriteNode(document, sprite, facing) {
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", sprite.crop.join(" "));
    svg.setAttribute("aria-hidden", "true");
    if (sprite.restored) {
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.dataset.restoredArtwork = "true";
      const image = document.createElementNS(svgNS, "image");
      image.setAttribute("href", sprite.restored);
      image.setAttribute("width", "100"); image.setAttribute("height", "100");
      image.setAttribute("preserveAspectRatio", "xMidYMid meet"); svg.appendChild(image);
      svg.style.transform = "rotate(" + (facing - sprite.nativeFace * 90) + "deg)";
      return svg;
    }
    const defs = document.createElementNS(svgNS, "defs");
    const clip = document.createElementNS(svgNS, "clipPath");
    const path = document.createElementNS(svgNS, "path");
    const id = "battle-piece-clip-" + ++nextClip;
    clip.setAttribute("id", id);
    path.setAttribute("d", sprite.path);
    clip.appendChild(path);
    defs.appendChild(clip);
    const image = document.createElementNS(svgNS, "image");
    image.setAttribute("href", sprite.url);
    if (sprite.offset) {
      image.setAttribute("x", sprite.offset[0]);
      image.setAttribute("y", sprite.offset[1]);
    }
    image.setAttribute("width", sprite.size[0]);
    image.setAttribute("height", sprite.size[1]);
    image.setAttribute("clip-path", "url(#" + id + ")");
    if (sprite.nativeFace != null) svg.style.transform = "rotate(" + (facing - sprite.nativeFace * 90) + "deg)";
    svg.append(defs, image);
    return svg;
  }

  function drawTrail(layer, trail, boss = false) {
    const route = trail?.route;
    if (!route || route.length < 2) return;
    const document = layer.ownerDocument;
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 20 14");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "battle-piece-trail" + (boss ? " battle-piece-boss-trail" : ""));
    svg.setAttribute("role", "img");
    const square = ({ column, row }) => String.fromCharCode(64 + row) + column;
    svg.setAttribute("aria-label", (boss ? "骇物正交移动路线 " : "泰坦移动路线 ") + route.map(square).join(" → "));
    svg.style.setProperty("--piece-accent", boss ? "#f4a284" : accents[trail.seat]);
    const line = document.createElementNS(svgNS, "polyline");
    line.setAttribute("points", route.map(({ column, row }) => (column - 0.5) + "," + (14.5 - row)).join(" "));
    line.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(line);
    for (const [index, { column, row }] of route.entries()) {
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", column - 0.5);
      dot.setAttribute("cy", 14.5 - row);
      dot.setAttribute("r", index === 0 ? 0.32 : 0.12);
      dot.setAttribute("class", index === 0 ? "trail-origin" : "trail-step");
      svg.appendChild(dot);
      if (boss && index > 0) {
        const label = document.createElementNS(svgNS, "text");
        label.setAttribute("x", column - .5); label.setAttribute("y", 14.4 - row);
        label.setAttribute("class", "trail-step-number"); label.setAttribute("text-anchor", "middle");
        label.textContent = String(index); svg.appendChild(label);
      }
    }
    layer.appendChild(svg);
  }

  function drawPriorityLink(layer, boss, target) {
    if (!boss || !target) return;
    const document = layer.ownerDocument;
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 20 14");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "battle-piece-priority-link");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "骇物到首要目标的连线");
    const overlapping = boss.column === target.column && boss.row === target.row;
    const shape = document.createElementNS(svgNS, overlapping ? "circle" : "line");
    const attributes = overlapping
      ? { cx: target.column - .5, cy: 14.5 - target.row, r: .58 }
      : { x1: boss.column - .5, y1: 14.5 - boss.row, x2: target.column - .5, y2: 14.5 - target.row };
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    shape.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(shape);
    layer.appendChild(svg);
  }

  function render(layer, pieces, {
    apostle, size = 1, selected = 0, mode, names = [], roster, portraits = [], deadSeats = [], priorityTarget, priorityVisible, trail, bossTrail, onSelect, onSelectBoss,
  } = {}) {
    layer.replaceChildren();
    layer.hidden = false;
    if (!deadSeats.includes(trail?.seat)) drawTrail(layer, trail);
    drawTrail(layer, bossTrail, true);
    if (priorityVisible) drawPriorityLink(layer, pieces.apostle, pieces.titans[priorityTarget]);
    const document = layer.ownerDocument;
    const sprites = window.BattleBoardSprites || {};
    function token(piece, span, name, index, sprite, fallback) {
      const boss = index === null;
      const select = boss ? onSelectBoss : onSelect && (() => onSelect(index));
      const interactive = Boolean(select);
      const marker = document.createElement(interactive ? "button" : "div");
      if (interactive) {
        marker.type = "button";
        marker.addEventListener("click", event => {
          event.stopPropagation();
          select();
        });
      }
      marker.className = "battle-piece " + (boss ? "battle-piece-apostle" : "battle-piece-titan");
      marker.classList.toggle("is-selected", boss ? mode?.startsWith("apostle-") : selected === index && mode?.startsWith("titan-"));
      if (!boss) marker.style.setProperty("--piece-accent", accents[index]);
      marker.style.left = (piece.column - 0.5) * 5 + "%";
      marker.style.top = (14 - piece.row + 0.5) / 14 * 100 + "%";
      marker.style.width = span * 5 + "%";
      marker.style.height = span / 14 * 100 + "%";
      const square = String.fromCharCode(64 + Math.ceil(piece.row)) + Math.ceil(piece.column);
      marker.setAttribute("aria-label", name + " " + square);
      marker.title = name + " " + square;
      if (sprite) marker.appendChild(spriteNode(document, sprite, piece.facing));
      else if (fallback) {
        const image = document.createElement("img");
        image.src = fallback;
        image.alt = "";
        marker.appendChild(image);
      }
      const label = document.createElement("span");
      label.className = "battle-piece-label";
      label.textContent = boss ? "骇" : String(index + 1);
      marker.appendChild(label);
      if (!boss && portraits[index]) {
        const avatar = document.createElement("img");
        avatar.className = "battle-piece-hero";
        avatar.alt = "";
        avatar.src = portraits[index];
        marker.appendChild(avatar);
      }
      if (!boss && priorityTarget === index) {
        const priority = document.createElement("span");
        priority.className = "battle-piece-priority";
        priority.textContent = "◎";
        priority.title = "首要目标";
        priority.setAttribute("aria-hidden", "true");
        marker.appendChild(priority);
        marker.setAttribute("aria-label", name + " " + square + " · 首要目标");
      }
      if (boss) {
        const facing = document.createElement("span");
        facing.className = "battle-piece-facing";
        facing.style.transform = "translate(-50%, -50%) rotate(" + piece.facing + "deg)";
        facing.textContent = "▲";
        facing.setAttribute("aria-hidden", "true");
        marker.appendChild(facing);
      }
      layer.appendChild(marker);
    }
    token(pieces.apostle, size, "骇物", null, sprites[spriteKeys[apostle]]);
    pieces.titans.forEach((piece, index) => {
      if (deadSeats.includes(index)) return;
      const titan = roster?.[index];
      const panel = window.ATO_GEAR_INVENTORY?.dreamwalkerPanel(titan);
      const type = window.ATO_GEAR_INVENTORY?.titanType(titan);
      const sprite = sprites[roster ? (panel?.sprite || type?.id) : "t" + (index + 1)];
      const portrait = titan && !sprite ? window.ATO_BATTLE_ASSETS?.titanArt(titan) : null;
      token(piece, 1, names[index] || "泰坦 " + (index + 1), index, sprite,
        portrait?.label === "查看泰坦插图" ? portrait.src : null);
    });
  }

  window.BattleBoardPieces = { render };
})();
