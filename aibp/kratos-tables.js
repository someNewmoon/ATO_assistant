(() => {
  // Rage rows transcribed from the supplied Windows pack. Each nested option groups effects that resolve together.
  const tables = {
    AW0286: [
      [1, [["break"], ["opening"]]],
      [2, [["reroll"], ["reposition"]]],
      [3, [["break"], ["opening"]]],
      [4, [["pushback"], ["reroll"]]],
      [5, [["redDie"]]],
      [6, [["break"], ["opening"]]],
    ],
    AW0287: [
      [1, [["break"], ["opening"]]],
      [2, [["reroll"]]],
      [3, [["break"], ["opening"]]],
      [4, [["pushback"], ["reroll"]]],
      [5, [["redDie"]]],
      [6, [["break"], ["opening"]]],
      [7, [["pushback"], ["reroll"]]],
    ],
    BW0974: [
      [1, [["break"], ["opening"]]],
      [2, [["break"], ["reroll"]]],
      [3, [["break"], ["opening"]]],
      [4, [["pushback"], ["opening"], ["reroll"]]],
      [5, [["redDie"]]],
      [6, [["break"], ["opening"], ["reroll"]]],
    ],
    BW0976: [
      [1, [["break"], ["opening"]]],
      [2, [["break"], ["reroll"]]],
      [3, [["break"], ["opening"]]],
      [4, [["pushback"], ["opening"], ["reroll"]]],
      [5, [["redDie"]]],
      [6, [["break"], ["opening"], ["reroll"]]],
    ],
    BW0981: [
      [1, [["break"], ["opening"]]],
      [2, [["break"], ["reroll"]]],
      [3, [["break"], ["opening"]]],
      [4, [["pushback"], ["opening"], ["reroll"]]],
      [5, [["redDie"]]],
      [6, [["break"], ["opening"], ["reroll"]]],
      [7, [["pushback"], ["reroll"]]],
      [8, [["break"], ["opening"]]],
    ],
    CW1550: [
      [1, [["break"], ["opening"]]],
      [2, [["break"], ["reroll"]]],
      [3, [["break"], ["opening"]]],
      [4, [["pushback"], ["opening"], ["reroll"]]],
      [5, [["redDie"]]],
      [6, [["break"], ["opening"], ["reroll"]]],
    ],
    CW1551: [
      [1, [["retain"], ["black"]]],
      [2, [["opening", "reroll"]]],
      [3, [["retain", "reroll"]]],
      [4, [["break", "retain"], ["retain2"]]],
      [5, [["redDie"]]],
      [6, [["retainAny", "reroll"]]],
      [7, [["retain"]]],
    ],
    CW1556: [
      [1, [["break", "opening"]]],
      [2, [["reroll", "burden"]]],
      [3, [["break", "black"]]],
      [4, [["redDie"]]],
      [5, [["black", "opening"]]],
      [6, [["reroll", "burden"]]],
      [7, [["reroll"]]],
    ],
    dreamwalker: [
      [1, [["break"], ["opening"]]],
      [2, [["reroll"]]],
      [3, [["break"], ["opening"]]],
      [4, [["pushback"], ["reroll"]]],
      [5, [["redDie"]]],
      [6, [["break"], ["opening"]]],
    ],
    gamechanger: [
      [1, [["break", "opening"], ["reroll"]]],
      [2, [["despairElation"], ["ambrosiaElation"]]],
      [3, [["break"], ["opening", "reroll"]]],
      [4, [["redDie"]]],
      [5, [["break"], ["reroll2"]]],
      [6, [["replaceBp"]]],
      [7, [["break", "reroll"]]],
    ],
    logicbreaker: [
      [1, [["overbreak", "reroll"]]],
      [2, [["opening"], ["overbreak"]]],
      [3, [["overbreak", "reroll"]]],
      [4, [["despairElation"], ["ambrosiaElation"], ["ignoreCumbersome"]]],
      [5, [["redDie"]]],
      [6, [["overbreak", "reroll"]]],
      [7, [["despairElation"], ["ambrosiaElation"], ["overbreak"]]],
    ],
    tt_earthshaker: [
      [1, [["reroll"]]],
      [2, [["break", "opening"]]],
      [3, [["provoke"], ["reroll"]]],
      [4, [["break", "opening"]]],
      [5, [["redDie"]]],
      [6, [["diversion"]]],
      [7, [["opening", "reroll"]]],
    ],
    tt_mazerunner: [
      [1, [["opening", "reposition"]]],
      [2, [["break", "vault"]]],
      [3, [["reroll", "motivate"]]],
      [4, [["opening", "reposition"]]],
      [5, [["break", "motivate"], ["reroll"]]],
      [6, [["redDie"]]],
      [7, [["opening"], ["break"]]],
    ],
  };
  const labels = {
    opening: "伺机 1",
    break: "破势 1",
    diversion: "分神 1",
    reroll: "威力重掷 1",
    reroll2: "威力重掷 2",
    pushback: "推斥 1",
    redDie: "额外红色威力骰 1",
    reposition: "走位 1",
    vault: "腾跃",
    motivate: "鼓动 1",
    black: "Black 1",
    retain: "保留伺机或破势标记 1",
    retain2: "保留伺机或破势标记 2",
    retainAny: "保留任意克拉托斯标记 1",
    burden: "Burden 1",
    overbreak: "过量破势 1",
    despairElation: "振奋 1（弃除绝望）",
    ambrosiaElation: "振奋 1（弃除神浆）",
    ignoreCumbersome: "忽略沉重",
    replaceBp: "弃除当前部位牌并揭示下一张",
    provoke: "挑衅",
  };
  const icons = {
    opening: 'kratos-abilities/opening.png', break: 'kratos-abilities/break.png',
    reroll: 'kratos-abilities/reroll.png', pushback: 'kratos-abilities/pushback.png',
    redDie: 'kratos-abilities/redDie.png', retain: 'kratos-abilities/retain.png',
    black: 'kratos-abilities/black.png', retainAny: 'kratos-abilities/retainAny.png',
    reposition: 'kratos-abilities/reposition.png', burden: 'kratos-abilities/burden.png',
    diversion: 'battle-markers/diversion.webp', motivate: 'battle-markers/rouse.webp',
  };

  function forTitan(titan) {
    const inventory = window.ATO_GEAR_INVENTORY;
    const pattern = inventory.TITAN_PATTERNS.find(item => !item.track && titan?.patternIds?.includes(item.id));
    const titanType = inventory.titanType(titan)?.id;
    const rows = tables[pattern?.id || (titanType === 'spartan-dreamwalker' ? 'BW0974' : titanType)];
    return rows && { rows, name: pattern?.name || inventory.titanLabel(titan) };
  }

  window.ATO_KRATOS_TABLES = { forTitan, labels, icons };
})();
