(() => {
  const origin = new URL('../', location.href);
  const box = document.getElementById('battleRoomImage');
  const image = box.querySelector('img');
  const error = box.querySelector('[data-art-error]');
  let hosted = { equipment: {}, titans: [], titanScans: {}, mnemos: {} };

  function display(path, name) {
    if (!path) return;
    error.hidden = true;
    image.alt = name;
    image.src = new URL(path, origin);
    if (!box.open) box.showModal();
  }

  const titanArt = titan => window.ATO_GEAR_INVENTORY.titanArtwork(titan, hosted);
  const hasGear = id => Object.hasOwn(hosted.equipment, id);
  const hasMnemos = id => Object.hasOwn(hosted.mnemos, id);

  window.ATO_BATTLE_ASSETS = {
    hasGear,
    showGear(id, name) {
      if (hasGear(id)) display(hosted.equipment[id], name);
    },
    titanArt,
    showTitan(titan) {
      const art = titanArt(titan);
      if (art) display(art.path, art.name);
    },
    hasMnemos,
    showMnemos(id, name) {
      if (hasMnemos(id)) display(hosted.mnemos[id], name);
    },
  };

  image.addEventListener('error', () => { error.hidden = false; });
  box.addEventListener('close', () => image.removeAttribute('src'));
  void fetch(new URL('room-card-art.json', location.href)).then(async response => {
    if (!response.ok) return;
    hosted = { ...hosted, ...await response.json() };
    document.dispatchEvent(new Event('ato-battle-assets'));
  }).catch(() => {});
})();
