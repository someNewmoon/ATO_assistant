function addVotes(entry, votes) {
  for (const vote of Object.values(votes || {})) {
    entry.feedback++;
    if (vote === 'up') entry.likes++;
  }
}

export function battleStats(room) {
  if (room.battleStats) return room.battleStats;
  const stats = room.heroes.map(() => ({ rolls: 0, likes: 0, feedback: 0, damage: 0 }));
  for (const roll of room.rolls) {
    const entry = stats[roll.seat];
    if (!entry) continue;
    entry.rolls++;
    entry.damage += roll.wounds ?? 0;
    addVotes(entry, roll.reactions);
  }
  room.battleStats = stats;
  return stats;
}

export function countReaction(room, roll, by, next) {
  const entry = battleStats(room)[roll.seat];
  const previous = roll.reactions?.[by];
  entry.feedback += Number(Boolean(next)) - Number(Boolean(previous));
  entry.likes += Number(next === 'up') - Number(previous === 'up');
}

export function setRollWounds(room, roll, wounds) {
  const entry = battleStats(room)[roll.seat];
  entry.damage = (entry.damage ?? 0) + wounds - (roll.wounds ?? 0);
  roll.wounds = wounds;
}

const metrics = [
  { key: 'damage', title: '骇物破壁者', label: '造成最多损伤' },
  { key: 'likes', title: '全船掌声', label: '获得最多赞同' },
  { key: 'feedback', title: '甲板话题王', label: '收到最多表态' },
  { key: 'rolls', title: '骰声不歇', label: '发起最多投掷' },
];
const bonusTitles = ['逆风守舵人', '甲板定海针', '决战见证者', '阿尔戈的底牌', '浪尖同行者', '最后一盏灯'];

export function battleRecap(room, damage, randomInt) {
  const tally = battleStats(room);
  const entries = room.heroes.map((hero, seat) => ({
    id: hero.id, name: hero.name, argonaut: hero.argonaut, ...tally[seat], damage: damage?.[seat] ?? tally[seat].damage ?? 0,
  }));
  const available = [...bonusTitles];
  const awarded = new Set();
  for (const metric of metrics) {
    const top = Math.max(0, ...entries.map(entry => entry[metric.key] ?? 0));
    if (!top) continue;
    const tied = entries.filter(entry => !awarded.has(entry) && entry[metric.key] === top);
    if (!tied.length) continue;
    const winner = tied[randomInt(tied.length)];
    winner.title = metric.title;
    winner.reason = metric.label + (entries.filter(entry => entry[metric.key] === top).length > 1 ? '（并列）' : '');
    awarded.add(winner);
  }
  const mvp = awarded.values().next().value || entries[randomInt(entries.length)];
  for (const entry of entries) {
    if (!entry.title) entry.title = available.splice(randomInt(available.length), 1)[0];
  }
  return { battleNumber: room.squad.battleNumber, round: room.round, apostle: room.projection?.title || room.board?.apostle || '',
    mvp: mvp.id, spotlights: awarded.size > 0, heroes: entries };
}
