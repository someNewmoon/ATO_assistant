(() => {
  const directions = [
    { id: "up", label: "上", dc: 0, dr: 1, facing: 0 },
    { id: "right", label: "右", dc: 1, dr: 0, facing: 90 },
    { id: "down", label: "下", dc: 0, dr: -1, facing: 180 },
    { id: "left", label: "左", dc: -1, dr: 0, facing: 270 },
  ];
  const names = { knockback: "击退", push: "推斥", pull: "拖拽", absolute: "绝对击退" };
  const terrainNames = {
    Column: "圆柱", City: "城市", "Ambrosia Pool": "神浆池", "Fortified City": "固防城市",
    "Time-Frozen City": "时间冻结城市",
  };
  function terrainLabel(tile) {
    if (tile.name === "City" && tile.flipped) return "废墟城市";
    if (tile.name.startsWith("Lightwall ")) return "光墙 " + tile.name.slice("Lightwall ".length);
    return terrainNames[tile.name] || tile.name;
  }
  const opposite = direction => directions.find(other => other.dc === -direction.dc && other.dr === -direction.dr);
  const pointKey = ({ column, row }) => column + "," + row;
  const translate = (point, direction) => ({
    column: point.column + direction.dc, row: point.row + direction.dr,
  });
  const upperLeft = (point, size = 1) => ({
    column: Math.round(point.column - (size - 1) / 2),
    row: Math.round(point.row + (size - 1) / 2),
  });
  const model = (room, id) => id === "apostle" ? room.board?.map.pieces?.apostle
    : Number.isInteger(id) && room.heroes[id]?.condition !== "dead" ? room.board?.map.pieces?.titans[id] : null;

  function validActor(actor, input) {
    return actor.role === "host" || actor.role === "player" && (input.source === actor.seat || input.target === actor.seat);
  }

  function bpResponse(room) {
    const { turn, secondAbility: settled } = room;
    if (room.projection?.bpPending) {
      const seat = room.battleDeck?.bpSeat ?? room.bpSeat;
      const revision = room.battleDeck?.revision ?? room.deckRevision;
      return { seat, id: "pending:" + revision };
    }
    const attack = turn?.bonusAttack || turn?.actions?.attack;
    const seat = turn?.bonusAttack?.seat ?? turn?.seat;
    if (attack?.stage === "cleanup" && settled?.round === room.round && settled.seat === seat
        && settled.roll && settled.roll === attack.powerRoll) {
      return { seat, id: settled.id, settled: true };
    }
    return null;
  }

  function bpResponseError(room, input) {
    const response = bpResponse(room);
    if (!response || (input.bpResponseId != null || response.settled) && input.bpResponseId !== response.id) {
      return "部位牌响应步骤已更新，请从本次威力结算重新打开。";
    }
    if (Number.isInteger(response.seat) && ![input.source, input.target].includes(response.seat)) {
      return "请对当前部位牌的攻击者结算响应。";
    }
    return "";
  }

  function stamp(room, input) {
    const { board, turn } = room;
    return JSON.stringify([board.apostle, board.level, board.layoutRevision, board.map.pieces,
      board.map.terrain.map(({ id, name, column, row, rotation, flipped }) => [id, name, column, row, rotation, flipped]),
      room.heroes.map(hero => hero.condition), turn?.phase, turn?.aiSignatureId, turn?.aiGuide, turn?.aiTarget,
      turn?.actions?.attack?.stage, turn?.bonusAttack?.id, turn?.bonusAttack?.stage,
      room.projection?.aiPending, room.projection?.ai?.src, room.projection?.signature,
      room.projection?.bpPending, room.projection?.bp?.src, input]);
  }

  function plan(room, input, terrainApi, los) {
    const board = room.board;
    const { kind, source, target, amount, trigger = "manual", direction, choices = [], wartimeCity = false } = input;
    const sourceStart = model(room, source), targetStart = model(room, target);
    if (!board || !sourceStart || !targetStart || source === target || !Object.hasOwn(names, kind)
        || !Number.isInteger(amount) || amount < 0 || amount > 32
        || !Array.isArray(choices) || choices.length > 72 || choices.some(choice => !directions.some(dir => dir.id === choice))
        || !["manual", "ai", "bp", "collision"].includes(trigger)
        || direction && !directions.some(dir => dir.id === direction)) {
      return { error: "请选择不同的棋子和 0 至 32 格的有效距离。" };
    }

    const size = terrainApi.getApostleProfile(board.apostle, board.level)?.size || 1;
    const width = id => id === "apostle" ? size : 1;
    const half = id => (width(id) - 1) / 2;
    const cells = (id, point) => los.losSourceCells(point, width(id)).map(({ c, r }) => ({ column: c, row: r }));
    const distance = (a, aId, b, bId) => {
      const pads = half(aId) + half(bId);
      return Math.max(0, Math.abs(a.column - b.column) - pads) + Math.max(0, Math.abs(a.row - b.row) - pads);
    };
    const initialDistance = distance(sourceStart, source, targetStart, target);
    const isKnockback = kind === "knockback" || kind === "absolute";
    if (kind === "absolute") {
      if (source !== "apostle" || target === "apostle" || initialDistance !== 0) return { error: "绝对击退只处理骇物落点内的泰坦。" };
      const speed = terrainApi.getApostleProfile(board.apostle, board.level)?.speed;
      if (!input.absoluteException && Number.isFinite(speed) && amount < speed) {
        return { error: "绝对击退不能减免。若牌面明确适用于绝对击退，请确认该例外。" };
      }
    }
    if (trigger === "collision" && kind !== "absolute") return { error: "骇物落点重叠时使用绝对击退。" };
    if (trigger === "bp" && isKnockback && source === "apostle" && initialDistance !== 1) {
      return { error: "部位牌骇物响应的击退只影响相邻攻击者。" };
    }
    if (trigger === "ai" && isKnockback) {
      const min = input.attackMin ?? 1;
      if (source !== "apostle" || target === "apostle") return { error: "骇物攻击的击退来源须为骇物。" };
      if (input.attackRange !== "zone" && (!Number.isInteger(input.attackRange) || input.attackRange < 1
          || input.attackRange > 32 || !Number.isInteger(min) || min < 1 || min > input.attackRange
          || initialDistance < min || initialDistance > input.attackRange)) return { error: "目标须在这次攻击的有效范围内。" };
    }

    const positions = new Map(room.heroes.flatMap((hero, seat) => {
      const point = model(room, seat);
      return point ? [[seat, { ...point }]] : [];
    }));
    positions.set("apostle", { ...board.map.pieces.apostle });
    const sourcePath = [sourceStart], targetPath = [targetStart];
    const displaced = [], collisions = [], deaths = new Set(), seenCollisions = new Set();
    const destroyed = new Set(), flipped = new Set(), checkedTiles = new Set();
    const events = [], decisions = [];
    let pending, invalid, usedChoices = 0, spent = 0, approachSteps = 0;
    let facing = board.map.pieces.apostle.facing;
    const occ = los.buildOccluders(board.map.terrain, terrainApi);
    const tiles = new Map();
    board.map.terrain.forEach((tile, index) => {
      const def = terrainApi.catalog[tile.name];
      if (!def) return;
      los.footprintCells(tile, def.width, def.height, terrainApi.getTileLosData(tile).cells).forEach(({ c, r }) => {
        const key = c + "," + r;
        if (!tiles.has(key)) tiles.set(key, []);
        tiles.get(key).push({ tile, index });
      });
    });
    const terrainAt = (id, point) => [...new Map(cells(id, point).flatMap(cell =>
      (tiles.get(pointKey(cell)) || []).filter(entry => !destroyed.has(entry.index)).map(entry => [entry.index, entry]))).values()];
    const facts = ({ tile, index }) => {
      const name = tile.name;
      const city = name === "City";
      return {
        boundary: /^(?:Black Glacier|Track Tile|Trench)/.test(name) && input.terrainBoundary === true,
        chasm: /^Maze Fissure /.test(name),
        obstacle: name === "Column" || /^Lightwall /.test(name) || city && wartimeCity,
        solid: /^Cliff /.test(name) || ["Floating Rocks", "Staircase Entrance", "Irem Tower"].includes(name),
        reinforced: city && !tile.flipped && !flipped.has(index),
        fragile: name === "Column" || /^Lightwall /.test(name) || (city && (tile.flipped || flipped.has(index)))
          || ["Time-Frozen City", "Trireme Graveyard"].includes(name),
        review: !/^(?:Labyrinth |Maze Fissure |Cliff )/.test(name) && !["Column"].includes(name),
      };
    };
    const inside = (id, point) => {
      const pad = half(id);
      return point.column >= 1 + pad && point.column <= los.COLUMNS - pad
        && point.row >= 1 + pad && point.row <= los.ROWS - pad
        && !terrainAt(id, point).some(entry => facts(entry).boundary);
    };
    const crossesWall = (from, to) => occ.red.has(los.edgeBetween(
      { c: from.column, r: from.row }, { c: to.column, r: to.row }));
    const blocker = (id, from, to, active = false, ignore) => {
      if (!inside(id, to)) return { type: "edge" };
      if (id === "apostle") return null;
      if (crossesWall(from, to)) return { type: "wall" };
      const terrain = terrainAt(id, to);
      const solid = terrain.find(entry => facts(entry).solid || facts(entry).obstacle && facts(entry).reinforced);
      if (solid) return { type: "solid", ...solid };
      const obstacle = terrain.find(entry => facts(entry).obstacle);
      if (obstacle && active) return { type: "solid", ...obstacle };
      if (active && terrain.some(entry => facts(entry).chasm)) return { type: "chasm" };
      if (active && occupant(id, to, new Map(), ignore) !== undefined) return { type: "model" };
      return obstacle ? { type: "fragile", ...obstacle } : null;
    };
    function occupant(id, point, overrides = new Map(), ignore) {
      for (const [other, position] of positions) {
        if (other !== id && other !== ignore && !deaths.has(other)
            && distance(point, id, overrides.get(other) || position, other) === 0) return other;
      }
    }
    function notify(message, id, point) { events.push({ message, model: id, point }); }
    function collide(id, point, key) {
      if (id === "apostle" || deaths.has(id) || seenCollisions.has(key)) return;
      seenCollisions.add(key);
      collisions.push({ model: id, point });
    }
    function die(id, point, reason) {
      if (id === "apostle" || deaths.has(id)) return;
      deaths.add(id);
      notify(reason, id, point);
    }
    function activateTerrain(id, point, scope) {
      for (const entry of terrainAt(id, point)) {
        const { tile, index } = entry;
        const type = facts(entry);
        if (type.review && !checkedTiles.has(index)) {
          checkedTiles.add(index);
          notify("核对地形牌 · " + terrainLabel(tile), id, point);
        }
        if (id !== "apostle" && scope !== "boss" && type.chasm) die(id, point, "裂隙 · 死亡");
        if (scope === "active" && id !== "apostle") continue;
        if (type.reinforced) {
          flipped.add(index);
          notify("强固易毁 · 翻面", id, point);
        } else if (type.fragile) {
          destroyed.add(index);
          notify("移除地形 · " + terrainLabel(tile), id, point);
        }
      }
    }
    function move(id, point, scope, path = null) {
      positions.set(id, point);
      path?.push(point);
      if (id === "apostle") {
        for (const [other, position] of positions) {
          if (distance(position, other, point, id) === 0) collide(other, position, other + ":boss");
        }
      }
      if (scope !== "skip" || id === "apostle") activateTerrain(id, point, scope);
    }
    function pick(options, type, id, origin, labels) {
      if (!options.length) return null;
      if (options.length === 1) return options[0];
      const decision = { type, model: id, point: origin, options: options.map(dir => ({
        id: dir.id, label: labels?.get(dir.id) || dir.label, point: translate(origin, dir),
      })) };
      decisions.push(decision);
      if (usedChoices === choices.length) {
        pending = decision;
        return null;
      }
      const selected = choices[usedChoices++];
      const picked = options.find(option => option.id === selected);
      if (!picked) invalid = "路线选项已变化，请重新预览。";
      return picked || null;
    }
    function directionOptions(id, point, other, otherId, toward) {
      const current = distance(point, id, other, otherId);
      const options = directions.filter(dir => {
        const next = distance(translate(point, dir), id, other, otherId);
        return toward ? next < current : next > current;
      });
      if (!toward && current === 0) {
        const scored = directions.map(dir => {
          const axis = dir.dc ? ["column", dir.dc] : ["row", dir.dr];
          const length = (point[axis[0]] - other[axis[0]]) * axis[1];
          return length;
        });
        return directions.filter((_, index) => scored[index] === Math.max(...scored));
      }
      const direct = options.filter(dir => {
        const [axis, sign] = dir.dc ? ["column", dir.dc] : ["row", dir.dr];
        const separation = (point[axis] - other[axis]) * (toward ? -sign : sign);
        return separation > half(id) + half(otherId);
      });
      return direct.length ? direct : options;
    }
    function shortest(id, otherId, active) {
      const start = positions.get(id), other = positions.get(otherId);
      const queue = [{ point: start, options: new Set(), steps: 0 }];
      const visited = new Map([[pointKey(start), queue[0]]]);
      const first = new Set();
      let shortestLength = Infinity;
      for (let i = 0; i < queue.length; i++) {
        const { point, options, steps } = queue[i];
        if (steps >= shortestLength) break;
        for (const dir of directions) {
          const next = translate(point, dir);
          const gap = distance(next, id, other, otherId);
          if (gap === 0) continue;
          const blocked = blocker(id, point, next, active);
          if (blocked && blocked.type !== "fragile") continue;
          const origins = steps ? options : [dir];
          if (gap === 1) {
            shortestLength = steps + 1;
            for (const origin of origins) first.add(origin);
            continue;
          }
          const key = pointKey(next);
          let reached = visited.get(key);
          if (!reached) {
            reached = { point: next, options: new Set(), steps: steps + 1 };
            visited.set(key, reached);
            queue.push(reached);
          }
          if (reached.steps === steps + 1) for (const origin of origins) reached.options.add(origin);
        }
      }
      return directions.filter(dir => first.has(dir));
    }
    function displacement(id, from, overrides) {
      return directions.filter(dir => {
        const to = translate(from, dir);
        return !blocker(id, from, to) && !terrainAt(id, to).some(tile => facts(tile).chasm)
          && occupant(id, to, overrides) === undefined;
      });
    }
    function endOnOtherTitan(id) {
      if (id === "apostle" || deaths.has(id)) return;
      const point = positions.get(id);
      for (const [other, position] of positions) {
        if (other === id || other === "apostle" || deaths.has(other) || distance(point, id, position, other) !== 0) continue;
        const options = displacement(other, position);
        const direction = pick(options, "移位", other, position);
        if (pending || invalid) return;
        if (!direction) die(other, position, "没有相邻空格可移位 · 死亡");
        else {
          const destination = translate(position, direction);
          move(other, destination, "active");
          displaced.push({ model: other, from: position, to: destination });
        }
      }
    }

    function knockback() {
      let dir = direction && kind !== "absolute" ? directions.find(item => item.id === direction)
        : pick(directionOptions(target, targetStart, sourceStart, source, false), "选择击退方向", target, targetStart);
      while (dir && spent < amount) {
        const from = positions.get(target);
        let to = translate(from, dir);
        let blocked = blocker(target, from, to);
        if (blocked?.type === "edge") {
          const legal = directions.filter(candidate => candidate !== opposite(dir) && candidate !== dir
            && inside(target, translate(from, candidate)) && !targetPath.some(point => pointKey(point) === pointKey(translate(from, candidate))));
          const unblocked = legal.filter(candidate => {
            const wall = blocker(target, from, translate(from, candidate));
            return !wall || wall.type === "fragile";
          });
          const along = unblocked.length ? unblocked : legal;
          const away = along.filter(candidate => distance(translate(from, candidate), target, sourceStart, source)
            > distance(from, target, sourceStart, source));
          dir = pick(away.length ? away : along, "选择沿边方向", target, from);
          if (!dir) break;
          to = translate(from, dir);
          blocked = blocker(target, from, to);
        }
        if (blocked && blocked.type !== "fragile") {
          collide(target, from, "block:" + spent);
          notify(blocked.type === "wall" ? "撞到迷宫红线 · 停下" : "撞到不毁障碍 · 停下", target, from);
          break;
        }
        move(target, to, "skip", targetPath);
        spent++;
        if (blocked?.type === "fragile") {
          collide(target, to, "block:" + spent);
          break;
        }
      }
      if (!pending && !invalid && spent) activateTerrain(target, positions.get(target), "forced");
    }

    function approachWithApostle() {
      const from = positions.get(source), at = positions.get(target);
      if (source !== "apostle" || distance(from, source, at, target) <= 1) return;
      const { rules } = los.computeApostleMovePaths({
        sourceAnchor: from, targetAnchor: at, size, speed: amount, reach: 1, facing,
      });
      const routes = new Map(rules.filter(route => route.steps
          && route.centers.slice(1).every(point => inside(source, point)))
        .map(route => [directions.find(dir => dir.facing === route.firstFacing).id, route]));
      const options = [...routes.keys()].map(id => directions.find(dir => dir.id === id));
      const labels = new Map([...routes].map(([id, route]) => [id, route.label]));
      const choice = pick(options, "选择接近路线的起始方向", source, from, labels);
      if (!choice) return;
      const route = routes.get(choice.id);
      for (const point of route.centers.slice(1)) move(source, point, "active", sourcePath);
      approachSteps = spent = route.steps;
      facing = route.facing;
    }

    function push() {
      approachWithApostle();
      if (pending || invalid) return;
      while (spent < amount && !deaths.has(target)) {
        const from = positions.get(source), at = positions.get(target);
        const gap = distance(from, source, at, target);
        const options = gap > 1 ? shortest(source, target, true)
          : directionOptions(source, from, at, target, true);
        const dir = pick(options, gap > 1 ? "选择最短接近路线" : "选择推斥方向", source, from);
        if (!dir) {
          if (!pending && !invalid) notify("来源没有可用的接近路线", source, from);
          break;
        }
        const following = translate(from, dir);
        if (source === "apostle") facing = dir.facing;
        if (gap > 1) {
          move(source, following, "active", sourcePath);
          approachSteps++;
          spent++;
          continue;
        }
        const sourceBlocker = blocker(source, from, following, true, target);
        if (sourceBlocker) {
          notify("来源无法主动进入旧格 · 停下", source, from);
          break;
        }
        const blocked = blocker(target, at, translate(at, dir));
        if (blocked && blocked.type !== "fragile") {
          if (blocked.type !== "edge") collide(target, at, "push:" + spent);
          const candidate = pick(displacement(target, at, new Map([[source, following]])), "移位后继续推斥", target, at);
          if (pending || invalid) break;
          if (!candidate && target === "apostle") {
            notify("骇物没有合法移位格，请按牌面处理", target, at);
            break;
          }
          if (candidate) {
            const to = translate(at, candidate);
            move(target, to, "forced", targetPath);
            displaced.push({ model: target, from: at, to });
          } else die(target, at, "没有相邻空格可移位 · 死亡");
        } else {
          const to = translate(at, dir);
          if (blocked?.type === "fragile") collide(target, to, "push:" + spent);
          move(target, to, "forced", targetPath);
        }
        move(source, following, "active", sourcePath);
        spent++;
      }
    }

    function pull() {
      let lastStep;
      while (spent < amount && !deaths.has(target)) {
        const from = positions.get(target), at = positions.get(source);
        const approach = directionOptions(target, from, at, source, true);
        if (distance(from, target, at, source) === 1) {
          const [dir] = approach;
          if (!dir) break;
          let retreats = 0;
          for (; retreats < amount - spent; retreats++) {
            const origin = positions.get(source);
            const to = translate(origin, dir);
            if (blocker(source, origin, to, true)) break;
            move(source, to, "active", sourcePath);
          }
          if (retreats < amount - spent) notify("来源无法按主动移动规则继续后退", source, positions.get(source));
          if (!retreats) break;
          // A source that cannot retreat the full distance can only open the spaces it actually vacates.
        }
        const options = shortest(target, source, false);
        const direct = approach.map(dir => blocker(target, from, translate(from, dir)));
        if (direct.length && direct.every(item => item?.type === "solid" || item?.type === "wall")) {
          const blocked = direct[0];
          collide(target, from, blocked.type === "wall" ? "pull-wall:" + pointKey(from) : "pull-tile:" + blocked.index);
          notify("遇不毁障碍 · 沿边绕行", target, from);
        }
        // Preserve the shortest legal route and alternate axes when both remain available.
        const dir = lastStep ? options.find(step => Boolean(step.dc) !== Boolean(lastStep.dc)) || options[0]
          : pick(options, "选择拖拽起始方向", target, from);
        if (!dir) {
          if (!pending && !invalid) notify("目标没有可用的拖拽路线", target, from);
          break;
        }
        const to = translate(from, dir);
        const blocked = blocker(target, from, to);
        if (blocked?.type === "fragile") collide(target, to, "pull:" + spent);
        move(target, to, "forced", targetPath);
        lastStep = dir;
        spent++;
      }
    }

    if (amount) {
      if (isKnockback) knockback();
      else if (kind === "push") push();
      else pull();
    }
    if (!pending && !invalid && targetPath.length > 1) endOnOtherTitan(target);
    if (invalid || !pending && usedChoices !== choices.length) return { error: invalid || "路线选项已变化，请重新预览。" };

    const boss = positions.get("apostle");
    const bossMoved = source === "apostle" && sourcePath.length > 1 || target === "apostle" && targetPath.length > 1;
    const endSeats = bossMoved ? room.heroes.flatMap((_, id) => !deaths.has(id) && positions.has(id)
      && distance(positions.get(id), id, boss, "apostle") === 0 ? [id] : []) : [];
    return {
      sourcePath, targetPath, displaced, collisions, deaths: [...deaths], destroyed: [...destroyed], flipped: [...flipped],
      positions: { ...board.map.pieces, apostle: { ...boss, facing }, titans: board.map.pieces.titans.map((point, id) => positions.get(id) || point) },
      events, used: spent, approachSteps, pending, decisions, endSeats,
    };
  }

  const api = { plan, stamp, validActor, bpResponse, bpResponseError, names, directions, upperLeft };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.ATO_FORCED_MOVEMENT = api;
})();
