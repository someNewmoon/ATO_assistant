// Only the boss panel, revealed cards and public deck counts cross into the room.
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

export function roomProjection(value, apostle) {
  if (!apostle || value?.apostle !== apostle) return null;
  const damage = value.damage;
  return {
    apostle,
    title: text(value.title, 100),
    level: text(value.level, 12),
    panel: image(value.panel),
    ai: card(value.ai),
    bp: card(value.bp),
    aiDeck: deck(value.aiDeck),
    bpDeck: deck(value.bpDeck),
    damage: { total: count(damage?.total), wounds: count(damage?.wounds),
      ...(Number.isSafeInteger(damage?.damage1) && { damage1: count(damage.damage1), damage2: count(damage.damage2) }) },
  };
}
