/* Still shell helpers: page wipe fallback and the rippling favicon.
   StillWipe.run(update) · in-page (same-document) water-wipe around a DOM update. Uses View Transitions when the browser has
     them (the CSS in still-motion.css does the wipe); otherwise a cream panel with the horizon line crosses the screen and
     update() runs under it. Cross-page navigation needs no JS: @view-transition in still-motion.css handles it.
     States on <html data-still-wipe>: idle | playing | done | reduced-motion
   StillFavicon.start() / .stop() · while Pre-flight runs, the tab icon cycles four ripple frames on the shared 2.5s tempo,
     then settles back to the normal icon. Off under reduced motion. */
(() => {
  if (window.StillWipe) return;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement, EASE = 'cubic-bezier(.16,1,.3,1)';
  root.dataset.stillWipe = 'idle';
  let activeWipe = false;
  async function run(update) {
    const set = s => root.dataset.stillWipe = s;
    if (reduce()) { set('reduced-motion'); await update(); return; }
    if (activeWipe) { await update(); return; }
    activeWipe = true; set('playing');
    let host = null, updated = false;
    const apply = async () => { if (updated) return; updated = true; await update(); };
    try {
      if (document.startViewTransition) { await document.startViewTransition(apply).finished; return; }
      host = document.createElement('div'); host.className = 'still-wipe'; host.innerHTML = '<span></span>';
      document.body.appendChild(host); const s = host.firstChild;
      await s.animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(0)' }], { duration: 260, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'forwards' }).finished;
      await apply();
      await s.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], { duration: 320, easing: EASE, fill: 'forwards' }).finished;
    } catch { await apply(); }
    finally { host?.remove(); activeWipe = false; set(reduce() ? 'reduced-motion' : 'done'); }
  }
  window.StillWipe = { run };

  // ---- favicon ripple: 4 tiny frames, cream mark on Deep water, drawn as data-URI SVGs (no requests) ----
  const frame = (r, o) => 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#2F6F73"/>` +
    `<path d="M5,19H27V22H5Z" fill="#F3F0E5"/>` +
    `<path d="M${16 - r},19A${r},${r} 0 0 1 ${16 + r},19" fill="none" stroke="#F3F0E5" stroke-opacity="${o}" stroke-width="3"/></svg>`);
  const FRAMES = [frame(3, 1), frame(6, .9), frame(9, .7), frame(12, .35)];
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
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', event => { if (event.matches) StillFavicon.stop(); });
  window.addEventListener('pagehide', () => StillFavicon.stop());
})();
