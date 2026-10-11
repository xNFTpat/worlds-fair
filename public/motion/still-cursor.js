/* One viewport overlay; a full cursor circle and one finite ring per mouse click. */
(() => {
  if (window.StillCursor) return;
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const coarse = matchMedia('(pointer: coarse)');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement, rings = new Map();
  const native = 'input,textarea,select,[contenteditable],[role="textbox"],button:disabled,[aria-disabled="true"]';
  let overlay = null, dot = null;
  const enabled = () => fine.matches && !coarse.matches;
  function clearRings() {
    for (const [ring, timer] of rings) { clearTimeout(timer); ring.remove(); }
    rings.clear();
  }
  function leave() { if (dot) dot.hidden = true; root.classList.remove('still-pointer-active'); }
  function promote() {
    // The top layer also sits above native dialogs and transformed/clipped cards.
    if (!overlay?.showPopover) return;
    try { overlay.hidePopover(); overlay.showPopover(); } catch { /* fixed overlay fallback */ }
  }
  function availability() {
    if (reduce.matches) clearRings();
    if (!enabled()) {
      leave(); clearRings(); overlay?.remove(); overlay = dot = null; return;
    }
    if (overlay) return;
    overlay = document.createElement('div'); overlay.className = 'still-pointer-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    if (overlay.showPopover) overlay.setAttribute('popover', 'manual');
    dot = document.createElement('span'); dot.className = 'still-pointer-dot'; dot.hidden = true;
    overlay.appendChild(dot); document.body.appendChild(overlay); promote();
  }
  function move(event) {
    if (!enabled() || event.pointerType !== 'mouse') { leave(); return; }
    if (!dot) availability();
    if (!dot || event.target?.closest?.(native)) { leave(); return; }
    dot.style.left = `${event.clientX}px`; dot.style.top = `${event.clientY}px`;
    dot.hidden = false; root.classList.add('still-pointer-active');
  }
  function click(event) {
    if (!enabled() || reduce.matches || event.button !== 0 || event.detail === 0 || event.pointerType && event.pointerType !== 'mouse') return;
    if (!overlay) availability();
    if (!overlay) return;
    promote(); move({...event, pointerType:'mouse', target:event.target, clientX:event.clientX, clientY:event.clientY});
    const ring = document.createElement('span'); ring.className = 'still-pointer-ring';
    ring.style.left = `${event.clientX}px`; ring.style.top = `${event.clientY}px`;
    overlay.appendChild(ring);
    const finish = () => { clearTimeout(rings.get(ring)); rings.delete(ring); ring.remove(); };
    ring.addEventListener('animationend', finish, {once:true});
    rings.set(ring, setTimeout(finish, 400));
  }
  document.addEventListener('pointermove', move, {passive:true});
  document.addEventListener('click', click, {capture:true, passive:true});
  document.addEventListener('pointerleave', leave);
  window.addEventListener('blur', leave);
  for (const media of [fine,coarse,reduce]) media.addEventListener('change', availability);
  window.addEventListener('pagehide', () => { leave(); clearRings(); });
  window.StillCursor = {installed:true};
  availability();
})();
