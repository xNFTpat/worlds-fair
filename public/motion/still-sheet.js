/* Still motion pack · native confirmation sheet. The app retains its existing
   confirm, retry and idempotency handlers; this helper only animates the dialog. */
(() => {
  if (window.StillSheet) return;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE = 'cubic-bezier(.16,1,.3,1)';
  const settle = animation => animation?.finished?.catch(() => {}) || Promise.resolve();
  const NS = 'http://www.w3.org/2000/svg';
  function wavePath(w, h, k, ph, A, o = 0) { // k: amplitude 0..1, ph: phase (radians), o: vertical offset
    let d = `M0,${(A * k * (1 + Math.sin(ph)) + o).toFixed(1)}`;
    for (let i = 1; i <= 24; i++) { const x = w * i / 24; d += ` L${x.toFixed(1)},${(A * k * (1 + Math.sin(ph + i / 24 * Math.PI * 3)) + o).toFixed(1)}`; }
    return d;
  }
  function wash(dlg, rising) {
    const r = dlg.getBoundingClientRect(), w = r.width, h = r.height, A = 22, N = 9, dur = rising ? 900 : 560;
    const ks = [], ls = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = rising ? t : 1 - t, k = u < .4 ? 1 : Math.pow(1 - (u - .4) / .6, 1.2), ph = u * Math.PI * 3;
      const top = wavePath(w, h, k, ph, A, 4), clip = wavePath(w, h, k, ph, A, -1);
      ks.push({ clipPath: `path('${clip} L${w},${h + 60} L0,${h + 60} Z')` });
      ls.push({ d: `path('${top}')` });
    }
    // soft glass wave line: a wide faint glow under a thin bright line, both tracing the same wave
    const svg = document.createElementNS(NS, 'svg'), glow = document.createElementNS(NS, 'path'), line = document.createElementNS(NS, 'path');
    svg.setAttribute('class', 'still-sheet__wave'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('viewBox', `0 0 ${w} ${A * 2 + 8}`);
    svg.setAttribute('width', w); svg.setAttribute('height', A * 2 + 8); glow.setAttribute('class', 'w-glow'); line.setAttribute('class', 'w-line');
    [glow, line].forEach(p => { p.setAttribute('d', ls[0].d.slice(6, -2)); svg.appendChild(p); }); dlg.appendChild(svg);
    dlg.classList.add('is-washing');
    const ease = rising ? 'cubic-bezier(.3,.55,.3,1)' : 'cubic-bezier(.5,0,.75,0)';
    const lift = dlg.animate(rising ? [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }] : [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], { duration: dur, easing: ease, fill: rising ? 'backwards' : 'forwards' });
    dlg.animate(ks, { duration: dur, easing: 'linear', fill: rising ? 'backwards' : 'forwards' });
    [glow, line].forEach(p => p.animate(ls, { duration: dur, easing: 'linear', fill: 'forwards' }));
    return lift;
  }
  function clearWash(dlg) { dlg.classList.remove('is-washing'); dlg.querySelectorAll('.still-sheet__wave').forEach(n => n.remove()); dlg.getAnimations().forEach(a => a.cancel()); }
  function open(dlg, opts = {}) {
    if (dlg.open) return Promise.resolve(dlg.returnValue);
    const rm = reduce();
    dlg.dataset.state = rm ? 'reduced-motion' : 'playing';
    dlg.showModal();
    if (opts.from && window.StillSplash) window.StillSplash.at(opts.from).catch(() => {});
    const inK = rm ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }];
    settle(!rm && !matchMedia('(prefers-reduced-transparency: reduce)').matches && dlg.getBoundingClientRect ? wash(dlg,true) : dlg.animate?.(inK, { duration: rm ? 0 : 460, easing: EASE, fill: 'backwards' })).then(() => {
      if (!dlg.open || closing) return;
      if(dlg.getBoundingClientRect)clearWash(dlg);
      dlg.dataset.state = rm ? 'reduced-motion' : 'done';
      dlg.dispatchEvent(new CustomEvent('still:done', { bubbles: true }));
    });
    let closing = false;
    return new Promise(resolve => {
      const realClose = dlg.close.bind(dlg);
      const canCancel = () => opts.canCancel?.() !== false;
      const onCancel = e => { e.preventDefault(); if (canCancel()) dlg.close('cancel'); };
      const onSubmit = e => { if (e.target.method !== 'dialog') return; e.preventDefault(); if (canCancel()) dlg.close(e.submitter?.value || 'cancel'); };
      dlg.addEventListener('cancel', onCancel);
      dlg.addEventListener('submit', onSubmit);
      dlg.close = value => {
        if (closing) return;
        closing = true;
        const quiet = reduce();
        const outK = quiet ? [{ opacity: 1 }, { opacity: 0 }] : [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }];
        settle(!quiet && !matchMedia('(prefers-reduced-transparency: reduce)').matches && dlg.getBoundingClientRect ? wash(dlg,false) : dlg.animate?.(outK, { duration: quiet ? 0 : 280, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })).then(() => {
          dlg.close = realClose;
          dlg.removeEventListener('cancel', onCancel);
          dlg.removeEventListener('submit', onSubmit);
          realClose(value);
          if(dlg.getBoundingClientRect)clearWash(dlg);
          dlg.getAnimations?.().forEach(animation => animation.cancel());
          dlg.dataset.state = 'idle'; resolve(dlg.returnValue);
        });
      };
    });
  }
  window.StillSheet = { open };
})();
