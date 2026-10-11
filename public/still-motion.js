// The motion budget is deliberately small. Numeric text is never interpolated.
let currentCleanup = null;
const seen = new WeakSet();
const motionAllowed = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function afterStillRender(root = globalThis.document) {
  if (!motionAllowed() || !root?.querySelectorAll) return;
  for (const chip of root.querySelectorAll('.check-chip,.overall-chip')) {
    if (!seen.has(chip)) {seen.add(chip); chip.classList.add('still-chip-settle');}
  }
  for (const number of root.querySelectorAll('[data-still-number]')) {
    const value = number.getAttribute('data-still-number');
    if (value === null || value.trim() === '' || !Number.isFinite(Number(value)) || number.classList.contains('unavailable') || seen.has(number)) continue;
    // Settle the real value already painted by the view. Never invent a start value.
    seen.add(number); number.classList.add('still-number-settle');
  }
}

export function initStillMotion() {
  if (currentCleanup) return currentCleanup;
  if (typeof window === 'undefined' || typeof document === 'undefined' || !window.matchMedia) return () => {};
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  let cursor = null, frame = 0, pulseTimer = 0, rippleTimer = 0, ripple = null;
  let x = 0, y = 0, eligible = false, action = false, disposed = false, loadPlayed = false;
  const nativeTargets = 'input,textarea,select,[contenteditable],[role="textbox"],dialog,button:disabled,[aria-disabled="true"]';
  const actionTargets = 'a[href],button:not(:disabled),summary,[role="button"],[tabindex]:not([tabindex="-1"])';

  function clearCursor() {
    document.documentElement.classList.remove('still-cursor-enabled');
    if (frame) window.cancelAnimationFrame(frame);
    if (pulseTimer) window.clearTimeout(pulseTimer);
    frame = 0; pulseTimer = 0; cursor?.remove(); cursor = null;
  }
  function paint() {
    frame = 0;
    if (!cursor || disposed) return;
    cursor.style.transform = `translate3d(${x}px,${y}px,0)`;
    cursor.classList.toggle('is-visible', eligible);
    cursor.classList.toggle('is-action', action);
    document.documentElement.classList.toggle('still-cursor-enabled', eligible);
  }
  function pointer(event) {
    if (event.pointerType && event.pointerType !== 'mouse') {leave(); return;}
    if (!cursor || reduce.matches || !fine.matches) return;
    x = event.clientX; y = event.clientY;
    eligible = !event.target?.closest?.(nativeTargets);
    action = eligible && !!event.target?.closest?.(actionTargets);
    if (!frame) frame = window.requestAnimationFrame(paint);
  }
  function leave() {
    eligible = false;
    cursor?.classList.remove('is-visible');
    document.documentElement.classList.remove('still-cursor-enabled');
  }
  function pulse(event) {
    if (!cursor || !eligible || reduce.matches || !fine.matches || event.button !== 0 || event.pointerType && event.pointerType !== 'mouse' || event.target?.closest?.(nativeTargets)) return;
    window.clearTimeout(pulseTimer);
    cursor.classList.remove('is-pulsing');
    void cursor.offsetWidth;
    cursor.classList.add('is-pulsing');
    pulseTimer = window.setTimeout(() => {cursor?.classList.remove('is-pulsing'); pulseTimer = 0;}, 420);
  }
  function availability() {
    if (reduce.matches) {
      loadPlayed = true;
      clearCursor(); ripple?.remove(); ripple = null;
      if (rippleTimer) window.clearTimeout(rippleTimer);
      document.querySelectorAll('.still-chip-settle,.still-number-settle').forEach(element => element.classList.remove('still-chip-settle','still-number-settle'));
      return;
    }
    if (fine.matches && !cursor) {
      cursor = document.createElement('span'); cursor.className = 'still-cursor'; cursor.setAttribute('aria-hidden','true'); document.body.append(cursor);
    } else if (!fine.matches) clearCursor();
    if (!loadPlayed) {
      loadPlayed = true;
      const home = document.getElementById('home');
      if (home && !home.hidden) {
        ripple = document.createElement('span'); ripple.className = 'still-load-ripple'; ripple.setAttribute('aria-hidden','true'); home.append(ripple);
        rippleTimer = window.setTimeout(() => {ripple?.remove(); ripple = null; rippleTimer = 0;}, 900);
      }
    }
  }
  document.addEventListener('pointermove',pointer,{passive:true});
  document.addEventListener('pointerdown',pulse,{passive:true});
  document.addEventListener('pointerleave',leave);
  window.addEventListener('blur',leave);
  reduce.addEventListener?.('change',availability); fine.addEventListener?.('change',availability);
  availability(); afterStillRender(document);
  currentCleanup = () => {
    disposed = true; clearCursor(); ripple?.remove(); if (rippleTimer) window.clearTimeout(rippleTimer);
    document.removeEventListener('pointermove',pointer); document.removeEventListener('pointerdown',pulse); document.removeEventListener('pointerleave',leave); window.removeEventListener('blur',leave);
    reduce.removeEventListener?.('change',availability); fine.removeEventListener?.('change',availability);
    currentCleanup = null;
  };
  return currentCleanup;
}
