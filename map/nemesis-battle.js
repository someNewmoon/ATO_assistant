(function () {
  const optionsByCycle = {
    c1: ["pursuer"],
    c2: ["adversary", "pursuer", "dahaka"],
    c3: ["adversary", "dahaka"],
    c4: ["dahaka"],
    c5: ["titanX"],
  };
  const battleCycleByNemesis = {
    pursuer: "c1",
    adversary: "c2",
    dahaka: "c4",
    titanX: "c5",
  };

  const adversaryBattleByCycle = {
    c1: {
      book: "c1",
      chapter: "battle",
      encounter: "赫尔墨斯追踪者战斗-pursuer-battle",
      entry: "赫尔墨斯追踪者战斗-pursuer-battle",
    },
    c2: {
      book: "c2",
      chapter: "battle",
      encounter: "重担之战-burden-battle",
      entry: "重担之战-burden-battle",
    },
    c3: {
      // 循环 3 的宿敌战斗读的仍是 C2 故事书里的重担之战，不是笔误。

      book: "c2",
      chapter: "battle",
      encounter: "重担之战-burden-battle",
      entry: "重担之战-burden-battle",
    },
    c4: {
      book: "c4",
      chapter: "battle",
      encounter: "收割旋风之战-reap-the-whirlwind-battle",
      entry: "收割旋风之战-reap-the-whirlwind-battle",
    },
    c5: {
      book: "c5",
      chapter: "battle",
      encounter: "the-devil-himself-battle-the-devil-himself-battle",
      entry: "the-devil-himself-battle",
    },
  };

  function targetFor(cycleId, record, defaultTargets = adversaryBattleByCycle) {
    const options = optionsByCycle[cycleId];
    if (!options) return null;
    const selected = record?.nemesisSelections?.[cycleId];
    const nemesis = options.includes(selected) ? selected : options[0];
    return defaultTargets[battleCycleByNemesis[nemesis]] || null;
  }

  function recordEncounter(map, day, battleHref) {
    map.adversaryIntroduced = true;
    const key = String(day ?? "");
    if (!/^(?:\d+|T[0-5]|T6\/00)$/.test(key)) return;
    if (!map.nemesisEncounters || typeof map.nemesisEncounters !== "object" || Array.isArray(map.nemesisEncounters)) {
      map.nemesisEncounters = {};
    }
    const query = new URLSearchParams(String(battleHref || "").split("?")[1] || "");
    map.nemesisEncounters[key] = { tileId: map.currentTile || map.tokens?.AG || "",
      battleSearch: query.get("chapter") === "battle" ? query.toString() : "" };
  }

  window.ATO_NEMESIS_BATTLE = { targetFor, recordEncounter };
})();
