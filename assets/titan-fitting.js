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

  // Head centers measured in the model box for each installed portrait.
  const titanHeads = {
    herodotus: [39, 34], philoctetra: [32, 38], solon: [36, 37], ulyssia: [44, 39],
    tt_ascender: [52, 23], tt_cloudsoarer: [36, 22], tt_earthshaker: [41, 29],
    tt_executioner: [59, 11], tt_feareater: [49, 16], tt_firestarter: [52, 34],
    tt_helldiver: [44, 21], tt_mazerunner: [71, 19], tt_pabysswatcher: [42, 22],
    tt_pdawnburner: [81, 29], tt_plogicbreaker: [29, 36], tt_plunarlander: [59, 32],
    tt_returner: [29, 18], tt_shadowdancer: [55, 24], tt_trespasser: [41, 16],
    tt_warkeeper: [54, 19], tt_wishender: [42, 22],
  };
  const pool = [51, 83];

  function ritualLight(head) {
    if (!head) return '';
    const [x, y] = head;
    // The model occupies 84% of the composition height after the pool overlaps it.
    const start = y * .84;
    const [endX, endY] = pool;
    const rise = endY - start;
    const path = offset => 'M ' + endX + ' ' + endY + ' C '
      + (endX + 8 + offset) + ' ' + (endY - rise * .23) + ', '
      + (x - 14 + offset) + ' ' + (start + rise * .40) + ', ' + x + ' ' + start;
    return '<div class="titan-fitting-mind-link" aria-hidden="true" style="--head-x:' + x + '%;--head-y:' + start
      + '%;--pool-x:' + endX + '%;--pool-y:' + endY + '%">'
      + '<svg viewBox="0 0 100 100" preserveAspectRatio="none">'
      + '<path class="titan-fitting-mist-wide" d="' + path(1) + '"/>'
      + '<path class="titan-fitting-mist-deep" d="' + path(-3) + '"/>'
      + '<path class="titan-fitting-mist-light" d="' + path(3) + '"/></svg>'
      + '<span class="titan-fitting-head-glow"></span><span class="titan-fitting-pool-glow"></span></div>';
  }

  // Use the stable IDs of the pilots whose artwork is documented in titan-link.
  const bathArt = {
    circe: 'triskelion-dream-woman.jpg',
    phenelope: 'triskelion-dream-woman.jpg',
    olympia: 'triskelion-dream-woman.jpg',
    oleander: 'triskelion-dream-man-matched.jpg',
  };

  let keywordLibrary;
  function definitions() {
    return keywordLibrary ||= fetch('../aibp/ato-keywords.json?v=11')
      .then(response => {
        if (!response.ok) throw new Error('Keyword definitions unavailable');
        return response.json();
      })
      .then(data => new Map((data.entries || []).filter(entry => entry.officialName && entry.officialDefinition)
        .map(entry => [entry.word, entry])))
      .catch(() => { keywordLibrary = null; return new Map(); });
  }

  async function updateKeywords(fitting, button = fitting.querySelector('[data-fitting-choice][aria-pressed="true"]')) {
    const panel = fitting.querySelector('[data-fitting-keywords]');
    const list = panel.querySelector('dl');
    const gearId = button?.dataset.fittingGear;
    const entries = gearId ? window.ATO_GEAR_ROLL_PROFILES?.fittingKeywords(gearId) || [] : [];
    if (!entries.length || panel.dataset.gearId !== gearId) {
      panel.hidden = true;
      list.replaceChildren();
      panel.dataset.gearId = gearId || '';
    }
    if (!entries.length) return;
    const library = await definitions();
    if (!fitting.isConnected || button !== fitting.querySelector('[data-fitting-choice][aria-pressed="true"]')) return;
    if (!list.childElementCount) {
      for (const { word, value, condition } of entries) {
        const entry = library.get(word);
        if (!entry) continue;
        const term = document.createElement('dt');
        term.textContent = value === undefined ? entry.officialName.replace(/X$/, ' X') : entry.officialName.replace(/X$/, ' ' + value);
        const definition = document.createElement('dd');
        if (condition) {
          const trigger = document.createElement('strong');
          trigger.textContent = condition;
          definition.append(trigger);
        }
        definition.append(value === undefined ? entry.officialDefinition : entry.officialDefinition.replaceAll('X', String(value)));
        list.append(term, definition);
      }
    }
    panel.hidden = !list.childElementCount;
  }

  function render({ key, mode, titan, name, panel, figure, argonaut, gear = [], references = [], kratos = '', zoom = false }) {
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
      + '" data-fitting-detail="' + esc(card.detail) + '" data-fitting-gear="' + esc(card.gearId) + '">' + picture(card)
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
    const pilot = references.find(card => card.key === 'hero');
    const bathImage = Object.hasOwn(bathArt, argonaut) ? bathArt[argonaut] : bathArt.circe;
    const bath = pilot ? '<button type="button" class="titan-fitting-bath" data-fitting-bath aria-pressed="' + (pilot === featured)
      + '" aria-label="查看英雄 ' + esc(pilot.name) + '"><img src="../assets/titan-fitting/' + bathImage
      + '" alt="" loading="lazy" decoding="async"><span>' + esc(pilot.name) + '</span></button>' : '';
    const modelId = inv.dreamwalkerPanel(titan)?.id || type;
    const mindLink = pilot && image && !figure ? ritualLight(titanHeads[modelId]) : '';
    return '<div class="titan-fitting" data-fitting="' + esc(key) + '" data-fitting-mode="' + esc(mode)
      + '" data-fitting-titan="' + esc(type) + '"><div class="titan-fitting-layout"><div class="titan-fitting-main">'
      + (references.length ? '<div class="titan-fitting-archive">' + references.map(slot).join('') + '</div>' : '')
      + '<div class="titan-fitting-stage"' + (featured?.part && image ? ' data-fitting-active="' + esc(featured.part) + '"' : '') + '>'
      + '<div class="titan-fitting-wing">' + side(['arm', 'armor']) + '</div>'
      + '<figure><div class="titan-fitting-composition"><div class="titan-fitting-model">' + (image ? '<img class="titan-fitting-figure" src="' + esc(image)
        + '" data-fitting-fallback="' + esc(panel) + '" alt="" decoding="async">' : '') + '<span class="titan-fitting-target" aria-hidden="true"></span></div>'
      + bath + mindLink + '</div><figcaption>' + esc(name || '未选择泰坦') + '</figcaption></figure>'
      + '<div class="titan-fitting-wing">' + side(['aid', 'attachment', 'other']) + '</div>'
      + '<svg class="titan-fitting-line" aria-hidden="true"><line/></svg></div>' + kratos + '</div>'
      + '<aside class="titan-fitting-preview" aria-label="原卡预览"><header><strong data-fitting-preview-name>' + esc(featured?.name || '原卡预览')
      + '</strong><small data-fitting-preview-detail>' + esc(featured?.detail) + '</small></header>'
      + (zoom ? '<button type="button" class="titan-fitting-original" data-room-art="' + esc(link)
        + '" aria-label="放大原卡"' + (link ? '' : ' hidden') + '>' + feature + '</button>'
        : '<a class="titan-fitting-original" target="_blank" rel="noopener" href="' + esc(link)
          + '" aria-label="打开原卡"' + (link ? '' : ' hidden') + '>' + feature + '</a>')
      + '<small data-fitting-no-art' + (link ? ' hidden' : '') + '>暂无卡图</small>'
      + '<details class="titan-fitting-keywords" data-fitting-keywords data-language-ignore hidden'
      + (window.matchMedia('(min-width: 641px)').matches ? ' open' : '') + '><summary>关键词速查</summary><dl></dl></details>'
      + '</aside></div></div>';
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
  function mount(fitting) {
    observer.observe(fitting);
    updateLine(fitting);
    void updateKeywords(fitting);
  }
  function refresh(root = document) {
    for (const fitting of root.querySelectorAll('[data-fitting]')) mount(fitting);
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
        if (node.matches('[data-fitting]')) mount(node);
        else refresh(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('click', event => {
    const bath = event.target.closest('[data-fitting-bath]');
    if (bath) {
      bath.closest('[data-fitting]').querySelector('[data-fitting-choice="hero"]')?.click();
      return;
    }
    const button = event.target.closest('[data-fitting-choice]');
    if (!button) return;
    const fitting = button.closest('[data-fitting]');
    const { fittingChoice, fittingSrc, fittingName, fittingDetail } = button.dataset;
    selected.set(fitting.dataset.fitting, fittingChoice);
    for (const slot of fitting.querySelectorAll('[data-fitting-choice]')) slot.setAttribute('aria-pressed', String(slot === button));
    fitting.querySelector('[data-fitting-bath]')?.setAttribute('aria-pressed', String(fittingChoice === 'hero'));
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
    void updateKeywords(fitting, button);
  });
  document.addEventListener('error', event => {
    const image = event.target;
    if (!image.matches?.('.titan-fitting img')) return;
    const fallback = image.dataset.fittingFallback;
    if (fallback && image.getAttribute('src') !== fallback) image.src = fallback;
    else image.hidden = true;
    if (image.matches('.titan-fitting-figure')) {
      image.closest('.titan-fitting-composition').querySelector('.titan-fitting-mind-link')?.remove();
      updateLine(image.closest('[data-fitting]'));
    }
  }, true);

  window.ATO_TITAN_FITTING = { render, assets, artGear, artMemory, part };
})();
