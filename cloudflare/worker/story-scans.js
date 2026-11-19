import { ApiError, response } from './campaign.js';

export const storyScanFilename = /^c[1-5]-[A-Za-z0-9_-]+\.[a-f0-9]{20}\.bin$/;
export const storyScanPrefix = '/story/scans/';

export async function storyScanKey(config, file) {
  if (!file || !storyScanFilename.test(file)) throw new ApiError(404, '找不到这张官方扫描图。');
  if (!config) throw new ApiError(503, '线上故事书尚未导入。');
  const { key } = JSON.parse(config);
  const raw = Uint8Array.from(atob(key), char => char.charCodeAt(0));
  const master = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', master, new TextEncoder().encode('story-scan:' + file));
  return response({ ok: true, key: btoa(String.fromCharCode(...new Uint8Array(bytes))) });
}
