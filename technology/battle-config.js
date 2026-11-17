(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ATO_BATTLE_CONFIG = api;
})(typeof window === 'object' ? window : this, function () {
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
        path: 'technology/' + card.image.back }));
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

  return { profileId, userState, availability, prepare };
});
