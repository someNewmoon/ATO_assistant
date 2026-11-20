(() => {
  const directions = [
    ["upper-left", "左上", -1, -1], ["up", "上", 0, -1], ["upper-right", "右上", 1, -1],
    ["left", "左", -1, 0], ["current", "当前位置", 0, 0], ["right", "右", 1, 0],
    ["lower-left", "左下", -1, 1], ["down", "下", 0, 1], ["lower-right", "右下", 1, 1],
  ];
  const routeDirections = new Set(["up", "right", "down", "left"]);
  const layouts = new WeakMap();

  function routeTarget(cycle, state, tile, direction) {
    if (!routeDirections.has(direction)) return "";
    return window.ATO_NEMESIS_PATH.effectiveTile(cycle, state, tile).neighbors?.[direction] || "";
  }

  function nearbyTiles(cycle, state) {
    const current = cycle?.tiles.find(tile => tile.id === state?.currentTile);
    if (!current) return [];
    if (!layouts.has(cycle)) layouts.set(cycle, window.ATO_NEMESIS_PATH.displayLayout(cycle));
    const layout = layouts.get(cycle);
    const origin = layout.position(current);
    const byId = new Map(cycle.tiles.map(tile => [tile.id, tile]));
    const neighbors = new Map();
    for (const tile of cycle.tiles) {
      if (tile.id === current.id) continue;
      const position = layout.position(tile);
      const x = (position.x - origin.x) / layout.tileWidth;
      const y = (position.y - origin.y) / layout.tileWidth;
      const dx = Math.round(x), dy = Math.round(y);
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (!dx && !dy)) continue;
      const distance = Math.hypot(x - dx, y - dy);
      const key = `${dx},${dy}`;
      if (distance <= 0.4 && distance < (neighbors.get(key)?.distance ?? Infinity)) {
        neighbors.set(key, { tile, distance });
      }
    }
    return directions.map(([direction, label, dx, dy]) => {
      const route = byId.get(routeTarget(cycle, state, current, direction));
      const tile = direction === "current" ? current : route || neighbors.get(`${dx},${dy}`)?.tile;
      return { direction, label, tile, available: Boolean(route) };
    });
  }

  function revealed(state, id) {
    const markers = state.tokens?.markers?.[id];
    return Boolean(state.explored?.[id] || state.previewRevealed?.[id]
      || markers?.hs || markers?.ENGIN || markers?.night_nymph);
  }

  function revealedFace(cycle, state, tile) {
    if (state.tileVariants?.[tile.id] === "alternate") {
      if (cycle.id === "c5") return tile.back || tile.front;
      if (cycle.id === "c1" && Object.hasOwn(window.ATO_NEMESIS_PATH.c1AlternateTileConnections, tile.id)) {
        return `./images/c1-tile-${tile.id}-alt-front.jpg`;
      }
    }
    return tile.front;
  }

  window.ATO_MAP_NAVIGATION = { nearbyTiles, routeTarget, revealed, revealedFace };
})();
