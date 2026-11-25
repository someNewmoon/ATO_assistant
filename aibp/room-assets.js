(() => {
  const origin = new URL('../', location.href);
  const box = document.getElementById('battleRoomImage');
  const image = box.querySelector('.room-zoom-card > img');
  const markers = box.querySelector('[data-art-markers]');
  let markerSource = null;
  let markerKey = '';
  const error = box.querySelector('[data-art-error]');
  const toggle = box.querySelector('[data-art-switch]');
  let hosted = { equipment: {}, titans: [], titanScans: {}, mnemos: {}, thumbs: {}, ...window.ATO_ROOM_ART };

  function refreshZoomMarkers() {
    const tokens = markerSource?.() || [];
    const key = JSON.stringify(tokens);
    if (key === markerKey) return;
    markerKey = key;
    markers.replaceChildren();
    markers.hidden = tokens.length === 0;
    for (const [group, prefix] of [['accuracy', /^(ps|ED)/], ['field', /^AT/], ['danger', /^(DA|py)/]]) {
      const row = document.createElement('div');
      row.className = 'room-zoom-marker-row room-zoom-marker-' + group;
      for (const token of tokens.filter(item => prefix.test(item.file))) {
        const marker = document.createElement('span');
        marker.className = 'room-zoom-marker';
        const icon = document.createElement('img');
        icon.src = '/aibp/ps/other/token/' + encodeURIComponent(token.file);
        icon.alt = token.name;
        marker.append(icon);
        const label = [token.count > 1 ? '×' + token.count : '', token.label, token.perHit ? '每命中' : ''].filter(Boolean).join(' · ');
        if (label) {
          const badge = document.createElement('span');
          badge.textContent = label;
          marker.append(badge);
        }
        row.append(marker);
      }
      if (row.childElementCount) markers.append(row);
    }
  }

  function display(path, name, related = null, tokensForCard = null) {
    if (!path) return;
    error.hidden = true;
    image.alt = name;
    image.src = path;
    markerSource = tokensForCard && (() => tokensForCard(path));
    refreshZoomMarkers();
    toggle.hidden = !related;
    if (related) {
      toggle.textContent = related.label;
      toggle.onclick = () => display(related.src, related.label, { src: path, label: name }, tokensForCard);
    } else toggle.onclick = null;
    if (!box.open) box.showModal();
  }

  function imageURL(path) {
    return path ? new URL(path, origin).href : '';
  }

  function gearImage(collection, id) {
    const base = window.ATO_GEAR_INVENTORY.baseGearId(id);
    return imageURL(Object.hasOwn(collection, id) ? collection[id]
      : Object.hasOwn(collection, base) ? collection[base] : '');
  }

  function gearSrc(id, language) {
    return (language === 'fan' && gearImage(hosted.fanEquipment || {}, id)) || gearImage(hosted.equipment, id);
  }

  window.ATO_BATTLE_ASSETS = {
    gearSrc,
    gearThumbSrc: (id, language) => gearSrc(id, language) === gearImage(hosted.fanEquipment || {}, id)
      ? gearImage(hosted.thumbs, id) : '',
    mnemosSrc: id => imageURL(Object.hasOwn(hosted.mnemos, id) && hosted.mnemos[id]),
    thumbSrc: id => gearImage(hosted.thumbs, id),
    titanArt(titan) {
      const art = window.ATO_GEAR_INVENTORY.titanArtwork(titan, hosted);
      return art && { ...art, src: imageURL(art.path) };
    },
    zoom: display,
    refreshZoomMarkers,
  };

  image.addEventListener('error', () => { error.hidden = false; });
  box.addEventListener('close', () => {
    image.removeAttribute('src');
    markerSource = null;
    refreshZoomMarkers();
  });
  if (!window.ATO_ROOM_ART) void fetch(new URL('room-card-art.json', location.href)).then(async response => {
    if (!response.ok) return;
    hosted = { ...hosted, ...await response.json() };
    document.dispatchEvent(new Event('ato-battle-assets'));
  }).catch(() => {});
})();
