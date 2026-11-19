(() => {
  const prefix = '/story/scans/';
  const filePattern = /^c[1-5]-[A-Za-z0-9_-]+\.[a-f0-9]{20}\.bin$/;
  function isEncrypted(path) {
    return typeof path === 'string' && path.startsWith(prefix) && filePattern.test(path.slice(prefix.length));
  }

  let indexRequest;
  function index() {
    if (!window.ATO_STORY_PARTS?.scanIndex) return null;
    indexRequest ||= fetch(prefix + 'index.json', { signal: AbortSignal.timeout(6000) }).then(response => {
      if (!response.ok) throw new Error('官方扫描图索引暂时无法读取。');
      return response.json();
    }).catch(() => { indexRequest = null; return null; });
    return indexRequest;
  }

  async function keyFor(file, { id, token } = {}, signal) {
    const query = '?file=' + encodeURIComponent(file);
    const path = '/api/battle-room/';
    const request = (url, headers) => fetch(url, { headers, signal, cache: 'no-store' });
    let response = token && id ? await request(path + id + '/story-scan' + query, { Authorization: 'Bearer ' + token }) : null;
    if (!response || response.status === 403 || response.status === 401) response = await request(path + 'story-scan' + query);
    if (!response.ok) throw new Error('官方扫描图访问授权失败。');
    const { key } = await response.json();
    const raw = Uint8Array.from(atob(key), char => char.charCodeAt(0));
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  }

  async function open(path, credentials) {
    if (!isEncrypted(path)) throw new Error('官方扫描图地址无效。');
    const file = path.slice(prefix.length);
    const signal = AbortSignal.timeout(20000);
    const [key, response] = await Promise.all([keyFor(file, credentials, signal), fetch(path, { signal, cache: 'force-cache' })]);
    if (!response.ok) throw new Error('官方扫描图加载失败。');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const image = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(file),
    }, key, bytes.subarray(12));
    return URL.createObjectURL(new Blob([image], { type: 'image/jpeg' }));
  }

  window.ATO_STORY_SCANS = { isEncrypted, index, open, prefix };
})();
