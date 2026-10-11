/* StillSplash · a small, calm burst for "Open on paper": 7 drops thrown up in a low arc, falling back as one ring. 560ms.
   API: StillSplash.at(elementOrPoint) -> Promise. Point = { x, y } in viewport px. Fires still:done on document.
   States on <html data-still-splash>: idle | playing | done | reduced-motion (reduced motion = one soft ring fade, no particles). */
(() => {
  if (window.StillSplash) return;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // fixed, hand-tuned throw table (angle in degrees from vertical, speed in px): no randomness, the same splash every time
  const DROPS = [[-58, 70], [-34, 92], [-14, 104], [4, 98], [22, 108], [40, 88], [62, 66]];
  const DUR = 560, G = 1300; // ms, px/s²
  function point(t) { return t instanceof Element ? (r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))(t.getBoundingClientRect()) : t; }
  function at(target) {
    const p = point(target), root = document.documentElement;
    const host = document.createElement('div');
    host.className = 'still-splash'; host.setAttribute('aria-hidden', 'true');
    host.style.transform = `translate(${p.x}px,${p.y}px)`;
    const ring = document.createElement('b'); host.appendChild(ring);
    document.body.appendChild(host);
    const end = () => { host.remove(); root.dataset.stillSplash = 'done'; document.dispatchEvent(new CustomEvent('still:done', { detail: { source: 'splash' } })); };
    if (reduce()) {
      root.dataset.stillSplash = 'reduced-motion';
      return ring.animate([{ opacity: .5 }, { opacity: 0 }], { duration: 300, easing: 'ease-out' }).finished.then(end);
    }
    root.dataset.stillSplash = 'playing';
    const anims = DROPS.map(([deg, v]) => {
      const i = document.createElement('i'); host.appendChild(i);
      const a = deg * Math.PI / 180, vx = Math.sin(a) * v * 1.6, vy = -Math.cos(a) * v * 3.4, k = [];
      for (let s = 0; s <= 8; s++) {
        const t = s / 8 * (DUR / 1000);
        const x = vx * t, y = vy * t + 0.5 * G * t * t;
        k.push({ transform: `translate(${x.toFixed(1)}px,${Math.min(y, 0).toFixed(1)}px) scale(${(1 - s / 12).toFixed(2)})`, opacity: s < 6 ? 1 : (8 - s) / 3 });
      }
      return i.animate(k, { duration: DUR, easing: 'linear', fill: 'forwards' });
    });
    anims.push(ring.animate([
      { transform: 'scale(.2)', opacity: 0 }, { transform: 'scale(.6)', opacity: .9, offset: .45 }, { transform: 'scale(1.6)', opacity: 0 }
    ], { duration: DUR, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' }));
    return Promise.all(anims.map(a => a.finished)).then(end);
  }
  document.documentElement.dataset.stillSplash = 'idle';
  window.StillSplash = { at };
})();
