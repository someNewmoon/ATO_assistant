(() => {
  const tracks = {
    c1: [
    {
      key: "hekaton",
      zh: "百臂巨人",
      en: "Hekaton",
      stages: [
        { id: "0", label: "0" },
        { id: "1a", label: "I" },
        { id: "1b", label: "I", sharedWith: ["hekaton", "labyrinthauros"] },
        { id: "2a", label: "II" },
        { id: "2b", label: "II", sharedWith: ["hekaton", "labyrinthauros"] },
        { id: "2c", label: "III", sharedWith: ["hekaton", "labyrinthauros"] },
        { id: "3", label: "III" },
        { id: "4a", label: "IV" },
        { id: "4b", label: "IV" },
        { id: "4c", label: "IV", sharedWith: ["hekaton", "labyrinthauros"] },
      ],
    },
    {
      key: "labyrinthauros",
      zh: "迷宫机牛",
      en: "Labyrinthauros",
      stages: [
        { id: "spacer", label: "", marker: "spacer" },
        { id: "1a", label: "I" },
        { id: "1b", label: "I", sharedWith: ["hekaton", "labyrinthauros"] },
        { id: "2a", label: "II" },
        { id: "2b", label: "II", sharedWith: ["hekaton", "labyrinthauros"] },
        { id: "2c", label: "III", sharedWith: ["hekaton", "labyrinthauros"] },
        { id: "3", label: "III" },
        { id: "4a", label: "IV" },
        { id: "4b", label: "IV" },
        { id: "4c", label: "IV", sharedWith: ["hekaton", "labyrinthauros"] },
      ],
    },
    { key: "temenos", zh: "吞域兽", en: "Temenos", stages: ["1", "2", "3", "4"] },
    { key: "pursuer", zh: "赫尔墨斯追击者", en: "Hermesian Pursuer", stages: ["1", "2", "3", "4", "5"], hasTriangle: true },
  ],
    c2: [
    {
      key: "cyclonus",
      zh: "独眼巨人",
      en: "Cyclonus",
      stages: [
        { id: "1a", label: "I" },
        { id: "1b", label: "I", sharedWith: ["cyclonus", "chimera"] },
        { id: "2a", label: "II" },
        { id: "2b", label: "II", sharedWith: ["cyclonus", "chimera"] },
        { id: "3a", label: "III", sharedWith: ["cyclonus", "chimera"] },
        { id: "3b", label: "III" },
        { id: "4a", label: "IV" },
        { id: "4b", label: "IV" },
        { id: "4c", label: "IV", sharedWith: ["cyclonus", "chimera"] },
      ],
    },
    {
      key: "chimera",
      zh: "蠕变奇美拉",
      en: "Chimera Metastasios",
      stages: [
        { id: "1a", label: "I" },
        { id: "1b", label: "I", sharedWith: ["cyclonus", "chimera"] },
        { id: "2a", label: "II" },
        { id: "2b", label: "II", sharedWith: ["cyclonus", "chimera"] },
        { id: "3a", label: "III", sharedWith: ["cyclonus", "chimera"] },
        { id: "3b", label: "III" },
        { id: "4a", label: "IV" },
        { id: "4b", label: "IV" },
        { id: "4c", label: "IV", sharedWith: ["cyclonus", "chimera"] },
      ],
    },
    { key: "nietzschean", zh: "尼采超人", en: "Nietzschean", stages: ["1", "2", "3", "4"] },
    { key: "adversary", zh: "重担", en: "The Burden", stages: ["1", "2", "3", "4", "5"] },
  ],
    c3: [
    {
      key: "oracle",
      zh: "超时光先知",
      en: "Hypertime Oracle",
      stages: [
        { id: "1a", label: "I" },
        { id: "1b", label: "I", sharedWith: ["oracle", "harpy"] },
        { id: "2a", label: "II" },
        { id: "2b", label: "II", sharedWith: ["oracle", "harpy"] },
        { id: "2c", label: "III", sharedWith: ["oracle", "harpy"] },
        { id: "3", label: "III" },
        { id: "4a", label: "IV" },
        { id: "4b", label: "IV" },
        { id: "4c", label: "IV" },
        { id: "5", label: "V", sharedWith: ["oracle", "harpy"] },
      ],
    },
    {
      key: "harpy",
      zh: "伊卡洛斯哈尔皮",
      en: "Icarian Harpy",
      stages: [
        { id: "1a", label: "I" },
        { id: "1b", label: "I", sharedWith: ["oracle", "harpy"] },
        { id: "2a", label: "II" },
        { id: "2b", label: "II", sharedWith: ["oracle", "harpy"] },
        { id: "2c", label: "III", sharedWith: ["oracle", "harpy"] },
        { id: "3", label: "III" },
        { id: "4a", label: "IV" },
        { id: "4b", label: "IV" },
        { id: "4c", label: "IV" },
        { id: "5", label: "V", sharedWith: ["oracle", "harpy"] },
      ],
    },
    { key: "sunDescendant", zh: "坠落太阳", en: "Sun Descendant", stages: ["1", "2", "3", "4", "5"] },
    { key: "adversary", zh: "重担", en: "The Burden", stages: ["1", "2", "3", "4", "5"] },
  ],
    c4: [
    {
      key: "midascore",
      zh: "迈达狮",
      en: "Midascore",
      stages: [
        { id: "1a", label: "I" },
        { id: "1b", label: "I", sharedWith: ["midascore", "demidjinn"] },
        { id: "2a", label: "II" },
        { id: "2b", label: "II", sharedWith: ["midascore", "demidjinn"] },
        { id: "3a", label: "III", sharedWith: ["midascore", "demidjinn"] },
        { id: "3b", label: "III" },
        { id: "4a", label: "IV" },
        { id: "4b", label: "IV" },
        { id: "4c", label: "IV", sharedWith: ["midascore", "demidjinn"] },
        { id: "5a", label: "V" },
        { id: "5b", label: "V", sharedWith: ["midascore", "demidjinn"] },
        { id: "5c", label: "V" },
        { id: "5d", label: "V", sharedWith: ["midascore", "demidjinn"] },
        { id: "6", label: "VI", marker: "counter", sharedWith: ["midascore", "demidjinn"] },
      ],
    },
    {
      key: "demidjinn",
      zh: "半神迪精",
      en: "Demidjinn",
      stages: [
        { id: "1a", label: "I" },
        { id: "1b", label: "I", sharedWith: ["midascore", "demidjinn"] },
        { id: "2a", label: "II" },
        { id: "2b", label: "II", sharedWith: ["midascore", "demidjinn"] },
        { id: "3a", label: "III", sharedWith: ["midascore", "demidjinn"] },
        { id: "3b", label: "III" },
        { id: "4a", label: "IV" },
        { id: "4b", label: "IV" },
        { id: "4c", label: "IV", sharedWith: ["midascore", "demidjinn"] },
        { id: "5a", label: "V" },
        { id: "5b", label: "V", sharedWith: ["midascore", "demidjinn"] },
        { id: "5c", label: "V" },
        { id: "5d", label: "V", sharedWith: ["midascore", "demidjinn"] },
        { id: "6", label: "VI", marker: "counter", sharedWith: ["midascore", "demidjinn"] },
      ],
    },
    { key: "babelianLunacy", zh: "巴比伦疯塔", en: "Babelian Lunacy", stages: ["1", "2", "3", "4", "5", "6"] },
    { key: "dahaka", zh: "达哈卡", en: "Dahaka", stages: ["1", "2", "3", "4", "5", "6", "7", "8"], hasTriangle: true },
  ],
    c5: [
    {
      key: "dragonOfPhobos",
      zh: "深海惧龙",
      en: "Dragon of Phobos",
      stages: [
        { id: "1a", label: "I" },
        { id: "1b", label: "I", sharedWith: ["dragonOfPhobos", "meduketos"] },
        { id: "2a", label: "II" },
        { id: "2b", label: "II", sharedWith: ["dragonOfPhobos", "meduketos"] },
        { id: "3a", label: "III", sharedWith: ["dragonOfPhobos", "meduketos"] },
        { id: "3b", label: "III" },
        { id: "4a", label: "IV" },
        { id: "4b", label: "IV" },
        { id: "4c", label: "IV", sharedWith: ["dragonOfPhobos", "meduketos"] },
      ],
    },
    {
      key: "meduketos",
      zh: "须目刻托斯",
      en: "Meduketos",
      stages: [
        { id: "1a", label: "I" },
        { id: "1b", label: "I", sharedWith: ["dragonOfPhobos", "meduketos"] },
        { id: "2a", label: "II" },
        { id: "2b", label: "II", sharedWith: ["dragonOfPhobos", "meduketos"] },
        { id: "3a", label: "III", sharedWith: ["dragonOfPhobos", "meduketos"] },
        { id: "3b", label: "III" },
        { id: "4a", label: "IV" },
        { id: "4b", label: "IV" },
        { id: "4c", label: "IV", sharedWith: ["dragonOfPhobos", "meduketos"] },
      ],
    },
    { key: "urFleece", zh: "乌尔-弗里斯", en: "Ur-Fleece", stages: ["1", "2", "3", "4", "5"] },
    { key: "titanX", zh: "泰坦 X", en: "Titan X", stages: ["1", "2", "3", "4", "5", "6", "7", "8", "9"], hasTriangle: true },
  ],
  };
  const roman = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
  function levelFor(record, target) {
    if (Array.isArray(target)) return Math.max(0, ...target.map(track => levelFor(record, track)));
    const marks = record?.enemies || {};
    const nemesis = ['pursuer', 'adversary', 'dahaka', 'titanX'].includes(target.key);
    const definition = tracks[target.cycle]?.find(item => item.key === target.key)
      || (nemesis && Object.values(tracks).flat().find(item => item.key === target.key));
    if (!definition) return 0;
    const active = definition.stages.flatMap((stage, index) => {
      const legacyId = typeof stage === 'string' ? stage : stage.id;
      const id = typeof stage === 'string' ? stage + '-' + index : stage.id;
      const label = typeof stage === 'string' ? stage : stage.label;
      const shared = typeof stage === 'object' && stage.sharedWith;
      const scoped = shared ? 'shared:' + [...shared].sort().join('+') : target.key;
      const candidates = nemesis
        ? ['nemesis:' + target.key + ':' + id, ...Object.keys(tracks).map(cycle => cycle + ':' + scoped + ':' + id)]
        : [target.cycle + ':' + scoped + ':' + id];
      const match = candidates.find(key => Object.hasOwn(marks, key));
      if (match ? !marks[match] : ![legacyId, id].includes(String(marks[target.key]))) return [];
      return [roman[label] ?? (Number(label) || 0)];
    });
    return active.length ? Math.max(...active) : null;
  }
  window.ATO_ENEMY_EVOLUTION = { tracks, levelFor };
})();
