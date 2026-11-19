import { storyScanKey } from './story-scans.js';
import { DurableObject } from 'cloudflare:workers';
import inventory from '../../technology/gear-inventory.js';
import { ascensionIdentity, ascendCampaignGear } from './gear-ascension.js';
import { battleRequest, createBattleRoom, squadAbilityOptions, squadHeroStats, squadTitanTrauma, squadRosterForCampaign } from './battle-room.js';
export { BattleRoom, BattleDirectory } from './battle-room.js';
import {
  ApiError, activeCycle, appendNotes, checkAccount, defaultCampaign, errorResponse,
  importSections, object, response, sections, writeSection,
} from './campaign.js';

const accountPattern = /^[a-z0-9][a-z0-9_-]{2,31}$/;
const cookieName = 'ato_cloud_session';
const sessionLifetime = 60 * 60 * 24 * 14;
const maximumSave = 6 * 1024 * 1024;
const encoder = new TextEncoder();
const authActions = new Set(['login', 'register']);
const campaignActions = new Set(['me', 'logout', 'import-sections', 'ascend-gear']);

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000,
  }, key, 256));
}

async function sessionHash(token) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
}

function cookie(url, token, maxAge) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function tokenFrom(request) {
  const match = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  const token = match?.[1] || '';
  const [username, secret, rest] = token.split('.');
  return accountPattern.test(username || '') && /^[a-f0-9]{64}$/.test(secret || '') && rest === undefined ? token : '';
}

async function readPayload(request, limit = maximumSave) {
  if (!request.body) throw new ApiError(400, 'Request body must be JSON.');
  if (Number(request.headers.get('Content-Length')) > limit) throw new ApiError(413, 'Save payload is too large.');
  const decoder = new TextDecoder();
  const reader = request.body.getReader();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new ApiError(413, 'Save payload is too large.');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  let payload;
  try { payload = JSON.parse(text + decoder.decode()); } catch { /* Report invalid JSON below. */ }
  if (!object(payload)) throw new ApiError(400, 'Request body must be JSON.');
  return payload;
}

function verifyOrigin(request, url) {
  if (request.method !== 'POST') return;
  const origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new ApiError(403, 'Cross-origin writes are not accepted.');
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return response({ ok: true, backend: 'cloudflare', phase: 'campaign' });
      if (url.pathname === '/api/battle-room/open') {
        if (request.method !== 'GET') throw new ApiError(405, '需要 GET。');
        return env.ROOM_DIRECTORY.getByName('active').fetch('https://directory.internal/list');
      }
      const createRoom = url.pathname === '/api/battle-room/create';
      const squadHome = ['/api/battle-room/home', '/api/battle-room/story-library', '/api/battle-room/story-scan'].includes(url.pathname);
      if (url.pathname.startsWith('/api/battle-room/') && !createRoom && !squadHome) return await battleRequest(env, request, url);
      if (createRoom && (request.method !== 'POST' || url.search)) throw new ApiError(405, '创建小队需要 POST。');
      if (!createRoom && !squadHome && url.pathname !== '/api/campaign-state.php') {
        return response({ ok: false, code: 'UNSUPPORTED_CLOUD_API', error: '此接口尚未迁移到 Cloudflare。' }, 501);
      }
      verifyOrigin(request, url);
      const action = url.searchParams.get('action');
      const battleProjection = action === 'second-screen' && url.searchParams.get('preview') === 'aibp';
      if (action && !battleProjection && !authActions.has(action) && !campaignActions.has(action)) {
        return response({ ok: false, code: 'UNSUPPORTED_CLOUD_API', error: '此功能尚未迁移到 Cloudflare。' }, 501);
      }
      const headers = new Headers(request.headers);
      const token = tokenFrom(request);
      let accountId = token.split('.')[0];
      let forwarded = request;
      if (authActions.has(action)) {
        if (request.method !== 'POST') throw new ApiError(405, 'This action requires POST.');
        const payload = await readPayload(request, 4096);
        accountId = typeof payload.username === 'string' ? payload.username.trim().toLowerCase() : '';
        if (!accountPattern.test(accountId)) throw new ApiError(400, 'Account must be 3-32 characters: letters, numbers, underscore, or hyphen.');
        if (typeof payload.password !== 'string' || payload.password.length < 8 || payload.password.length > 256) {
          throw new ApiError(400, 'Password must be 8 to 256 characters.');
        }
        headers.delete('Content-Length');
        forwarded = new Request(request.url, {
          method: 'POST', headers,
          body: JSON.stringify({ password: payload.password }),
        });
      }
      if (action === 'logout' && request.method !== 'POST') throw new ApiError(405, 'This action requires POST.');
      if (!accountId) {
        if (action === 'me') return response({ ok: true, authenticated: false, user: null });
        if (action === 'logout') return response({ ok: true }, 200, { 'Set-Cookie': cookie(url, '', 0) });
        throw new ApiError(401, 'Please log in first.', { code: 'AUTH_REQUIRED' });
      }
      headers.set('x-ato-account', accountId);
      return await env.CAMPAIGNS.getByName(accountId).fetch(new Request(forwarded, { headers }));
    } catch (error) {
      return errorResponse(error);
    }
  },
};

export class CampaignAccount extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.roomEnv = env;
    this.pendingSquads = new Set();
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS account (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), salt TEXT NOT NULL, hash BLOB NOT NULL,
        failures INTEGER NOT NULL DEFAULT 0, blocked_until INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS saves (name TEXT PRIMARY KEY, state TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS owned_squads (profile TEXT PRIMARY KEY, room TEXT NOT NULL, credentials TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gear_operations (id TEXT PRIMARY KEY, identity TEXT NOT NULL, result TEXT NOT NULL);
    `);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const id = request.headers.get('x-ato-account');
    const user = { id, username: id };
    try {
      if (authActions.has(action)) return await this.authenticate(request, url, action, user);
      const token = tokenFrom(request);
      const hash = token ? await sessionHash(token) : '';
      if (action === 'logout') {
        if (hash) this.sql.exec('DELETE FROM sessions WHERE hash = ?', hash);
        return response({ ok: true }, 200, { 'Set-Cookie': cookie(url, '', 0) });
      }
      const authenticated = hash && this.sql.exec('SELECT 1 FROM sessions WHERE hash = ? AND expires > ?', hash, Date.now()).toArray().length > 0;
      if (action === 'me') return response({ ok: true, authenticated: Boolean(authenticated), user: authenticated ? user : null });
      if (!authenticated) throw new ApiError(401, 'Please log in first.', { code: 'AUTH_REQUIRED' });

      if (url.pathname.startsWith('/api/battle-room/')) return await this.squadHome(request, url, user);
      if (action === 'second-screen' && url.searchParams.get('preview') === 'aibp') {
        if (request.method !== 'GET') throw new ApiError(405, '投屏需要 GET。');
        const state = this.loadCampaign();
        const aibp = state.sections.aibp;
        if (!aibp?.apostle) throw new ApiError(404, '请先在 AIBP 打开决战。');
        return response({ ok: true, screen: {
          displayMode: 'aibp', cycleId: activeCycle(state), aibp, aibpRevision: state.sectionRevisions.aibp,
        } });
      }
      if (request.method === 'GET' && !action) return this.readCampaign(url, user);
      if (request.method !== 'POST') throw new ApiError(405, 'This action requires POST.');
      const payload = await readPayload(request);
      checkAccount(user, payload);
      return this.storage.transactionSync(() => this.saveCampaign(url, action, user, payload));
    } catch (error) {
      return errorResponse(error);
    }
  }

  async squadHome(request, url, user) {
    const campaign = this.loadCampaign();
    const dashboard = campaign.sections.dashboard;
    const profile = dashboard?.activeProfileId || 'default';
    const saveName = dashboard?.profiles?.[profile]?.name || '默认存档';
    const registered = () => this.sql.exec('SELECT room, credentials FROM owned_squads WHERE profile = ?', profile).toArray()[0];
    if (url.pathname.endsWith('/story-scan')) {
      if (request.method !== 'GET') throw new ApiError(405, '需要 GET。');
      return storyScanKey(this.roomEnv.ATO_STORY_LIBRARY, url.searchParams.get('file'));
    }
    if (url.pathname.endsWith('/story-library')) {
      if (request.method !== 'GET') throw new ApiError(405, '需要 GET。');
      if (!this.roomEnv.ATO_STORY_LIBRARY) throw new ApiError(503, '线上故事正文尚未导入。');
      const { version, key } = JSON.parse(this.roomEnv.ATO_STORY_LIBRARY);
      const current = registered();
      return response({ ok: true, version, key, cycle: activeCycle(campaign),
        projection: current ? { id: current.room, token: JSON.parse(current.credentials).token } : null });
    }
    const roomStub = id => this.roomEnv.BATTLE_ROOMS.getByName(id);
    const readCurrent = async () => {
      const current = registered();
      if (!current) return null;
      const credentials = JSON.parse(current.credentials);
      const result = await roomStub(current.room).fetch('https://battle-room.internal/state', {
        headers: { Authorization: 'Bearer ' + credentials.token },
      });
      if (!result.ok && ![401, 404].includes(result.status)) throw new ApiError(503, '暂时无法读取小队。');
      const data = result.ok && await result.json();
      return data?.room?.squad && !data.room.closed ? { id: current.room, title: data.room.title, credentials } : null;
    };
    if (request.method === 'GET' && url.pathname.endsWith('/home')) {
      return response({ ok: true, squad: await readCurrent(), hostName: user.username, saveName });
    }
    if (request.method !== 'POST') throw new ApiError(405, '需要 POST。');
    if (this.pendingSquads.has(profile)) throw new ApiError(409, '正在处理该存档的小队，请稍候。');
    this.pendingSquads.add(profile);
    try {
      const payload = await readPayload(request, 32768);
      if (url.pathname.endsWith('/create')) {
        if (payload.squad !== true) throw new ApiError(400, '请从联机小队创建，再从小队开启战斗。');
        if (await readCurrent()) throw new ApiError(409, '这个存档已有小队。');
        const libraryAnchor = this.sql.exec("SELECT value FROM metadata WHERE key = 'storyLibraryAnchor'").toArray()[0]?.value;
        const result = await createBattleRoom(this.roomEnv, campaign, payload, { account: user.id, profile, saveName, libraryAnchor });
        if (!result.ok) return result;
        const { room, keys } = await result.clone().json();
        this.sql.exec('INSERT OR REPLACE INTO owned_squads VALUES (?, ?, ?)', profile, room.id, JSON.stringify({ token: keys.host, keys }));
        return result;
      }
      const { id, credentials } = payload;
      if (!/^[a-f0-9]{32}$/.test(id || '') || !/^[a-f0-9]{64}$/.test(credentials?.token || '')) throw new ApiError(400, '小队凭证无效。');
      if (registered()?.room !== id && await readCurrent()) throw new ApiError(409, '这个存档已有小队。');
      const result = await roomStub(id).fetch('https://battle-room.internal/link-owner', {
        method: 'POST', headers: { Authorization: 'Bearer ' + credentials.token },
        body: JSON.stringify({ account: user.id, profile, saveName, keys: credentials.keys, abilityOptions: squadAbilityOptions(campaign),
          storyStats: squadHeroStats(campaign), ...squadTitanTrauma(campaign), roster: squadRosterForCampaign(campaign) }),
      });
      if (!result.ok) return result;
      const linked = await result.json();
      if (linked.libraryAnchor) this.sql.exec("INSERT OR REPLACE INTO metadata VALUES ('storyLibraryAnchor', ?)", linked.libraryAnchor);
      const prior = registered();
      const savedKeys = linked.keys || (prior?.room === id && JSON.parse(prior.credentials).keys);
      this.sql.exec('INSERT OR REPLACE INTO owned_squads VALUES (?, ?, ?)', profile, id, JSON.stringify({ token: credentials.token, ...(savedKeys && { keys: savedKeys }) }));
      return response({ ok: true });
    } finally {
      this.pendingSquads.delete(profile);
    }
  }

  async authenticate(request, url, action, user) {
    const { password } = await readPayload(request, 4096);
    const now = Date.now();
    const getAccount = () => this.sql.exec('SELECT salt, hash, failures, blocked_until FROM account WHERE singleton = 1').toArray()[0];
    const account = getAccount();
    if (action === 'register') {
      if (account) throw new ApiError(409, 'Account already exists.');
      const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
      const hash = await passwordHash(password, salt);
      if (getAccount()) throw new ApiError(409, 'Account already exists.');
      this.sql.exec('INSERT INTO account(singleton, salt, hash) VALUES (1, ?, ?)', salt, hash.buffer);
    } else {
      if (account?.blocked_until > now) throw new ApiError(429, 'Too many attempts. Please try again shortly.');
      const expected = account ? new Uint8Array(account.hash) : new Uint8Array(32);
      const actual = await passwordHash(password, account?.salt || 'unregistered-account');
      if (!crypto.subtle.timingSafeEqual(expected, actual) || !account) {
        if (account) this.sql.exec(`
          UPDATE account SET failures = CASE WHEN blocked_until > 0 AND blocked_until <= ? THEN 1 ELSE failures + 1 END,
            blocked_until = CASE WHEN failures >= 7 AND (blocked_until = 0 OR blocked_until > ?) THEN ? ELSE 0 END
          WHERE singleton = 1`, now, now, now + 60000);
        throw new ApiError(401, 'Account or password is incorrect.');
      }
      this.sql.exec('UPDATE account SET failures = 0, blocked_until = 0 WHERE singleton = 1');
    }
    const token = `${user.id}.${toHex(crypto.getRandomValues(new Uint8Array(32)))}`;
    const hash = await sessionHash(token);
    this.sql.exec('DELETE FROM sessions WHERE expires <= ?', now);
    this.sql.exec('INSERT INTO sessions(hash, expires) VALUES (?, ?)', hash, now + sessionLifetime * 1000);
    const oldToken = tokenFrom(request);
    if (oldToken.startsWith(user.id + '.')) this.sql.exec('DELETE FROM sessions WHERE hash = ?', await sessionHash(oldToken));
    return response({ ok: true, user }, 200, { 'Set-Cookie': cookie(url, token, sessionLifetime) });
  }

  loadCampaign() {
    const campaign = defaultCampaign();
    for (const row of this.sql.exec('SELECT name, state, revision FROM saves')) {
      campaign.sections[row.name] = JSON.parse(row.state);
      campaign.sectionRevisions[row.name] = row.revision;
    }
    campaign.updatedAt = this.sql.exec("SELECT value FROM metadata WHERE key = 'updatedAt'").toArray()[0]?.value || null;
    return campaign;
  }

  readCampaign(url, user) {
    const section = url.searchParams.get('section');
    if (section !== null && !sections.includes(section)) throw new ApiError(400, 'Unknown section.');
    const campaign = this.loadCampaign();
    if (section === null) return response({ ok: true, exists: true, campaign, user });
    return response({
      ok: true, exists: campaign.sections[section] !== null, section,
      state: campaign.sections[section], revision: campaign.sectionRevisions[section],
      updatedAt: campaign.updatedAt, user,
      ...(section === 'theatre' ? { dashboardCycle: activeCycle(campaign) } : {}),
    });
  }

  saveCampaign(url, action, user, payload) {
    let identity;
    if (action === 'ascend-gear') {
      if (!inventory.ascensionEnabled) throw new ApiError(403, '登升功能尚未开启。', { code: 'ASCENSION_DISABLED' });
      if (payload.expectedAccountId !== user.id) throw new ApiError(409, '账号已切换，请重新打开军械库。');
      identity = ascensionIdentity(payload);
      const prior = this.sql.exec('SELECT identity, result FROM gear_operations WHERE id = ?', payload.operationId).toArray()[0];
      if (prior) {
        if (prior.identity !== identity) throw new ApiError(409, '该操作编号已用于另一件装备。');
        return response({ ...JSON.parse(prior.result), replayed: true });
      }
    }
    const campaign = this.loadCampaign();
    const updated = new Set();
    const now = new Date().toISOString();
    let section;
    let ascension;
    if (action === 'ascend-gear') {
      ascension = ascendCampaignGear(campaign, payload, updated);
    } else if (action === 'import-sections') {
      importSections(campaign, payload, updated);
    } else {
      section = payload.section ?? url.searchParams.get('section');
      if (!sections.includes(section)) throw new ApiError(400, 'Unknown section.');
      if (!Object.hasOwn(payload, 'state')) throw new ApiError(400, 'Missing state.');
      const revision = campaign.sectionRevisions[section];
      if (payload.expectedRevision != null && Number(payload.expectedRevision) !== revision) {
        throw new ApiError(409, 'This section was changed in another page.', {
          code: 'SAVE_CONFLICT', section, revision, updatedAt: campaign.updatedAt,
        });
      }
      appendNotes(campaign, payload, updated, now);
      writeSection(campaign, section, payload.state, payload.userId, updated);
    }
    for (const name of updated) {
      const state = JSON.stringify(campaign.sections[name]);
      if (encoder.encode(state).byteLength > maximumSave) throw new ApiError(413, 'Save section is too large.');
      this.sql.exec('INSERT OR REPLACE INTO saves(name, state, revision) VALUES (?, ?, ?)', name, state, campaign.sectionRevisions[name]);
    }
    this.sql.exec("INSERT OR REPLACE INTO metadata(key, value) VALUES ('updatedAt', ?)", now);
    const result = section
      ? { section, revision: campaign.sectionRevisions[section] }
      : { sections: Object.fromEntries([...updated].map(name => [name, campaign.sectionRevisions[name]])) };
    const output = { ok: true, ...result, updatedAt: now, user, ...(ascension && { ascension }) };
    if (identity) this.sql.exec('INSERT INTO gear_operations VALUES (?, ?, ?)', payload.operationId, identity, JSON.stringify(output));
    return response(output);
  }
}
