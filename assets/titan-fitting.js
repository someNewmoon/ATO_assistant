(() => {
  const selected = new Map();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const position = {
    arm: [30, 50], armor: [50, 43], aid: [73, 64], attachment: [69, 45], other: [50, 72],
  };
  // Anchors on the actual Mazerunner portrait. Other models use category positions.
  const mazerunner = { arm: [29, 47], armor: [66, 54], aid: [55, 72], attachment: [65, 43] };

  function portrait(titan, fallback) {
    const inv = window.ATO_GEAR_INVENTORY;
    const panel = inv.dreamwalkerPanel(titan);
    const type = inv.titanType(titan);
    if (panel) return '../aibp/images/titan-portraits/' + panel.id + '.jpg';
    if (type?.portrait) return '../technology/images/titans/' + type.portrait + '.png';
    return fallback || '';
  }

  let artLibrary;
  const assets = () => artLibrary ||= fetch('../aibp/room-card-art.json')
    .then(response => response.ok ? response.json() : {}).catch(() => ({}));
  const artURL = path => path ? '../' + path.replace(/^\/+/, '') : '';
  const artGear = (art, id) => artURL(art?.equipment?.[id.split('@')[0]] || art?.fanEquipment?.[id.split('@')[0]]);
  const artMemory = (art, id) => artURL(art?.mnemos?.[id]);

  function part(category) {
    const normalized = String(category || '').split('_')[0];
    return Object.hasOwn(position, normalized) ? normalized : 'other';
  }

  function render({ key, mode, titan, name, panel, figure, gear = [], references = [], kratos = '', zoom = false }) {
    const inv = window.ATO_GEAR_INVENTORY;
    const type = inv.titanType(titan)?.id || '';
    const image = figure || portrait(titan, panel);
    const cards = [...gear, ...references];
    const featured = cards.find(card => card.key === selected.get(key)) || cards.find(card => card.src) || cards[0];
    if (featured) selected.set(key, featured.key);
    const picture = card => card?.src
      ? '<img src="' + esc(card.thumb || card.src) + '" alt="" loading="lazy" decoding="async">' : '';
    const slot = card => '<article class="titan-fitting-slot" data-fitting-state="' + esc(card.state) + '">'
      + '<button type="button" class="titan-fitting-card" data-fitting-choice="' + esc(card.key) + '" aria-pressed="' + (featured === card)
      + '" data-fitting-src="' + esc(card.src) + '" data-fitting-name="' + esc(card.name) + '" data-fitting-part="' + esc(card.part)
      + '" data-fitting-detail="' + esc(card.detail) + '">' + picture(card)
      + '<span>' + esc(card.name) + '</span>' + (card.detail ? '<small>' + esc(card.detail) + '</small>' : '') + '</button>'
      + (card.actions ? '<div class="titan-fitting-actions">' + card.actions + '</div>' : '') + '</article>';
    const side = groups => groups.map(part => {
      const entries = gear.filter(card => card.part === part);
      if (!entries.length && !['arm', 'armor', 'aid'].includes(part)) return '';
      return '<section class="titan-fitting-group"><h5>' + esc(inv.gearGroups[part]) + '</h5>'
        + (entries.map(slot).join('') || '<div class="titan-fitting-empty">空槽</div>') + '</section>';
    }).join('');
    const feature = featured?.src ? '<img src="' + esc(featured.src) + '" alt="' + esc(featured.name) + '" decoding="async">' : '';
    const link = featured?.src || '';
    return '<div class="titan-fitting" data-fitting="' + esc(key) + '" data-fitting-mode="' + esc(mode)
      + '" data-fitting-titan="' + esc(type) + '"><div class="titan-fitting-layout"><div class="titan-fitting-stage"'
      + (featured?.part && image ? ' data-fitting-active="' + esc(featured.part) + '"' : '') + '>'
      + '<div class="titan-fitting-wing">' + side(['arm', 'armor']) + '</div>'
      + '<figure><div class="titan-fitting-model">' + (image ? '<img class="titan-fitting-figure" src="' + esc(image)
        + '" data-fitting-fallback="' + esc(panel) + '" alt="" decoding="async">' : '') + '<span class="titan-fitting-target" aria-hidden="true"></span></div>'
      + '<figcaption>' + esc(name || '未选择泰坦') + '</figcaption></figure>'
      + '<div class="titan-fitting-wing">' + side(['aid', 'attachment', 'other']) + '</div>'
      + '<svg class="titan-fitting-line" aria-hidden="true"><line/></svg></div>'
      + '<aside class="titan-fitting-preview" aria-label="原卡预览"><header><strong data-fitting-preview-name>' + esc(featured?.name || '原卡预览')
      + '</strong><small data-fitting-preview-detail>' + esc(featured?.detail) + '</small></header>'
      + (zoom ? '<button type="button" class="titan-fitting-original" data-room-art="' + esc(link)
        + '" aria-label="放大原卡"' + (link ? '' : ' hidden') + '>' + feature + '</button>'
        : '<a class="titan-fitting-original" target="_blank" rel="noopener" href="' + esc(link)
          + '" aria-label="打开原卡"' + (link ? '' : ' hidden') + '>' + feature + '</a>')
      + '<small data-fitting-no-art' + (link ? ' hidden' : '') + '>暂无卡图</small></aside></div>'
      + (references.length ? '<div class="titan-fitting-archive">' + references.map(slot).join('') + '</div>' : '')
      + kratos + '</div>';
  }

  function updateLine(fitting) {
    const stage = fitting.querySelector('.titan-fitting-stage');
    const model = stage.querySelector('.titan-fitting-model');
    const button = stage.querySelector('[aria-pressed="true"]');
    const figure = model.querySelector('img:not([hidden])');
    const part = button?.dataset.fittingPart;
    if (!figure || !position[part]) { stage.removeAttribute('data-fitting-active'); return; }
    const [x, y] = (fitting.dataset.fittingTitan === 'tt_mazerunner' ? mazerunner[part] : null) || position[part];
    stage.dataset.fittingActive = part;
    model.style.setProperty('--fitting-x', x + '%');
    model.style.setProperty('--fitting-y', y + '%');
    const stageRect = stage.getBoundingClientRect(), modelRect = model.getBoundingClientRect(), slot = button.getBoundingClientRect();
    const line = stage.querySelector('line');
    const values = {
      x1: (slot.left < modelRect.left ? slot.right : slot.left) - stageRect.left,
      y1: slot.top + slot.height / 2 - stageRect.top,
      x2: modelRect.left + modelRect.width * x / 100 - stageRect.left,
      y2: modelRect.top + modelRect.height * y / 100 - stageRect.top,
    };
    for (const [name, value] of Object.entries(values)) line.setAttribute(name, value);
  }

  const observer = new ResizeObserver(entries => {
    for (const entry of entries) if (entry.target.isConnected) updateLine(entry.target);
  });
  function refresh(root = document) {
    for (const fitting of root.querySelectorAll('[data-fitting]')) {
      observer.observe(fitting);
      updateLine(fitting);
    }
  }
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('[data-fitting]') && !node.isConnected) observer.unobserve(node);
        for (const fitting of node.querySelectorAll('[data-fitting]')) {
          if (!fitting.isConnected) observer.unobserve(fitting);
        }
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('[data-fitting]')) { observer.observe(node); updateLine(node); }
        else refresh(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-fitting-choice]');
    if (!button) return;
    const fitting = button.closest('[data-fitting]');
    const { fittingChoice, fittingSrc, fittingName, fittingDetail } = button.dataset;
    selected.set(fitting.dataset.fitting, fittingChoice);
    for (const slot of fitting.querySelectorAll('[data-fitting-choice]')) slot.setAttribute('aria-pressed', String(slot === button));
    fitting.querySelector('[data-fitting-preview-name]').textContent = fittingName;
    fitting.querySelector('[data-fitting-preview-detail]').textContent = fittingDetail;
    const original = fitting.querySelector('.titan-fitting-original');
    original.hidden = !fittingSrc;
    fitting.querySelector('[data-fitting-no-art]').hidden = Boolean(fittingSrc);
    if (fittingSrc) {
      const img = new Image();
      img.alt = fittingName;
      img.src = fittingSrc;
      original.replaceChildren(img);
      if (original.matches('button')) original.dataset.roomArt = fittingSrc;
      else original.href = fittingSrc;
    }
    updateLine(fitting);
  });
  document.addEventListener('error', event => {
    const image = event.target;
    if (!image.matches?.('.titan-fitting img')) return;
    const fallback = image.dataset.fittingFallback;
    if (fallback && image.getAttribute('src') !== fallback) image.src = fallback;
    else image.hidden = true;
    if (image.matches('.titan-fitting-figure')) updateLine(image.closest('[data-fitting]'));
  }, true);

  window.ATO_TITAN_FITTING = { render, assets, artGear, artMemory, part };
})();
