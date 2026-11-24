// Only public boss information, revealed cards and public deck counts cross into the room.
function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function image(value) {
  if (typeof value !== 'string' || value.length > 240) return '';
  const parts = value.split('/');
  return parts[0] === 'ps' && parts.slice(1).every(part =>
    part && part !== '.' && part !== '..' && /^[\p{L}\p{N}_. ()\-]+$/u.test(part))
    && /\.(?:jpg|jpeg|png|webp)$/i.test(value) ? value : '';
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 999) : 0;
}

function card(value) {
  const src = image(value?.src);
  return src ? { src, label: text(value.label, 100) } : null;
}

function deck(value) {
  return { count: count(value?.count), discard: count(value?.discard), backs: text(value?.backs, 240), back: card(value?.back) };
}

function publicTokens(tokens) {
  return tokens.slice(0, 128).flatMap(token => {
    const file = /^(?:(?:AT|DA|ED|HT|SP|ps)[+-]\.png|py\+\.png|(?:CA|CM)\.jpg)$/.test(token?.file)
      ? token.file : '';
    const custom = text(token?.text, 40);
    const quantity = count(token?.count);
    if ((!file && !custom) || !quantity) return [];
    const label = text(token.label, 40);
    const counter = text(token.c45PanelCounter, 32);
    return [{ file, count: quantity, ...(custom && { text: custom }), ...(label && { label }),
      ...((token.perHit === true || token.autoLevelBonus === 'danger') && { perHit: true }),
      ...(token.demidjinnWishArmor === true && { demidjinnWishArmor: true }),
      ...(token.midascorePain === true && { midascorePain: true }),
      ...(counter && { c45PanelCounter: counter }) }];
  });
}

export function roomProjection(value, apostle) {
  if (!apostle || value?.apostle !== apostle) return null;
  const damage = value.damage;
  return {
    apostle,
    title: text(value.title, 100),
    level: text(value.level, 12),
    panel: image(value.panel),
    signature: image(value.signature),
    ...(Array.isArray(value.tokens) && { tokens: publicTokens(value.tokens) }),
    ai: card(value.ai),
    ...(value.sharedDeck === true && { sharedDeck: true }),
    bp: card(value.bp),
    ...(typeof value.aiPending === "boolean" && { aiPending: value.aiPending }),
    ...(typeof value.bpPending === "boolean" && { bpPending: value.bpPending }),
    aiDeck: deck(value.aiDeck),
    bpDeck: deck(value.bpDeck),
    damage: { total: count(damage?.total), wounds: count(damage?.wounds),
      ...(Number.isSafeInteger(damage?.damage1) && { damage1: count(damage.damage1), damage2: count(damage.damage2) }) },
  };
}
