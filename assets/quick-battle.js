(() => {
  const gate = document.getElementById('authGate'), root = document.querySelector('[data-quick-battle]');
  if (!gate || !root) return;
  const list = root.querySelector('[data-quick-rooms]'), status = root.querySelector('[data-quick-status]');
  const refresh = root.querySelector('[data-quick-refresh]');
  let pending = false, loaded = false;
  async function load() {
    if (pending) return;
    pending = true; refresh.disabled = true; root.hidden = false; status.textContent = "正在读取房间…";
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
        if (!/^[a-f0-9]{32}$/.test(room.id)) continue;
        const link = document.createElement('a'), title = document.createElement('strong'), detail = document.createElement('small');
        const url = new URL(room.squad ? '/aibp/squad' : '/aibp/room', location.href); url.searchParams.set(room.squad ? 'squad' : 'battle', room.id); url.searchParams.set('quick', '1');
        link.href = url.href; title.setAttribute("data-user-content", ""); title.textContent = room.title;
        detail.textContent = (room.squad ? '联机小队 · ' + ({ story: '读剧情', prep: '备战', battle: '决战' }[room.phase] || '待命') + ' · ' : '第 ' + room.round + ' 轮 · ') + (room.available ? '空位 ' + room.available + ' / ' + room.seats : '席位已满') + (room.squad ? ' · 加入小队' : ' · 进入战斗');
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
      status.textContent = data.rooms.length ? '认领后会保存在当前浏览器，之后可直接返回。' : '暂无开放的战斗或小队。';
    } catch {
      status.textContent = '暂时无法读取房间，请刷新重试。';
    } finally { pending = false; refresh.disabled = false; }
  }
  refresh.addEventListener('click', load);
  const check = () => { if (!gate.hidden && !loaded) void load(); };
  new MutationObserver(check).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
  check();
})();
