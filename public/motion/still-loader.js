/* <still-loader> · a drop falls onto the horizon line and two rings spread out. Loops on the shared 2.5s tempo.
   States (data-state): idle | playing | done | reduced-motion
   API: el.start(), el.finish() -> Promise (the last ring settles into the half-ripple), el.reset()
   Attributes: label (accessible text, default "Loading"), autoplay (start on connect),
     statuses ("|"-separated quiet status lines; default "Reading fees|Pricing your way out|Checking the downside").
     The status line changes once per ripple, on the drop's contact. It is aria-hidden so screen readers only hear the label.
   Events: still:done */
(() => {
  if (customElements.get('still-loader')) return;
  const TEMPO = 2500;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // shared clock: every Still animation on the page starts on the same beat
  const phase = () => -(performance.now() % TEMPO) + 'ms';
  const SVG = `<svg viewBox="0 0 120 60" aria-hidden="true" focusable="false">
<defs><clipPath id="sl-above-ID"><rect x="-60" y="-60" width="240" height="96"/></clipPath>
<clipPath id="sl-below-ID"><rect x="-60" y="37" width="240" height="60"/></clipPath></defs>
<g clip-path="url(#sl-below-ID)"><ellipse class="sl-rf" cx="60" cy="37" rx="34" ry="34"/></g>
<g clip-path="url(#sl-above-ID)"><circle class="sl-ring sl-b" cx="60" cy="36" r="34"/><circle class="sl-ring sl-a" cx="60" cy="36" r="34"/></g>
<circle class="sl-drop" cx="60" cy="30" r="4.2"/>
<path class="sl-mark" fill="currentColor" d="M44,36 A16,16 0 0 1 76,36 H71.4 A11.4,11.4 0 0 0 48.6,36 Z"/>
<rect class="sl-line" x="8" y="35" width="104" height="2" rx="1"/>
</svg>`;
  let n = 0;
  class StillLoader extends HTMLElement {
    connectedCallback() {
      if (!this._built) {
        const id = 'i' + (++n);
        this.innerHTML = SVG.replace(/ID/g, id) + '<p class="sl-status" aria-hidden="true"></p>';
        this._status = this.lastElementChild;
        this.setAttribute('role', 'status');
        this.setAttribute('aria-live', 'polite');
        this.setAttribute('aria-label', this.getAttribute('label') || 'Loading');
        this._built = true;
        this._media = matchMedia('(prefers-reduced-motion: reduce)');
        this._preferenceChange = () => { if (this.getAttribute('aria-busy') === 'true') this.start(); };
        if (!this.dataset.state) this.dataset.state = 'idle';
      }
      this._media.addEventListener?.('change', this._preferenceChange);
      if (this.hasAttribute('autoplay')) this.start();
    }
    start() {
      this.setAttribute('aria-busy', 'true');
      if (reduce()) { this.dataset.state = 'reduced-motion'; this._statusStart(); return; }
      this.style.setProperty('--still-phase', phase());
      this.dataset.state = 'playing';
      this._statusStart();
    }
    _statusStart() {
      const lines = (this.getAttribute('statuses') || 'Reading fees|Pricing your way out|Checking the downside').split('|');
      let i = 0; this._status.textContent = lines[0];
      const next = () => {
        this._status.classList.add('is-out');
        this._swap = setTimeout(() => { i = (i + 1) % lines.length; this._status.textContent = lines[i]; this._status.classList.remove('is-out'); }, 300);
      };
      const toContact = (TEMPO - (performance.now() % TEMPO) + TEMPO * 0.24) % TEMPO || TEMPO;
      clearTimeout(this._t0); clearTimeout(this._swap); clearInterval(this._iv); this._status.classList.remove('is-out');
      this._t0 = setTimeout(() => { next(); this._iv = setInterval(next, TEMPO); }, toContact + TEMPO);
    }
    _statusStop() { clearTimeout(this._t0); clearTimeout(this._swap); clearInterval(this._iv); }
    disconnectedCallback() { this._statusStop(); this._media?.removeEventListener?.('change', this._preferenceChange); }
    finish() {
      this._statusStop(); this._status.classList.add('is-out');
      const mark = this.querySelector('.sl-mark');
      const done = () => { this.dataset.state = 'done'; this.removeAttribute('aria-busy'); this.dispatchEvent(new CustomEvent('still:done', { bubbles: true })); };
      if (this.dataset.state !== 'playing') { done(); return Promise.resolve(); }
      // freeze the loop where it is, fade the moving parts, let the ripple settle into the mark
      const moving = this.querySelectorAll('.sl-drop,.sl-ring,.sl-rf');
      const drop = this.querySelector('.sl-drop');
      moving.forEach(el => {
        const cs = getComputedStyle(el), o = cs.opacity, t = cs.transform;
        el.style.animation = 'none'; el.style.opacity = o; el.style.transform = t === 'none' ? '' : t;
        if (el === drop && +o > 0) // a drop still in the air lands first
          el.animate([{ transform: t === 'none' ? 'none' : t, opacity: o }, { transform: 'translateY(0) scale(.86,1.18)', opacity: 1, offset: .6 }, { transform: 'translateY(1px) scale(1.5,.4)', opacity: 0 }], { duration: 140, easing: 'cubic-bezier(.55,0,.9,.4)', fill: 'forwards' });
        else el.animate([{ opacity: o }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
      });
      // the last ripple spreads from the contact point and settles into the half-ripple
      const a = mark.animate(
        [{ opacity: 0, transform: 'scale(.25)', transformOrigin: '60px 36px' },
         { opacity: 1, transform: 'scale(1.08)', transformOrigin: '60px 36px', offset: .6 },
         { opacity: 1, transform: 'scale(1)', transformOrigin: '60px 36px' }],
        { duration: 220, delay: 60, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
      return a.finished.then(() => { moving.forEach(el => el.removeAttribute('style')); a.cancel(); done(); });
    }
    reset() { this._statusStop(); this._status.textContent = ''; this._status.classList.remove('is-out'); this.querySelectorAll('[style]').forEach(el => el.removeAttribute('style')); this.dataset.state = 'idle'; this.removeAttribute('aria-busy'); }
  }
  customElements.define('still-loader', StillLoader);
})();
