(() => {
  const controls = document.getElementById('battleRoomAssets');
  const picker = controls.querySelector('input');
  const notice = controls.querySelector('output');
  const clear = controls.querySelector('button');
  const indexName = 'ato-aibp-assets-index-v1';
  const marker = new URL('local-assets-index', location.href);
  const origin = new URL('../', location.href);
  const allowed = /^(?:aibp\/(?:ps|images)|technology\/images\/gear_cards|hero\/assets|ss\/(?:terrain|terrain-cards|battle-board|tokens))\/(?:[^/]+\/)*[^/]+\.(?:jpe?g|png|webp)$/i;
  const roots = new Set(['aibp', 'technology', 'hero', 'ss']);
  const box = document.getElementById('battleRoomImage');
  let assets = null;
  let working = false;
  let hosted = { equipment: {}, titans: [] };
  const imageElement = box.querySelector('img');
  const imageError = box.querySelector('[data-art-error]');
  const canImport = window.isSecureContext && 'serviceWorker' in navigator && 'caches' in window && 'webkitdirectory' in picker;

  function target(file) {
    const parts = file.webkitRelativePath.split('/');
    const index = parts.findIndex(part => roots.has(part));
    if (index < 0) return '';
    const path = parts.slice(index);
    if (path.some(part => !part || part === '.' || part === '..' || /[\\?#%]/.test(part))) return '';
    return allowed.test(path.join('/')) ? path.map(encodeURIComponent).join('/') : '';
  }

  function mediaType(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
    const header = String.fromCharCode(...bytes);
    if (header.startsWith('RIFF') && header.slice(8,12) === 'WEBP') return 'image/webp';
    return '';
  }

  function showCurrent() {
    notice.textContent = assets ? '本机已导入 ' + assets.count + ' 张图片'
      : Object.keys(hosted.equipment).length ? '网页已提供卡图，也可以选用自己的图片文件夹。' : '选择分离出来的「图片」文件夹';
    clear.hidden = !assets;
  }

  async function restore() {
    const cache = await caches.open(indexName);
    const entry = await cache.match(marker);
    if (entry) assets = await entry.json();
    showCurrent();
  }

  async function importFolder(files) {
    const available = [...new Map(files.map(file => [target(file), file])).entries()].filter(([path]) => path);
    if (!available.length) throw new Error('这个文件夹里没有可识别的 AIBP 图片。请选择保留原目录的「图片」文件夹。');
    const cacheName = 'ato-aibp-assets-' + crypto.randomUUID();
    const index = await caches.open(indexName);
    const images = await caches.open(cacheName);
    const entries = Object.create(null);
    try {
      const registration = await navigator.serviceWorker.register(new URL('room-assets-worker.js', location.href));
      if (registration.active) void registration.update().catch(() => {});
      for (let offset = 0; offset < available.length; offset += 24) {
        const candidates = await Promise.all(available.slice(offset, offset + 24).map(async ([path, file]) => {
          if (file.size > 25 * 1024 * 1024) return null;
          const data = await file.arrayBuffer();
          const type = mediaType(new Uint8Array(data, 0, Math.min(12, data.byteLength)));
          return type ? { path, data, type } : null;
        }));
        const group = candidates.filter(Boolean);
        if (group.length) {
          const member = 'local-assets-group-' + offset;
          const parts = [];
          let start = 0;
          for (const { path, data, type } of group) {
            entries[path] = { member, start, end: start + data.byteLength, type };
            parts.push(data);
            start += data.byteLength;
          }
          await images.put(new URL(member, marker), new Response(new Blob(parts)));
        }
        notice.textContent = '已读取 ' + Math.min(offset + 24, available.length) + ' / ' + available.length + ' 张';
      }
      const count = Object.keys(entries).length;
      if (!count) throw new Error('没有通过格式校验的图片。');
      const previous = await index.match(marker);
      const old = previous && await previous.json();
      const next = { cacheName, count, entries };
      await index.put(marker, new Response(JSON.stringify(next), { headers: { 'X-ATO-Asset-Index': cacheName } }));
      assets = next;
      if (old?.cacheName && old.cacheName !== assets.cacheName) await caches.delete(old.cacheName).catch(() => {});
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  }

  picker.addEventListener('change', async () => {
    if (!picker.files.length || working) return;
    working = true;
    picker.disabled = clear.disabled = true;
    notice.textContent = '正在读取图片目录…';
    try {
      await importFolder([...picker.files]);
      showCurrent();
      notice.textContent += '。刷新 AIBP 后，先前缺失的卡图会重新加载。';
      document.dispatchEvent(new Event('ato-battle-assets'));
    } catch (error) {
      notice.textContent = '导入失败。' + error.message;
    } finally {
      picker.value = '';
      picker.disabled = clear.disabled = false;
      working = false;
    }
  });

  clear.addEventListener('click', async () => {
    if (!assets || working) return;
    const index = await caches.open(indexName);
    await index.delete(marker);
    await caches.delete(assets.cacheName);
    assets = null;
    showCurrent();
    document.dispatchEvent(new Event('ato-battle-assets'));
  });

  const localGearPath = id => 'technology/images/gear_cards/' + id.toLowerCase() + '.jpg';
  const titanPaths = Object.fromEntries(Object.entries(window.ATO_GEAR_INVENTORY.TITAN_NAMES_ZH || {})
    .map(([id, type]) => [type, 'technology/images/titans/' + id + '.png']));

  function hasLocal(path) {
    return Boolean(path && (assets?.entries?.[path] || assets?.paths?.includes(path)));
  }

  async function localBlob(path) {
    if (!hasLocal(path)) return null;
    const pack = await caches.open(assets.cacheName);
    const entry = assets.entries?.[path];
    const reply = await pack.match(entry ? new URL(entry.member, marker) : new URL(path, origin));
    if (!reply) return null;
    const source = await reply.blob();
    return entry ? source.slice(entry.start, entry.end, entry.type) : source;
  }

  function display(src, name) {
    if (imageElement.src.startsWith('blob:')) URL.revokeObjectURL(imageElement.src);
    imageError.hidden = true;
    imageElement.alt = name;
    imageElement.src = src;
    if (!box.open) box.showModal();
  }

  async function showGear(id, name) {
    const path = localGearPath(id);
    const image = await localBlob(path).catch(() => null);
    if (image) display(URL.createObjectURL(image), name);
    else if (Object.hasOwn(hosted.equipment, id)) display(new URL(hosted.equipment[id], origin), name);
  }

  window.ATO_BATTLE_ASSETS = {
    showGear,
    hasGear: id => hasLocal(localGearPath(id)) || Object.hasOwn(hosted.equipment, id),
    hasLocalAibp: path => hasLocal('aibp/' + path),
    hasTitan: type => Object.hasOwn(titanPaths, type) && hosted.titans.includes(titanPaths[type]),
    showTitan(type) {
      if (this.hasTitan(type)) display(new URL(titanPaths[type], origin), type);
    },
  };

  imageElement.addEventListener('error', () => { imageError.hidden = false; });
  box.addEventListener('close', () => {
    if (imageElement.src.startsWith('blob:')) URL.revokeObjectURL(imageElement.src);
    imageElement.removeAttribute('src');
  });
  if (canImport) void restore().then(() => {
    controls.hidden = false;
    document.dispatchEvent(new Event('ato-battle-assets'));
  }).catch(() => {});
  void fetch(new URL('room-card-art.json', location.href)).then(async response => {
    if (!response.ok) return;
    hosted = await response.json();
    if (canImport) showCurrent();
    document.dispatchEvent(new Event('ato-battle-assets'));
  }).catch(() => {});
})();
