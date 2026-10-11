/* Still motion pack · native confirmation sheet. The app retains its existing
   confirm, retry and idempotency handlers; this helper only animates the dialog. */
(() => {
  if (window.StillSheet) return;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE = 'cubic-bezier(.16,1,.3,1)';
  const settle = animation => animation?.finished?.catch(() => {}) || Promise.resolve();
  function open(dlg, opts = {}) {
    if (dlg.open) return Promise.resolve(dlg.returnValue);
    const rm = reduce();
    dlg.dataset.state = rm ? 'reduced-motion' : 'playing';
    dlg.showModal();
    if (opts.from && window.StillSplash) window.StillSplash.at(opts.from).catch(() => {});
    const inK = rm ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }];
    settle(dlg.animate?.(inK, { duration: rm ? 160 : 460, delay: rm ? 0 : 80, easing: EASE, fill: 'backwards' })).then(() => {
      if (!dlg.open || closing) return;
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
        settle(dlg.animate?.(outK, { duration: quiet ? 120 : 280, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })).then(() => {
          dlg.close = realClose;
          dlg.removeEventListener('cancel', onCancel);
          dlg.removeEventListener('submit', onSubmit);
          realClose(value);
          dlg.getAnimations?.().forEach(animation => animation.cancel());
          dlg.dataset.state = 'idle'; resolve(dlg.returnValue);
        });
      };
    });
  }
  window.StillSheet = { open };
})();
