/* StillTheme · time-of-day themes and the theme button. v6.
   Themes, in button order: Dawn → Noon → Dusk → Midnight → Dawn. Set as <html data-still-theme="…">.
   Start: the last choice the user made (localStorage "still-theme"); otherwise the theme for their local time:
     05:00–09:59 Dawn · 10:00–16:59 Noon · 17:00–20:59 Dusk · 21:00–04:59 Midnight.
   To avoid a flash, put the one-line starter from CODEX-NOTE-v6.md in <head> before the stylesheets; this file then takes over.
   Button markup (one small icon button in the top bar; this file fills the icon and the accessible label):
     <button class="still-theme-btn" type="button" data-still-theme-button></button>
   Each tap moves to the next theme and crossfades the page for 400ms (View Transitions). Under reduced motion, or where
   View Transitions don't exist, it swaps instantly.
   API: StillTheme.get() · StillTheme.set(name, { animate }) · StillTheme.next() · StillTheme.list
   Event: still:theme { theme } on document. Also keeps <meta name="theme-color"> in step and pauses all animation
   while the tab is hidden (html[data-still-hidden]). */
(() => {
  if (window.StillTheme) return;
  const root = document.documentElement, KEY = 'still-theme';
  const LIST = ['dawn', 'noon', 'dusk', 'midnight'];
  const NAME = { dawn: 'Dawn', noon: 'Noon', dusk: 'Dusk', midnight: 'Midnight' };
  const ICON = { // Lucide: sunrise, sun, sunset, moon
    dawn: '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
    noon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    dusk: '<path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
    midnight: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'
  };
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const byClock = (h = new Date().getHours()) => h >= 5 && h < 10 ? 'dawn' : h >= 10 && h < 17 ? 'noon' : h >= 17 && h < 21 ? 'dusk' : 'midnight';
  const stored = () => { try { const v = localStorage.getItem(KEY); return LIST.includes(v) ? v : null; } catch (e) { return null; } };
  const get = () => LIST.includes(root.dataset.stillTheme) ? root.dataset.stillTheme : 'midnight';
  function paint() {
    const t = get();
    document.querySelectorAll('[data-still-theme-button]').forEach(b => {
      b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[t]}</svg>`;
      const nx = LIST[(LIST.indexOf(t) + 1) % LIST.length];
      b.setAttribute('aria-label', `Theme: ${NAME[t]}. Switch to ${NAME[nx]}`); b.title = `Theme: ${NAME[t]}`;
    });
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = getComputedStyle(root).getPropertyValue('--still-meta').trim() || m.content;
  }
  function apply(t) { root.dataset.stillTheme = t; paint(); document.dispatchEvent(new CustomEvent('still:theme', { detail: { theme: t } })); }
  function set(t, { animate = true, remember = true } = {}) {
    if (!LIST.includes(t)) return;
    if (remember) { try { localStorage.setItem(KEY, t); } catch (e) { /* private mode: still works for this visit */ } }
    if (!animate || reduce() || !document.startViewTransition) return apply(t);
    root.classList.add('still-theming');
    const vt = document.startViewTransition(() => apply(t));
    vt.finished.finally(() => root.classList.remove('still-theming'));
  }
  const next = () => set(LIST[(LIST.indexOf(get()) + 1) % LIST.length]);
  if (!root.dataset.stillTheme) root.dataset.stillTheme = stored() || byClock();
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-still-theme-button]'); if (b) next(); });
  document.addEventListener('visibilitychange', () => root.toggleAttribute('data-still-hidden', document.hidden));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint); else paint();
  window.StillTheme = { get, set, next, list: LIST.slice(), byClock };
})();
