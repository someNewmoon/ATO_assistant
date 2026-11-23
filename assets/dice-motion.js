(function () {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  // A pentagonal trapezohedron has two poles and a ring of ten alternating
  // vertices. Each kite joins one pole to three vertices on the ring.
  const fullTurn = 2 * Math.PI;
  const slope = 1.1 * (1 - Math.cos(Math.PI / 5)) / (1 + Math.cos(Math.PI / 5));
  const d10Vertices = Array.from({ length: 10 }, (_, index) => {
    const angle = index * fullTurn / 10;
    return [Math.cos(angle), Math.sin(angle), index % 2 ? -slope : slope];
  }).concat([[0, 0, 1.1], [0, 0, -1.1]]);
  const d10Faces = Array.from({ length: 10 }, (_, index) => {
    const prior = (index + 9) % 10, next = (index + 1) % 10;
    return index % 2 ? [10, prior, index, next] : [11, next, index, prior];
  });

  function blankD10(face) {
    const node = document.createElement('canvas');
    node.className = face.className;
    const { width, height } = face.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    node.width = Math.ceil(width * scale);
    node.height = Math.ceil(height * scale);
    const context = node.getContext('2d');
    if (!context) return null;
    context.scale(scale, scale);
    node.style.filter = 'drop-shadow(0 2px 1px #19243267)';
    const ivory = face.src.includes('/crit-');
    const pigment = ivory ? [240, 228, 207] : [107, 145, 163];
    const tint = light => `rgb(${pigment.map(channel => Math.min(255, Math.round(channel * light))).join(',')})`;
    const radius = Math.min(width, height) * .39;
    const camera = 5;

    function draw(progress, index) {
      const direction = index % 2 ? -1 : 1;
      const eased = 1 - (1 - progress) ** 1.75;
      const pitch = .55 + fullTurn * 1.28 * eased;
      const yaw = -.45 + direction * fullTurn * .67 * eased;
      const bank = -.15 + direction * (eased * 1.15 + index * .2);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cb = Math.cos(bank), sb = Math.sin(bank);
      const vertices = d10Vertices.map(([x, y, z]) => {
        const v = y * cp - z * sp, w = y * sp + z * cp;
        const u = x * cy + w * sy;
        return [u * cb - v * sb, u * sb + v * cb, w * cy - x * sy];
      });
      const project = ([x, y, z]) => {
        const size = radius * camera / (camera - z);
        return [width / 2 + x * size, height / 2 - y * size];
      };

      context.clearRect(0, 0, width, height);
      for (const face of d10Faces) {
        const [a, b, c] = face.map(vertex => vertices[vertex]);
        const [ux, uy, uz] = b.map((value, axis) => value - a[axis]);
        const [vx, vy, vz] = c.map((value, axis) => value - a[axis]);
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nx * -a[0] + ny * -a[1] + nz * (camera - a[2]) <= 0) continue;
        const light = Math.max(0, (-nx * .35 + ny * .56 + nz * .75) / Math.hypot(nx, ny, nz));
        const tone = .48 + light * .61;
        const [top, left, tip, right] = face.map(vertex => project(vertices[vertex]));
        const gradient = context.createLinearGradient(...top, ...tip);
        gradient.addColorStop(0, tint(tone * 1.19));
        gradient.addColorStop(1, tint(tone * .87));
        context.beginPath();
        context.moveTo(...top);
        [left, tip, right].forEach(point => context.lineTo(...point));
        context.closePath();
        context.fillStyle = gradient;
        context.fill();
        context.strokeStyle = tint(tone * .8);
        context.lineWidth = .7;
        context.stroke();

        // Pull the grain along the face as it turns in space.
        context.beginPath();
        for (let row = 1; row < 8; row++) {
          const t = row / 8;
          context.moveTo(top[0] + (left[0] - top[0]) * t, top[1] + (left[1] - top[1]) * t);
          context.lineTo(right[0] + (tip[0] - right[0]) * t, right[1] + (tip[1] - right[1]) * t);
        }
        context.strokeStyle = 'rgba(255,255,255,.11)';
        context.lineWidth = .45;
        context.stroke();
      }
    }

    return { node, draw };
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
    const { node, values, show, draw } = preview;
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
    const tumble = [
      { transform: `perspective(240px) translate(${direction * 14}px, -18px) rotateX(-85deg) rotateZ(${direction * 55}deg) scale(.7)`, opacity: .3 },
      { transform: `perspective(240px) translateY(-10px) rotateX(230deg) rotateZ(${-direction * 24}deg) scale(.93)`, opacity: .74, offset: .42 },
      { transform: `perspective(240px) translateY(3px) rotateX(365deg) rotateZ(${direction * 6}deg) scale(1.08)`, opacity: 1, offset: .78 },
      { transform: 'perspective(240px) translateY(0) rotateX(360deg) rotateZ(0) scale(1)', opacity: 1 },
    ];
    const bounce = [
      { transform: `translate(${direction * 12}px, -14px) scale(.78)` },
      { transform: 'translateY(-9px) scale(.94)', offset: .42 },
      { transform: 'translateY(3px) scale(1.04)', offset: .81 },
      { transform: 'translateY(0) scale(1)' },
    ];
    const duration = draw ? 620 : 490;
    const animation = node.animate(draw ? bounce : tumble, { duration, delay, easing: 'cubic-bezier(.2,.65,.32,1)', fill: 'backwards' });
    let frame;
    if (draw) {
      const paint = () => {
        if (!node.isConnected) return;
        const progress = Math.min(1, Math.max(0, ((animation.currentTime || 0) - delay) / duration));
        draw(progress, index);
        if (progress < 1) frame = requestAnimationFrame(paint);
      };
      paint();
    }

    return {
      finished: animation.finished.catch(() => {}),
      reveal() {
        if (frame !== undefined) cancelAnimationFrame(frame);
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
