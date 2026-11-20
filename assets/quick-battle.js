(() => {
  const gate = document.getElementById('authGate'), root = document.querySelector('[data-quick-battle]');
  if (!gate || !root) return;
  const list = root.querySelector('[data-quick-rooms]'), status = root.querySelector('[data-quick-status]');
  const refresh = root.querySelector('[data-quick-refresh]');
  const tools = document.querySelectorAll('[data-online-squads], [data-online-trauma]');
  void fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) }).then(async response => {
    if (response.ok && (await response.json()).backend === 'cloudflare') tools.forEach(link => { link.hidden = false; });
  }).catch(() => {});
  let pending = false, loaded = false;
  async function load() {
    if (pending) return;
    pending = true; refresh.disabled = true; root.hidden = false; status.textContent = "正在读取小队…";
    try {
      const response = await fetch('/api/battle-room/open', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        if ([404, 501].includes(response.status)) { root.hidden = true; return; }
        throw new Error("Unavailable");
      }
      const data = await response.json();
      if (!Array.isArray(data.rooms)) return;
      loaded = true; root.hidden = false; list.replaceChildren();
      for (const room of data.rooms) {
        if (!room.squad || !/^[a-f0-9]{32}$/.test(room.id)) continue;
        const link = document.createElement('a'), title = document.createElement('strong'), detail = document.createElement('small');
        const url = new URL('/aibp/squad', location.href);
        url.searchParams.set('squad', room.id);
        url.searchParams.set('quick', '1');
        link.href = url.href; title.setAttribute("data-user-content", ""); title.textContent = room.title;
        detail.textContent = '房主 ' + (room.hostName || '尚未绑定') + ' · 存档 ' + (room.saveName || room.title)
          + ' · ' + ({ story: '读剧情', prep: '备战', battle: '决战' }[room.phase] || '待命')
          + ' · ' + (room.available ? '空位 ' + room.available + ' / ' + room.seats : '席位已满');
        link.append(title, detail); list.appendChild(link);
      }
      try {
        const recent = localStorage.getItem('ato-last-squad');
        if (/^[a-f0-9]{32}$/.test(recent || '') && localStorage.getItem('ato-aibp-room-' + recent)) {
          const resume = document.createElement('a');
          resume.href = '/aibp/squad?squad=' + recent;
          resume.textContent = '返回上次的小队';
          list.prepend(resume);
        }
      } catch { /* Storage is optional. */ }
      status.textContent = list.children.length ? '认领后会保存在当前浏览器，之后可直接返回。' : '暂无开放的小队。';
    } catch {
      status.textContent = '暂时无法读取小队，请刷新重试。';
    } finally { pending = false; refresh.disabled = false; }
  }
  refresh.addEventListener('click', load);
  const check = () => { if (!gate.hidden && !loaded) void load(); };
  new MutationObserver(check).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
  check();
})();
