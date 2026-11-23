const diplomacyTracks = document.querySelector('#diplomacyTracks');

if (diplomacyTracks) {
  function decorateDiplomacy() {
    for (const row of diplomacyTracks.querySelectorAll('.diplomacy-row')) {
      const active = row.querySelector('.diplomacy-chips .active');
      const markers = [...row.querySelectorAll('.diplomacy-marker')];
      const chips = row.querySelectorAll('.diplomacy-chips .chip');
      row.style.setProperty('--art-diplomacy-count', chips.length);
      const value = active ? Number(active.textContent) : null;
      const match = markers.find(marker => active &&
        value >= Number(marker.dataset.rangeStart) && value <= Number(marker.dataset.rangeEnd));

      for (const [index, marker] of markers.entries()) {
        marker.dataset.tone = String(index);
        marker.classList.toggle('art-current', marker === match);
      }
      for (const chip of chips) {
        const chipValue = Number(chip.textContent);
        const group = markers.findIndex(marker =>
          chipValue >= Number(marker.dataset.rangeStart) && chipValue <= Number(marker.dataset.rangeEnd));
        chip.dataset.tone = String(group);
        chip.setAttribute('aria-pressed', String(chip === active));
      }

      const title = row.querySelector('.track-name');
      let reading = title.querySelector('.art-diplomacy-reading');
      if (!reading) {
        reading = document.createElement('span');
        reading.className = 'art-diplomacy-reading';
        reading.setAttribute('aria-live', 'polite');
        title.append(reading);
      }
      const label = match?.firstElementChild?.textContent ?? '';
      const text = active ? `${active.textContent} · ${label}` : '未记录';
      if (reading.textContent !== text) reading.textContent = text;
    }
  }

  new MutationObserver(decorateDiplomacy).observe(diplomacyTracks, { childList: true, subtree: true, characterData: true });
  decorateDiplomacy();
}
