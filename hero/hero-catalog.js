(function (root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.ATO_HERO_CATALOG = catalog;
})(typeof window === 'object' ? window : this, function () {
  'use strict';

    const ARGONAUTS = [
      { id: "odys", portrait: 1, en: "Odys Zero", zh: "奥德修斯·零" },
      { id: "circe", portrait: 2, en: "Circegard", zh: "喀耳刻卫" },
      { id: "phenelope", portrait: 3, en: "Phenelope", zh: "珀涅罗珀" },
      { id: "telebac", portrait: 4, en: "Telebacchus", zh: "忒勒巴科斯" },
      { id: "herakleides", portrait: 5, en: "Herakleides", zh: "赫拉克莱德斯" },
      { id: "olympia", portrait: 6, en: "Olympia", zh: "奥林匹亚" },
      { id: "leocules", portrait: 7, en: "Leocules", zh: "莱奥库勒斯" },
      { id: "raz", portrait: 8, en: "Raz", zh: "拉兹" },
      { id: "fisher", portrait: 9, en: "Fisher", zh: "费舍尔" },
      { id: "hypatia", portrait: 17, en: "Hypatia", zh: "希帕提亚" },
      { id: "anakreon", portrait: 18, en: "Anakreon", zh: "阿纳克里翁" },
      { id: "anathea", portrait: 19, en: "Anathea", zh: "安纳忒亚" },
      { id: "orphan", portrait: 20, en: "Orphan", zh: "DMT的孤儿" },
      { id: "aster", portrait: 21, en: "Aster", zh: "阿斯特" },
      { id: "dastan", portrait: 22, en: "Dastan", zh: "达斯坦" },
      { id: "aktisaeos", portrait: 23, en: "Aktisaeos", zh: "阿克提赛俄斯" },
      { id: "oleander", portrait: 24, en: "Oleander", zh: "欧利安德" },
      { id: "omorfos", portrait: 25, en: "Omorfos", zh: "欧莫弗斯" },
      // 以下 7 项对应素材 hero/assets/argonaut_10..16_blank.png：原版素材里没有英雄名的占位头像槽位。
      // 仅在英雄记录表中提供选择，名字固定标注为「未命名」，选中后双击英雄标题即可改成实际名称。
      { id: "blank10", portrait: 10, en: "Unnamed Slot 10", zh: "未命名 10", unnamed: true },
      { id: "blank11", portrait: 11, en: "Unnamed Slot 11", zh: "未命名 11", unnamed: true },
      { id: "blank12", portrait: 12, en: "Unnamed Slot 12", zh: "未命名 12", unnamed: true },
      { id: "blank13", portrait: 13, en: "Unnamed Slot 13", zh: "未命名 13", unnamed: true },
      { id: "blank14", portrait: 14, en: "Unnamed Slot 14", zh: "未命名 14", unnamed: true },
      { id: "blank15", portrait: 15, en: "Unnamed Slot 15", zh: "未命名 15", unnamed: true },
      { id: "blank16", portrait: 16, en: "Unnamed Slot 16", zh: "未命名 16", unnamed: true },
    ];

    const MNEMOS = {
      c1: [
        { id: "c1_00", en: "Siren Survivor", zh: "塞壬幸存者", skill1: "courage", skill2: "will", nodes: ["M003","M013","M023"], thresholds: [3,7,10], card: "AG0134", tags: ["voyage","supernatural","deed"] },
        { id: "c1_01", en: "Someone Waiting", zh: "有人在等待", skill1: "cunning", skill2: "endurance", nodes: ["M005","M015","M025"], thresholds: [3,7,10], card: "AG0135", tags: ["voyage","family","gods"] },
        { id: "c1_02", en: "A Dream You Hold", zh: "你所持有的梦", skill1: "wisdom", skill2: "will", nodes: ["M001","M011","M021"], thresholds: [3,7,10], card: "AG0136", tags: ["dream","voyage","fate"] },
        { id: "c1_03", en: "Family Feud", zh: "家族世仇", skill1: "courage", skill2: "cunning", nodes: ["M008","M018","M028"], thresholds: [3,7,10], card: "AG0137", tags: ["family","tragedy","crime"] },
        { id: "c1_04", en: "Imprisonment", zh: "监禁", skill1: "endurance", skill2: "wisdom", nodes: ["M002","M012","M022"], thresholds: [3,7,10], card: "AG0138", tags: ["curse","crime","dream"] },
        { id: "c1_05", en: "Haunted", zh: "萦绕心头", skill1: "wisdom", skill2: "will", nodes: ["M009","M019","M029"], thresholds: [3,7,10], card: "AG0139", tags: ["fate","supernatural","curse"] },
        { id: "c1_06", en: "A Broken Promise", zh: "破碎的承诺", skill1: "cunning", skill2: "fury", nodes: ["M006","M016","M026"], thresholds: [3,7,10], card: "AG0140", tags: ["deed","tragedy","family"] },
        { id: "c1_07", en: "A Night to Remember", zh: "难忘之夜", skill1: "courage", skill2: "fury", nodes: ["M010","M020","M030"], thresholds: [3,7,10], card: "AG0141", tags: ["deed","heritage","dream"] },
        { id: "c1_08", en: "Death Follows", zh: "死神追随", skill1: "endurance", skill2: "fury", nodes: ["M031","M041","M037"], thresholds: [3,7,10], card: "AG0142", tags: ["gods","heritage","fate"] },
        { id: "c1_09", en: "Minoan Heritage", zh: "米诺斯传承", skill1: "wisdom", skill2: "courage", nodes: ["M004","M014","M024"], thresholds: [3,7,10], card: "AG0143", tags: ["voyage","heritage","fate"] },
        { id: "c1_10", en: "Blood on Your Hands", zh: "沾满鲜血的双手", skill1: "fury", skill2: "cunning", nodes: ["M007","M017","M027"], thresholds: [3,7,10], card: "AG0144", tags: ["deed","crime","tragedy"] },
        { id: "c1_11", en: "A Familiar Curse", zh: "熟悉的诅咒", skill1: "endurance", skill2: "wisdom", nodes: ["M032","M043","M034"], thresholds: [3,7,10], card: "AG0145", tags: ["fate","gods","curse"] },
        { id: "c1_12", en: "Curse of the Gods", zh: "神明的诅咒", skill1: "endurance", skill2: "will", nodes: ["M033","M036","M038"], thresholds: [3,7,10], card: "AG0146", tags: ["heritage","fate","voyage"] },
      ],
      c2: [
        { id: "c2_00", en: "Runt of the Litter", zh: "窝里最弱的", skill1: "cunning", skill2: "wisdom", nodes: ["M007","M017","M027"], thresholds: [3,7,10], card: "BG0645", tags: ["curse","heritage","fate"] },
        { id: "c2_01", en: "Mésalliance", zh: "错配", skill1: "will", skill2: "courage", nodes: ["M002","M012","M022"], thresholds: [3,7,10], card: "BG0646", tags: ["deed","family","dream"] },
        { id: "c2_02", en: "Left For Dead", zh: "被弃为死", skill1: "endurance", skill2: "fury", nodes: ["M008","M018","M028"], thresholds: [3,7,10], card: "BG0647", tags: ["deed","tragedy","crime"] },
        { id: "c2_03", en: "Spewed by the Abyss", zh: "深渊吐出", skill1: "will", skill2: "fury", nodes: ["M004","M014","M024"], thresholds: [3,7,10], card: "BG0648", tags: ["fate","supernatural","gods"] },
        { id: "c2_04", en: "Coward's Way", zh: "懦夫之道", skill1: "cunning", skill2: "wisdom", nodes: ["M003","M013","M023"], thresholds: [3,7,10], card: "BG0649", tags: ["deed","voyage","crime"] },
        { id: "c2_05", en: "Castoff", zh: "弃物", skill1: "endurance", skill2: "wisdom", nodes: ["M009","M019","M029"], thresholds: [3,7,10], card: "BG0650", tags: ["family","heritage","gods"] },
        { id: "c2_06", en: "Death Precedes", zh: "死亡先行", skill1: "fury", skill2: "courage", nodes: ["M005","M015","M025"], thresholds: [3,7,10], card: "BG0651", tags: ["tragedy","supernatural","curse"] },
        { id: "c2_07", en: "Forbidden Love", zh: "禁忌之恋", skill1: "endurance", skill2: "courage", nodes: ["M001","M011","M021"], thresholds: [3,7,10], card: "BG0652", tags: ["deed","dream","curse"] },
        { id: "c2_08", en: "Scorned Champion", zh: "被蔑视的冠军", skill1: "will", skill2: "fury", nodes: ["M006","M016","M026"], thresholds: [3,7,10], card: "BG0653", tags: ["fate","voyage","gods"] },
      ],
      c3: [
        { id: "c3_00", en: "A Fall From Eden", zh: "伊甸园的坠落", skill1: "cunning", skill2: "wisdom", nodes: ["M007","M017","M027"], thresholds: [3,7,10], card: "CG1270", tags: ["dream","voyage","fate"] },
        { id: "c3_01", en: "Unearned Life", zh: "不劳而获的生活", skill1: "cunning", skill2: "will", nodes: ["M002","M012","M022"], thresholds: [3,7,10], card: "CG1271", tags: ["family","tragedy","crime"] },
        { id: "c3_02", en: "Life of Regret", zh: "充满遗憾的人生", skill1: "courage", skill2: "endurance", nodes: ["M008","M018","M028"], thresholds: [3,7,10], card: "CG1272", tags: ["deed","crime","tragedy"] },
        { id: "c3_03", en: "Time-crossed Lovers", zh: "时空交错的爱人", skill1: "will", skill2: "fury", nodes: ["M004","M014","M024"], thresholds: [3,7,10], card: "CG1273", tags: ["gods","family","voyage"] },
        { id: "c3_04", en: "Timekeeper's Child", zh: "时间守护者的孩子", skill1: "courage", skill2: "wisdom", nodes: ["M003","M013","M023"], thresholds: [3,7,10], card: "CG1274", tags: ["supernatural","tragedy","family"] },
        { id: "c3_05", en: "Disgraceful Parent", zh: "耻辱的父母", skill1: "fury", skill2: "wisdom", nodes: ["M005","M015","M025"], thresholds: [3,7,10], card: "CG1275", tags: ["deed","heritage","supernatural"] },
        { id: "c3_06", en: "Hero By Mistake", zh: "无心插柳的英雄", skill1: "endurance", skill2: "courage", nodes: ["M001","M011","M021"], thresholds: [3,7,10], card: "CG1276", tags: ["gods","voyage","fate"] },
        { id: "c3_07", en: "The Returned", zh: "回归者", skill1: "fury", skill2: "cunning", nodes: ["M006","M016","M026"], thresholds: [3,7,10], card: "CG1277", tags: ["curse","heritage","fate"] },
      ],
      c4: [
        { id: "c4_00", en: "Seed of Paradise", zh: "天堂之种", skill1: "courage", skill2: "fury", nodes: ["M008","M018","M028"], thresholds: [3,7,10], card: "DG2054", tags: ["voyage","family","gods"] },
        { id: "c4_01", en: "Third Wish", zh: "第三个愿望", skill1: "cunning", skill2: "endurance", nodes: ["M003","M013","M023"], thresholds: [3,7,10], card: "DG2055", tags: ["family","tragedy","crime"] },
        { id: "c4_02", en: "The Beggar and the Prince", zh: "乞丐与王子", skill1: "wisdom", skill2: "will", nodes: ["M002","M012","M022"], thresholds: [3,7,10], card: "DG2056", tags: ["deed","crime","tragedy"] },
        { id: "c4_03", en: "Updraft", zh: "风起云涌", skill1: "courage", skill2: "cunning", nodes: ["M004","M014","M024"], thresholds: [3,7,10], card: "DG2057", tags: ["supernatural","tragedy","family"] },
        { id: "c4_04", en: "Peddler of Misery", zh: "苦难掮客", skill1: "wisdom", skill2: "will", nodes: ["M005","M015","M025"], thresholds: [3,7,10], card: "DG2058", tags: ["fate","voyage","gods"] },
        { id: "c4_05", en: "Too Big to Fail", zh: "大而不倒", skill1: "courage", skill2: "will", nodes: ["M001","M011","M021"], thresholds: [3,7,10], card: "DG2059", tags: ["voyage","fate","dream"] },
        { id: "c4_06", en: "The Thousandth Night", zh: "千零一夜", skill1: "cunning", skill2: "fury", nodes: ["M007","M017","M027"], thresholds: [3,7,10], card: "DG2060", tags: ["fate","curse","heritage"] },
        { id: "c4_07", en: "The Mule", zh: "负重之骡", skill1: "endurance", skill2: "wisdom", nodes: ["M006","M016","M026"], thresholds: [3,7,10], card: "DG2061", tags: ["supernatural","deed","heritage"] },
      ],
      c5: [
        { id: "c5_00", en: "Vanishing Point", zh: "消失之点", skill1: "courage", skill2: "will", nodes: ["M005","M015","M025"], thresholds: [3,7,10], card: "EG2640", tags: ["curse","heritage","fate"] },
        { id: "c5_01", en: "In Your Image", zh: "神之形象", skill1: "cunning", skill2: "will", nodes: ["M006","M016","M026"], thresholds: [3,7,10], card: "EG2641", tags: ["deed","family","dream"] },
        { id: "c5_02", en: "Shelter", zh: "庇护之所", skill1: "wisdom", skill2: "cunning", nodes: ["M003","M013","M023"], thresholds: [3,7,10], card: "EG2642", tags: ["deed","tragedy","crime"] },
        { id: "c5_03", en: "Dogma", zh: "信条", skill1: "fury", skill2: "cunning", nodes: ["M004","M014","M024"], thresholds: [3,7,10], card: "EG2643", tags: ["fate","supernatural","gods"] },
        { id: "c5_04", en: "Last Crusader", zh: "最后的十字军", skill1: "endurance", skill2: "wisdom", nodes: ["M002","M012","M022"], thresholds: [3,7,10], card: "EG2644", tags: ["deed","voyage","crime"] },
        { id: "c5_05", en: "Words and Deeds", zh: "言行合一", skill1: "courage", skill2: "will", nodes: ["M001","M011","M021"], thresholds: [3,7,10], card: "EG2645", tags: ["family","heritage","gods"] },
        { id: "c5_06", en: "Twilight", zh: "暮光之刻", skill1: "endurance", skill2: "fury", nodes: ["M007","M017","M027"], thresholds: [3,7,10], card: "EG2646", tags: ["supernatural","tragedy","curse"] },
        // 全表唯一的例外：官方 fmnemos 表里 mnemos_c5_07 的三项 break point 是 5 / 9 / 14，
        // 不是标准的 3 / 7 / 10。按官方数据照抄，所以这张卡的轨道是 14 格（见 mnemosTrackLength）。
        { id: "c5_07", en: "He Spoke Truth", zh: "他说出了真相", skill1: "courage", skill2: "wisdom", nodes: ["M008","M018","M028"], thresholds: [5,9,14], card: "EG2647", tags: ["deed","curse","voyage"] },
      ],
    };

    const FATED_MNEMOS = {
      c1: [
        { id: "fm_c1_01", en: "Memory of Death", zh: "死亡的记忆", keyword: "Memory of Death", skill: "will", card: "AF0125", tags: ["heritage","gods","fate"] },
        { id: "fm_c1_02", en: "Betrayal", zh: "背叛", keyword: "Betrayal", skill: "wisdom", card: "AF0126", tags: ["family","tragedy","crime"] },
        { id: "fm_c1_03", en: "Alone", zh: "孤独", keyword: "Alone", skill: "courage", card: "AF0127", tags: ["curse","dream","crime"] },
        { id: "fm_c1_04", en: "Left Behind", zh: "被遗弃", keyword: "Left Behind", skill: "courage", card: "AF0128", tags: ["fate","supernatural","curse"] },
        { id: "fm_c1_05", en: "Oblivious", zh: "全然不知", keyword: "Oblivious", skill: "cunning", card: "AF0129", tags: ["deed","tragedy","family"] },
        { id: "fm_c1_06", en: "Ikari", zh: "真嗣", keyword: "Ikari", skill: "will", card: "AF0130", tags: ["deed","heritage","dream"] },
        { id: "fm_c1_07", en: "Honorblind", zh: "荣誉盲", keyword: "Honorblind", skill: "wisdom", card: "AF0131", tags: ["voyage","supernatural","deed"] },
        { id: "fm_c1_08", en: "Egotist", zh: "利己主义者", keyword: "Egotist", skill: "fury", card: "AF0132", tags: ["voyage","family","gods"] },
        { id: "fm_c1_09", en: "Selfishness", zh: "自私", keyword: "Selfishness", skill: "fury", card: "AF0133", tags: ["deed","heritage","curse"] },
      ],
      c2: [
        { id: "fm_c2_01", en: "Hapless", zh: "不幸", keyword: "Hapless", skill: "endurance", card: "BF0636", tags: ["heritage","gods","fate"] },
        { id: "fm_c2_02", en: "Weak", zh: "虚弱", keyword: "Weak", skill: "endurance", card: "BF0637", tags: ["voyage","tragedy","crime"] },
        { id: "fm_c2_03", en: "Coward", zh: "懦夫", keyword: "Coward", skill: "fury", card: "BF0638", tags: ["curse","dream","crime"] },
        { id: "fm_c2_04", en: "Reluctant", zh: "不情愿", keyword: "Reluctant", skill: "wisdom", card: "BF0639", tags: ["fate","supernatural","gods"] },
        { id: "fm_c2_05", en: "Scapegoat", zh: "替罪羊", keyword: "Scapegoat", skill: "courage", card: "BF0640", tags: ["fate","tragedy","family"] },
        { id: "fm_c2_06", en: "Restless", zh: "焦躁不安", keyword: "Restless", skill: "cunning", card: "BF0641", tags: ["deed","tragedy","dream"] },
        { id: "fm_c2_07", en: "Ambrosia Addiction", zh: "神浆成瘾", keyword: "Ambrosia Addiction", skill: "will", card: "BF0642", tags: ["voyage","supernatural","deed"] },
        { id: "fm_c2_08", en: "Bloodthirsty", zh: "嗜血", keyword: "Bloodthirsty", skill: "wisdom", card: "BF0643", tags: ["voyage","gods","family"] },
        { id: "fm_c2_09", en: "Clumsy", zh: "笨拙", keyword: "Clumsy", skill: "cunning", card: "BF0644", tags: ["crime","heritage","curse"] },
      ],
      c3: [
        { id: "fm_c3_01", en: "Psychosomatic Disorder", zh: "心理生理障碍", keyword: "Psychosomatic Disorder", skill: "endurance", card: "CF1260", tags: ["deed","gods","fate"] },
        { id: "fm_c3_02", en: "Apathy", zh: "冷漠", keyword: "Apathy", skill: "will", card: "CF1261", tags: ["dream","tragedy","crime"] },
        { id: "fm_c3_03", en: "Fate-hexed", zh: "命运诅咒", keyword: "Fate-hexed", skill: "cunning", card: "CF1262", tags: ["curse","dream","crime"] },
        { id: "fm_c3_04", en: "Timid", zh: "胆怯", keyword: "Timid", skill: "courage", card: "CF1263", tags: ["fate","supernatural","gods"] },
        { id: "fm_c3_05", en: "Enervated", zh: "精力耗弱", keyword: "Enervated", skill: "endurance", card: "CF1264", tags: ["fate","gods","family"] },
        { id: "fm_c3_06", en: "Superstitious", zh: "迷信", keyword: "Superstitious", skill: "fury", card: "CF1265", tags: ["supernatural","deed","dream"] },
        { id: "fm_c3_07", en: "Queasy", zh: "恶心", keyword: "Queasy", skill: "courage", card: "CF1266", tags: ["voyage","supernatural","deed"] },
        { id: "fm_c3_08", en: "Late", zh: "迟到", keyword: "Late", skill: "wisdom", card: "CF1267", tags: ["voyage","dream","gods"] },
        { id: "fm_c3_09", en: "Denigrated", zh: "贬低", keyword: "Denigrated", skill: "will", card: "CF1268", tags: ["supernatural","heritage","curse"] },
      ],
      c4: [
        { id: "fm_c4_01", en: "Cursed", zh: "被诅咒", keyword: "Cursed", skill: "wisdom", card: "DF2070", tags: ["family","curse","heritage"] },
        { id: "fm_c4_02", en: "Twice-Cursed", zh: "双重诅咒", keyword: "Twice-Cursed", skill: "endurance", card: "DF2071", tags: ["supernatural","curse","heritage"] },
        { id: "fm_c4_03", en: "Thrice-Cursed", zh: "三重诅咒", keyword: "Thrice-Cursed", skill: "will", card: "DF2072", tags: ["curse","crime","dream"] },
        { id: "fm_c4_04", en: "Fear of Heights", zh: "恐高", keyword: "Fear of Heights", skill: "fury", card: "DF2073", tags: ["voyage","dream","gods"] },
        { id: "fm_c4_05", en: "Wishful Thinker", zh: "一厢情愿", keyword: "Wishful Thinker", skill: "cunning", card: "DF2074", tags: ["deed","supernatural","dream"] },
        { id: "fm_c4_06", en: "Deprived", zh: "被剥夺", keyword: "Deprived", skill: "wisdom", card: "DF2075", tags: ["deed","supernatural","voyage"] },
        { id: "fm_c4_07", en: "Hoarder", zh: "囤积者", keyword: "Hoarder", skill: "will", card: "DF2076", tags: ["fate","gods","family"] },
        { id: "fm_c4_08", en: "Indebted", zh: "负债", keyword: "Indebted", skill: "courage", card: "DF2077", tags: ["dream","tragedy","crime"] },
        { id: "fm_c4_09", en: "Expendable", zh: "可牺牲的", keyword: "Expendable", skill: "fury", card: "DF2078", tags: ["deed","heritage","fate"] },
      ],
      c5: [
        { id: "fm_c5_01", en: "Sanctimonious", zh: "伪善", keyword: "Sanctimonious", skill: "courage", card: "EF2648", tags: ["gods","family","fate"] },
        { id: "fm_c5_02", en: "Delusional", zh: "妄想", keyword: "Delusional", skill: "wisdom", card: "EF2649", tags: ["supernatural","tragedy","crime"] },
        { id: "fm_c5_03", en: "Dogmatic", zh: "教条", keyword: "Dogmatic", skill: "will", card: "EF2650", tags: ["curse","dream","crime"] },
        { id: "fm_c5_04", en: "Humiliated", zh: "受辱", keyword: "Humiliated", skill: "fury", card: "EF2651", tags: ["voyage","dream","gods"] },
        { id: "fm_c5_05", en: "Depressed", zh: "沮丧", keyword: "Depressed", skill: "cunning", card: "EF2652", tags: ["deed","curse","dream"] },
        { id: "fm_c5_06", en: "Memory of Drowning", zh: "溺水的记忆", keyword: "Memory of Drowning", skill: "endurance", card: "EF2653", tags: ["voyage","supernatural","deed"] },
        { id: "fm_c5_07", en: "Phantom Pain", zh: "幻痛", keyword: "Phantom Pain", skill: "will", card: "EF2654", tags: ["deed","heritage","curse"] },
        { id: "fm_c5_08", en: "Godfearing", zh: "畏神", keyword: "Godfearing", skill: "courage", card: "EF2655", tags: ["family","gods","fate"] },
        { id: "fm_c5_09", en: "Messianic", zh: "弥赛亚", keyword: "Messianic", skill: "fury", card: "EF2656", tags: ["supernatural","heritage","curse"] },
      ],
      // 不属于任何循环的宿命回忆（官方 fmnemos 表里 cycle = COUNT，卡号 CF1269）。
      // 只有这一张：它由 C2 冒险枢纽 07《真相映照弱点》的冒险《播种 (Sowing)》这条线派出，
      // 在 C2 特殊事件《死于收割 Reaped》里被永久移出游戏（标记 G6），之后不再回到牌堆。
      count: [
        { id: "fm_sowed", en: "Sowed", zh: "被播种", keyword: "Sowed", skills: ["will","wisdom"], card: "CF1269", tags: ["family","heritage","curse"] },
      ],
    };

  function heroDisplayName(hero) {
    return hero.customName || ARGONAUTS.find(argonaut => argonaut.id === hero.argonaut)?.zh || hero.playerName || '新英雄';
  }

  function heroPortrait(hero) {
    const argonaut = ARGONAUTS.find(entry => hero?.argonaut
      ? entry.id === hero.argonaut : entry.zh === hero?.name);
    if (!argonaut) return '';
    const number = String(argonaut.portrait).padStart(2, '0');
    return 'argonaut_' + number + '_' + (argonaut.unnamed ? 'blank' : argonaut.id) + '.png';
  }

  function activeHeroes(campaign, profileId = campaign?.sections?.dashboard?.activeProfileId || 'default') {
    const section = campaign?.sections?.heroes;
    const records = section?.users || section?.accounts;
    const heroes = (records ? records[profileId] : section)?.heroes;
    return Array.isArray(heroes) ? heroes.filter(hero => typeof hero?.id === 'string' && hero.id) : [];
  }

  function mnemosCards(hero) {
    return [
      ...Object.entries(MNEMOS).flatMap(([cycle, cards]) => cards
        .filter(card => hero.mnemos?.[cycle]?.includes(card.id))
        .map(card => ({ ...card, progress: hero.mnemosProgress?.[card.id] || 0, limit: Math.max(10, ...card.thresholds) }))),
      ...Object.entries(FATED_MNEMOS).flatMap(([cycle, cards]) => cards
        .filter(card => hero.fatedMnemos?.[cycle]?.includes(card.id))
        .map(card => ({ ...card, fated: true }))),
    ];
  }

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function mnemosHtml(hero) {
    const cards = mnemosCards(hero);
    if (!cards.length) return '<p class="hero-mnemos-empty">暂无旧忆卡牌</p>';
    return '<ul class="hero-mnemos-cards" aria-label="旧忆卡牌">' + cards.map(card => {
      const status = card.fated ? '命业旧忆' : `旧忆 · ${card.progress}/${card.limit}`;
      return `<li><strong>${escape(card.zh)}</strong><small>${escape(card.card)} · ${escape(status)}</small></li>`;
    }).join('') + '</ul>';
  }

  return { ARGONAUTS, MNEMOS, FATED_MNEMOS, heroDisplayName, heroPortrait, activeHeroes, mnemosCards, mnemosHtml, escape };
});
