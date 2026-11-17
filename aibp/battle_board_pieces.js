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
    image.setAttribute("width", sprite.size[0]);
    image.setAttribute("height", sprite.size[1]);
    image.setAttribute("clip-path", "url(#" + id + ")");
    if (sprite.nativeFace != null) svg.style.transform = "rotate(" + (facing - sprite.nativeFace * 90) + "deg)";
    svg.append(defs, image);
    return svg;
  }

  function render(layer, pieces, {
    apostle, size = 1, selected = 0, mode, names = [], roster, portraits = [], onSelect, onSelectBoss,
  } = {}) {
    layer.replaceChildren();
    layer.hidden = false;
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
      if (boss) {
        const facing = document.createElement("span");
        facing.className = "battle-piece-facing";
        facing.style.transform = "translate(-50%, -50%) rotate(" + piece.facing + "deg)";
        facing.textContent = "▲";
        marker.appendChild(facing);
      }
      layer.appendChild(marker);
    }
    token(pieces.apostle, size, "骇物", null, sprites[spriteKeys[apostle]]);
    pieces.titans.forEach((piece, index) => {
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
