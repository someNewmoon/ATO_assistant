(() => {
  const origin = new URL('../', location.href);
  const box = document.getElementById('battleRoomImage');
  const image = box.querySelector('img');
  const error = box.querySelector('[data-art-error]');
  let hosted = { equipment: {}, titans: [], titanScans: {}, mnemos: {}, thumbs: {}, ...window.ATO_ROOM_ART };

  function display(path, name) {
    if (!path) return;
    error.hidden = true;
    image.alt = name;
    image.src = path;
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
  };

  image.addEventListener('error', () => { error.hidden = false; });
  box.addEventListener('close', () => image.removeAttribute('src'));
  if (!window.ATO_ROOM_ART) void fetch(new URL('room-card-art.json', location.href)).then(async response => {
    if (!response.ok) return;
    hosted = { ...hosted, ...await response.json() };
    document.dispatchEvent(new Event('ato-battle-assets'));
  }).catch(() => {});
})();
