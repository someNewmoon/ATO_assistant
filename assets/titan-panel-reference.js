(() => {
  // Read-only reference from the supplied base-panel scans. BW0974 is a
  // Kratos style. Types with only a portrait or style have no panel entry.
  const dreamwalker = {
    movement: 5,
    powerDice: { red: 1 },
    abilities: [
      ['奔袭', '凶险 2+。获得 1 命运并使用一个复合行动。速度 +1，沿最短路径移动至少 3 格，使目标进入射程，再以自动破势 1 执行一次近战或远触攻击。']
    ]
  };

  const panels = {
    dreamwalker,
    tt_earthshaker: {
      // AK0295
      movement: 5,
      powerDice: { red: 1 },
      abilities: [
        ['六臂', '拥有 3 个武器槽位，或 3 个支援槽位。'],
        ['冷静开场', '发起攻击时，若克拉托斯池中伺机和破势都为 0，各放入 1 个标记。']
      ]
    },
    tt_mazerunner: {
      // AK0296
      movement: 6,
      powerDice: { red: 1 },
      abilities: [
        ['迷宫态势感知', '抽取严重创伤、致命创伤或生死关头后存活，获得 1 个临时 +1 闪避标记。站在地形板块上时，闪避 +1。'],
        ['进阶奔袭', '凶险 3+。获得 1 命运并使用一个复合行动。速度 +2，沿最短路径移动至少 3 格，使目标进入射程，再以自动破势 1 和 +1 精准执行一次近战或远触攻击。']
      ]
    },
    logicbreaker: {
      // AK0297
      movement: 5,
      powerDice: { red: 1 },
      abilities: [
        ['忒修斯之解', '获得 1 命运。主动移动时可忽略一块障碍或裂谷地形，结束位置须在这两类地形之外。'],
        ['逻辑破坏', '生死关头抽取后存活时，获得 1 命运并执行一个作战行动。每轮最多以此方式执行 3 次。']
      ]
    },
    gamechanger: {
      // AK0298
      movement: 5,
      powerDice: { black: 1 },
      abilities: [
        ['高级反射', '响应时获得 1 命运并横置该能力，移动至多 2 格。'],
        ['未知之力', '可将三手武器视为双手武器使用。这样做时，支援槽位 −1。'],
        ['命线扰动', '每次掷出关键失手时，结算此牌面符号。', 'disturbance'],
        ['巧计', '抽取严重创伤、致命创伤或生死关头后存活，向克拉托斯池放入 1 个伺机标记。']
      ]
    }
  };

  function forTitan(titan, inventory) {
    // The four named Dreamwalker panels, AK0291–AK0294, share this profile.
    if (inventory.dreamwalkerPanel(titan)) return dreamwalker;
    const type = inventory.titanType(titan)?.id;
    return Object.hasOwn(panels, type) ? panels[type] : null;
  }

  const api = { forTitan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.ATO_TITAN_PANEL_REFERENCE = api;
})();
