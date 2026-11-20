export const sections = ['dashboard', 'map', 'record', 'technology', 'heroes', 'aibp', 'story', 'theatre', 'trauma'];
const cycleIds = new Set(['c1', 'c2', 'c3', 'c4', 'c5']);
const notesSections = new Set(['record', 'technology', 'heroes', 'aibp', 'story']);

export class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function response(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function errorResponse(error) {
  if (error instanceof ApiError) return response({ ok: false, error: error.message, ...error.data }, error.status);
  console.error(error.name);
  return response({ ok: false, error: 'Campaign backend error.' }, 500);
}

export function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function defaultCampaign() {
  return {
    version: 1,
    updatedAt: null,
    sections: Object.fromEntries(sections.map(name => [name, null])),
    sectionRevisions: Object.fromEntries(sections.map(name => [name, 0])),
  };
}

export function activeCycle(campaign) {
  const dashboard = campaign.sections.dashboard;
  const profile = dashboard?.profiles?.[dashboard.activeProfileId];
  return profile?.activeCycleId || 'c1';
}

export function checkAccount(user, payload) {
  if (payload.expectedAccountId && payload.expectedAccountId !== user.id) {
    throw new ApiError(409, 'This page was loaded for another account. Reload before saving.', { code: 'ACCOUNT_MISMATCH' });
  }
}

export function writeSection(campaign, section, state, userId, updated) {
  if (!sections.includes(section)) throw new ApiError(400, 'Unknown section.');
  const current = campaign.sections[section];
  if (userId && section !== 'dashboard' && section !== 'theatre') {
    if (typeof userId !== 'string' || userId.length > 128 || ['__proto__', 'constructor', 'prototype'].includes(userId)) {
      throw new ApiError(400, 'Invalid profile ID.');
    }
    const buckets = object(current?.users) || object(current?.accounts);
    campaign.sections[section] = {
      ...(buckets ? current : {}),
      users: { ...current?.accounts, ...current?.users, [userId]: state },
    };
    delete campaign.sections[section].accounts;
  } else {
    campaign.sections[section] = state;
  }
  campaign.sectionRevisions[section] += 1;
  updated.add(section);
}

export function appendNotes(campaign, payload, updated, now) {
  if (!Object.hasOwn(payload, 'campaignNotes')) return;
  const notes = payload.campaignNotes;
  if (!notesSections.has(payload.section) || !object(notes) || typeof notes.profileId !== 'string'
      || (payload.userId && payload.userId !== notes.profileId)
      || !Array.isArray(notes.entries) || notes.entries.length > 512
      || payload.expectedRevision == null || !payload.expectedAccountId) {
    throw new ApiError(400, 'Invalid campaign notes.');
  }
  const dashboard = campaign.sections.dashboard;
  if (!dashboard?.profiles || !Object.hasOwn(dashboard.profiles, notes.profileId) || !object(dashboard.profiles[notes.profileId])) {
    throw new ApiError(409, '原战役档案已不存在，请返回主控台后重试。', { code: 'CAMPAIGN_CONTEXT_CHANGED' });
  }
  if (!notes.entries.length) return;
  const profile = dashboard.profiles[notes.profileId];
  if (!object(profile.cycles)) profile.cycles = {};
  for (const { cycleId, source, text } of notes.entries.map(entry => entry || {})) {
    if (!cycleIds.has(cycleId) || typeof source !== 'string' || !source.trim() || source.length > 100
        || typeof text !== 'string' || !text.trim() || text.length > 16000) {
      throw new ApiError(400, 'Invalid campaign note entry.');
    }
    const cycle = profile.cycles[cycleId] ||= { id: cycleId };
    if (!object(cycle.state)) cycle.state = {};
    const state = cycle.state;
    const day = state.day !== '' && state.day != null && Number.isFinite(Number(state.day)) ? ` 第${state.day}天` : '';
    const previous = typeof state.notes === 'string' ? state.notes : '';
    const breakLine = previous && !previous.endsWith('\n') ? '\n' : '';
    state.notes = previous + breakLine
      + `[${now.slice(0, 19)}Z ${cycleId.toUpperCase()}${day} · ${source}] ${text.replace(/[\r\n]+/g, ' ')}`;
  }
  campaign.sectionRevisions.dashboard += 1;
  updated.add('dashboard');
}

export function importSections(campaign, payload, updated) {
  if (!object(payload.sections) || !Object.keys(payload.sections).length) throw new ApiError(400, 'Missing sections.');
  const revisions = payload.expectedRevisions ?? {};
  if (!object(revisions)) throw new ApiError(400, 'Invalid expected revisions.');
  const conflicts = {};
  for (const [section, expected] of Object.entries(revisions)) {
    if (!sections.includes(section) || !/^\d+$/.test(String(expected))) throw new ApiError(400, 'Invalid expected revision.');
    const revision = campaign.sectionRevisions[section];
    if (Number(expected) !== revision) conflicts[section] = { expected: Number(expected), revision };
  }
  if (Object.keys(conflicts).length) {
    throw new ApiError(409, 'Some sections were changed in another page. Nothing was written.', {
      code: 'SAVE_CONFLICT', sections: conflicts, updatedAt: campaign.updatedAt,
    });
  }
  for (const [section, state] of Object.entries(payload.sections)) writeSection(campaign, section, state, payload.userId, updated);
}
