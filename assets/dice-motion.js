(function () {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function play(faces) {
    if (document.hidden || reducedMotion?.matches) return;
    Array.from(faces).forEach((face, index) => {
      if (!face.animate || !face.getClientRects().length) return;
      const direction = index % 2 ? 1 : -1;
      face.animate([
        { transform: `perspective(240px) translate(${direction * 14}px, -18px) rotateX(-85deg) rotateZ(${direction * 55}deg) scale(.7)`, opacity: .18 },
        { transform: `perspective(240px) translateY(-10px) rotateX(230deg) rotateZ(${-direction * 24}deg) scale(.93)`, opacity: .55, offset: .42 },
        { transform: `perspective(240px) translateY(3px) rotateX(365deg) rotateZ(${direction * 6}deg) scale(1.08)`, opacity: 1, offset: .78 },
        { transform: 'perspective(240px) translateY(0) rotateX(360deg) rotateZ(0) scale(1)', opacity: 1 },
      ], {
        duration: 490,
        delay: Math.min(index * 28, 112),
        easing: 'cubic-bezier(.2,.65,.32,1)',
        fill: 'backwards',
      });
    });
  }

  window.ATO_DICE_MOTION = { play };
})();
