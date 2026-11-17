(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ATO_ROOM_CARD_STATE = api;
})(typeof window === 'object' ? window : this, function () {
  const states = ['ready', 'exhausted', 'discarded'];

  function gearState(item, slot) {
    return item.cards?.[slot] || (slot < (item.legacyUsed ?? item.used) ? 'exhausted' : 'ready');
  }

  function setGearState(item, slot, next) {
    const previous = gearState(item, slot);
    if (previous === next) return;
    item.legacyUsed ??= item.used;
    item.cards ??= {};
    if (next === (slot < item.legacyUsed ? 'exhausted' : 'ready')) delete item.cards[slot];
    else item.cards[slot] = next;
    item.used += Number(next !== 'ready') - Number(previous !== 'ready');
  }

  function findGearSlot(item, state) {
    const explicit = Object.keys(item.cards || {}).find(slot => item.cards[slot] === state);
    if (explicit !== undefined) return Number(explicit);
    const baseline = item.legacyUsed ?? item.used;
    let slot = state === 'ready' ? baseline : 0;
    const end = state === 'ready' ? item.count : baseline;
    while (slot < end && gearState(item, slot) !== state) slot++;
    return slot < end ? slot : -1;
  }

  return { states, gearState, setGearState, findGearSlot };
});
