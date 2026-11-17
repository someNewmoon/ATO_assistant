(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ATO_BATTLE_CONFIG = api;
})(typeof window === 'object' ? window : this, function () {
  // Charge circles on the published ability card backs. Token-based cards
  // and the grand cannon have no numeric charge circle; keep them explicit.
  const abilityCharges = {
    "forced kratos reaction": 2,
    "teleresuscitation": 2,
    "fate sink": 3,
    "arrow barrage": 3,
    "crisis protocol": 2,
    "pursuer protocol": 2,
    "ambrosia containment": 2,
    "transport trireme": null,
    "reflex priming": 2,
    "forced kratos cooldown": 2,
    "triskelion power boost": 2,
    "trireme ballista fire": 3,
    "hephaestean oxybeles": 2,
    "hyperadrenaline infusion": 1,
    "pursuer order": 2,
    "rendevous trireme": null,
    "13th muse grand cannon": null,
    "chronosphere warning system": 2,
    "fate converter": 3,
    "opportunity freeze": 2,
    "possibility matrix": 2,
    "quantum armory": 2,
    "reverse timeflow": 2,
    "telehealing": 2,
    "time dilation": 1,
    "time skip": 1,
    "transient death": 1,
    "irem protocols": 3,
    "wish deflector": 2,
    "gold transmogrifier": 2,
    "archimedean ballista": 2,
    "cloud support fleet": 3,
    "dahaka phasing": 2,
    "cloud scout fleet": 2,
    "ascension protocols": 2,
    "curse resistor": 2,
    "true value of life": 1,
    "ropeseller theorem": 1,
    "calculate statistical certainty": 3,
    "kintsukuroi pharos": 1,
    "oxygen tubes": 2,
    "drag it back!": 2,
    "underwater support fleet": 4,
    "flash backstep": 2,
    "painkiller shot": 2,
    "triskelion override": 2,
    "inner light": 2,
    "anchor drop pod": 1,
    "soulbalm": 1
  };
  const abilityCapacity = id => abilityCharges[id] ?? null;

  const supportLimits = { 'antikratos project': 2, 'excursion propylon 2': 3, 'war propylon': 4 };

  function profileId(campaign) {
    return campaign?.sections?.dashboard?.activeProfileId || 'default';
  }

  function userState(section, id) {
    return section?.users?.[id] || section?.accounts?.[id] || section || {};
  }

  function availability(campaign, dictionary) {
    const id = profileId(campaign);
    const record = userState(campaign.sections.record, id);
    const technology = userState(campaign.sections.technology, id);
    const learned = new Set((technology.unlocked || []).filter(key => typeof key === 'string').map(key => key.toLowerCase().split('@@')[0]));
    const limits = Object.entries(supportLimits).filter(([key]) => learned.has(key)).map(([, value]) => value);
    const legacyLimit = Number(record.cycleStats?.[record.cycle]?.aaLimit ?? record.aaLimit);
    const limit = limits.length ? Math.max(...limits) : campaign.sections.technology == null && legacyLimit > 0
      ? Math.min(20, legacyLimit) : 2;
    const disabled = record.explorationDelays?.disabledTechs || {};
    const cycle = record.cycle || 'c1';
    const locks = disabled[cycle] || {};
    const cards = dictionary.cards.filter(card => card.type?.battle_card_type === 'skill'
      && learned.has(card.key) && !Object.keys(locks).some(key => key.toLowerCase().split('@@')[0] === card.key))
      .map(card => ({ id: card.key, name: card.names.zh || card.names.en,
        maxUses: abilityCapacity(card.key), path: 'technology/' + card.image.back }));
    return { record, limit, reserveLimit: learned.has('quantum propylon') ? 1 : 0, cards };
  }

  function prepare(config, available) {
    const ids = config?.abilities || [];
    const reserve = config?.reserve || [];
    if (!Array.isArray(ids) || !Array.isArray(reserve) || ids.length > available.limit
        || reserve.length > available.reserveLimit || new Set([...ids, ...reserve]).size !== ids.length + reserve.length) {
      throw new Error('阿尔戈能力数量超过科技上限，或选择了重复能力。');
    }
    const lookup = id => {
      const card = available.cards.find(card => card.id === id);
      if (!card) throw new Error('所选阿尔戈能力尚未学会或已被禁用，请重新配置。');
      return card;
    };
    return { name: String(config?.name || '战斗配置').trim().slice(0, 60) || '战斗配置',
      limit: available.limit, abilities: ids.map(lookup), reserve: reserve.map(lookup) };
  }

  return { profileId, userState, availability, prepare, abilityCapacity };
});
