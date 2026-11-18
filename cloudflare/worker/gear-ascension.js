import inventory from '../../technology/gear-inventory.js';
import production from '../../technology/ato_gear_production.json';
import heroCatalog from '../../hero/hero-catalog.js';
import { ApiError, object, writeSection } from './campaign.js';

export function ascensionIdentity(payload) {
  if (!/^[a-f0-9-]{36}$/.test(payload.operationId || '') || !inventory.gearKey(payload.gearId)
    || payload.gearId !== inventory.gearKey(payload.gearId) || typeof payload.profileId !== 'string') {
    throw new ApiError(400, '登升操作无效。');
  }
  return JSON.stringify([payload.profileId, payload.gearId]);
}

// Called inside the account's synchronous SQLite transaction, with its receipt write.
export function ascendCampaignGear(campaign, payload, updated) {
  const profile = campaign.sections.dashboard?.activeProfileId || 'default';
  if (payload.profileId !== profile) throw new ApiError(409, '战役档案已切换，请重新打开军械库。');
  const section = campaign.sections.record;
  const bucketed = object(section?.users) || object(section?.accounts);
  const record = (bucketed ? (section.users || section.accounts)[profile] : section) || {};
  const id = payload.gearId, base = inventory.baseGearId(id);
  if (!Object.hasOwn(production.gearCards, base)) throw new ApiError(400, '未知装备不能登升。');
  const cycle = inventory.ascendedCycle(id) || production.gearCycles?.[base]
    || ({ A: 'c1', B: 'c2', C: 'c3', D: 'c4', E: 'c5' })[base[0]];
  if (!inventory.nextCycle(cycle)) throw new ApiError(409, '这件装备无法再登升。');
  const theatre = structuredClone(campaign.sections.theatre || {});
  const count = theatre.hold?.[cycle]?.core?.count;
  if (!Number.isSafeInteger(Number(count)) || Number(count) < 1) throw new ApiError(409, '对应故事集的升华核心不足。');
  const heroes = heroCatalog.activeHeroes(campaign);
  const reserved = inventory.assignedLoadouts(record, heroes).reduce((sum, [, kit]) =>
    sum + (inventory.normalizeLoadout(kit).gear[id] || 0), 0);
  let arsenal;
  try { arsenal = inventory.ascend(record.arsenal, id, cycle, reserved); }
  catch (error) { throw new ApiError(409, error.message); }
  theatre.hold[cycle].core.count = Number(count) - 1;
  writeSection(campaign, 'record', { ...record, arsenal }, profile, updated);
  writeSection(campaign, 'theatre', theatre, null, updated);
  return { gearId: base + '@' + inventory.nextCycle(cycle), coreCycle: cycle };
}
