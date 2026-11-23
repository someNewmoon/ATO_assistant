(function () {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  // Match the silhouette of the settled D10 art with an unnumbered,
  // faceted body. The two finishes share the same geometry.
  const d10Facets = [
    ['50% 2%, 9% 28%, 20% 63%', '#f5e9d3, #bdafa1', '#829fae, #354e5e'],
    ['9% 28%, 3% 69%, 50% 98%, 20% 63%', '#d6cabc, #7d7d78', '#486271, #1a2935'],
    ['50% 2%, 91% 28%, 97% 69%, 50% 98%, 80% 63%', '#989e9d, #54616a', '#375462, #111e2a'],
    ['20% 63%, 80% 63%, 50% 98%', '#eee3cb, #8e9190', '#577182, #203846'],
    ['50% 2%, 80% 63%, 20% 63%', '#fffdf5, #d8cbb6 66%, #a8ada8', '#9cb6c0, #537485 62%, #293f4e'],
  ];

  function blankD10(face) {
    const node = document.createElement('span');
    node.className = face.className;
    const white = face.src.includes('/crit-');
    Object.assign(node.style, { display: 'block', position: 'relative', filter: 'drop-shadow(0 2px 1px #19243267)' });

    const shell = document.createElement('span');
    Object.assign(shell.style, {
      position: 'absolute', inset: '0',
      clipPath: 'polygon(50% 2%, 91% 28%, 97% 69%, 50% 98%, 3% 69%, 9% 28%)',
      background: white ? '#737a7a' : '#273e4c',
    });
    for (const [index, [points, ivory, steel]] of d10Facets.entries()) {
      const facet = document.createElement('span');
      Object.assign(facet.style, {
        position: 'absolute', inset: '1px',
        clipPath: `polygon(${points})`,
        background: `repeating-linear-gradient(${96 + index * 11}deg, #ffffff15 0 .65px, transparent .65px 2.2px), `
          + 'radial-gradient(ellipse at 28% 22%, #ffffff73, transparent 52%), '
          + `linear-gradient(143deg, ${white ? ivory : steel})`,
      });
      shell.append(facet);
    }
    node.append(shell);
    return { node };
  }

  function makePreview(face) {
    const value = Number(face.dataset.diceValue);
    if (!Number.isInteger(value)) return null;
    if (face.classList.contains('room-die-cube')) {
      const node = face.cloneNode(true);
      const front = node.querySelector('.room-die-pips');
      const ordinary = node.classList.contains('is-armor');
      const kind = ['red', 'black', 'white'].find(kind => node.classList.contains('is-' + kind));
      const same = index => kind && window.ATO_ROOM_DICE.faces[kind][index].join() === window.ATO_ROOM_DICE.faces[kind][value].join();
      return {
        node,
        values: Array.from({ length: 6 }, (_, index) => index + Number(ordinary)).filter(index => index !== value && !same(index)),
        show(index) {
          if (ordinary) front.innerHTML = window.ATO_ROOM_DICE.pipMarkup(index);
          else front.style.backgroundPosition = `${index % 3 * 50}% ${index < 3 ? 50 : 100}%`;
        },
      };
    }

    return blankD10(face);
  }

  function animateFace(face, preview, index) {
    const { node, values, show } = preview;
    const direction = index % 2 ? 1 : -1;
    const delay = Math.min(index * 28, 112);
    node.setAttribute('aria-hidden', 'true');
    node.removeAttribute('data-dice-value');
    node.removeAttribute('aria-label');
    node.dataset.dicePreview = '';
    if (values) show(values[index % values.length]);
    const control = face.closest('[data-select-die]');
    if (control) control.inert = true;
    face.replaceWith(node);
    const timers = values ? [86, 165, 252, 359].map((time, frame) =>
      setTimeout(() => show(values[(index + frame + 1) % values.length]), delay + time)) : [];
    const animation = node.animate([
      { transform: `perspective(240px) translate(${direction * 14}px, -18px) rotateX(-85deg) rotateZ(${direction * 55}deg) scale(.7)`, opacity: .3 },
      { transform: `perspective(240px) translateY(-10px) rotateX(230deg) rotateZ(${-direction * 24}deg) scale(.93)`, opacity: .74, offset: .42 },
      { transform: `perspective(240px) translateY(3px) rotateX(365deg) rotateZ(${direction * 6}deg) scale(1.08)`, opacity: 1, offset: .78 },
      { transform: 'perspective(240px) translateY(0) rotateX(360deg) rotateZ(0) scale(1)', opacity: 1 },
    ], { duration: 490, delay, easing: 'cubic-bezier(.2,.65,.32,1)', fill: 'backwards' });
    return {
      finished: animation.finished.catch(() => {}),
      reveal() {
        timers.forEach(clearTimeout);
        node.replaceWith(face);
        if (control) control.inert = false;
      },
    };
  }

  function celebrate(face) {
    const critical = face.closest('[data-motion-die]')?.querySelector('.room-critical-result');
    if (!critical?.animate || !face.isConnected) return;
    const timing = { duration: 550, easing: 'ease-out' };
    face.animate([
      { filter: 'drop-shadow(0 0 0 transparent)' },
      { filter: 'drop-shadow(0 0 12px #ffbb38)', offset: .32 },
      { filter: 'drop-shadow(0 0 0 transparent)' },
    ], timing);
    critical.animate([
      { transform: 'scale(.92)', opacity: .55 },
      { transform: 'scale(1.16)', opacity: 1, offset: .38 },
      { transform: 'scale(1)', opacity: 1 },
    ], timing);
  }

  const masks = new WeakMap();
  function hide(node) {
    let mask = masks.get(node);
    if (!mask) {
      mask = { count: 0, visibility: node.style.visibility, inert: node.inert };
      masks.set(node, mask);
      node.style.visibility = 'hidden';
      node.inert = true;
    }
    mask.count++;
    return () => {
      if (--mask.count) return;
      node.style.visibility = mask.visibility;
      node.inert = mask.inert;
      masks.delete(node);
    };
  }

  function play(faces, conceal = []) {
    if (document.hidden || reducedMotion?.matches) return Promise.resolve();
    const rolls = Array.from(faces).flatMap(face => {
      if (!face.animate || !face.getClientRects().length || face.dataset.dicePreview !== undefined) return [];
      const preview = makePreview(face);
      return preview ? [{ face, preview }] : [];
    });
    if (!rolls.length) return Promise.resolve();
    const show = [...new Set(conceal)].filter(Boolean).map(hide);
    const animations = rolls.map(({face, preview}, index) => animateFace(face, preview, index));
    return Promise.all(animations.map(animation => animation.finished)).finally(() => {
      animations.forEach(animation => animation.reveal());
      show.forEach(reveal => reveal());
      rolls.forEach(({face}) => celebrate(face));
    });
  }

  window.ATO_DICE_MOTION = { play };
})();
