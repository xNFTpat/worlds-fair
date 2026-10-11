/* Still shell helpers: page wipe fallback and the rippling favicon.
   StillWipe.run(update) · in-page screen change: a body of water with a soft wavy leading edge flows across the screen,
     update() runs under it, and it flows on out (v5: always this overlay, so it looks the same in every browser).
     Cross-page navigation needs no JS: @view-transition in still-motion.css washes the new page in with the same edge.
     States on <html data-still-wipe>: idle | playing | done | reduced-motion
   StillFavicon.start() / .stop() · while Pre-flight runs, the tab icon cycles four ripple frames on the shared 2.5s tempo,
     then settles back to the normal icon. Off under reduced motion. */
(() => {
  if (window.StillWipe) return;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement, EASE = 'cubic-bezier(.16,1,.3,1)';
  root.dataset.stillWipe = 'idle';
  async function run(update) {
    const set = s => root.dataset.stillWipe = s;
    if (reduce()) { set('reduced-motion'); await update(); set('done'); return; }
    set('playing');
    const host = document.createElement('div'); host.className = 'still-wipe'; host.innerHTML = '<span></span>';
    document.body.appendChild(host); const s = host.firstChild;
    await s.animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(-6%)' }], { duration: 420, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' }).finished;
    await update();
    await s.animate([{ transform: 'translateX(-6%)' }, { transform: 'translateX(60%)' }], { duration: 520, easing: EASE, fill: 'forwards' }).finished;
    host.remove(); set('done');
  }
  window.StillWipe = { run };

  // ---- favicon ripple: 4 tiny frames of the arc mark on a Midnight tile, drawn as data-URI SVGs (no requests) ----
  const frame = (r, o) => 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0B1B2A"/>` +
    `<path d="M4.5 20.5H27.5" stroke="#46E8DA" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M${16 - r} 20.5a${r} ${r} 0 0 1 ${2 * r} 0" fill="none" stroke="#46E8DA" stroke-opacity="${o}" stroke-width="3"/></svg>`);
  const FRAMES = [frame(3, 1), frame(6, .9), frame(9, .7), frame(11, .35)];
  let timer = null, link = null, original = null;
  const StillFavicon = {
    start() {
      if (timer || reduce()) return;
      link = document.querySelector('link[rel="icon"][type="image/svg+xml"]') || document.querySelector('link[rel~="icon"]');
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      original = link.getAttribute('href'); let i = 0;
      timer = setInterval(() => { link.href = FRAMES[i++ % FRAMES.length]; }, 2500 / FRAMES.length);
    },
    stop() { clearInterval(timer); timer = null; if (link && original) link.href = original; }
  };
  window.StillFavicon = StillFavicon;
})();
