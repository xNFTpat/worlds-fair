/* <still-wheel> · glass wheel picker (e.g. the price range). Native scroll-snap does the physics, so it is cheap and
   works with touch, trackpad, mouse wheel and keyboard. Values above and below the glass pill fade out.
   Markup:
     <still-wheel label="Price range" ref="150" value="152.4">
       <option value="148">148.00</option> <option value="152.4">152.40</option> …
     </still-wheel>
   Attributes: label (italic serif label in the pill), ref (reference value for the small % change; omit to hide it),
     value (selected option value). An <option data-sub="…"> overrides the % text for that row.
   Pool attributes (optional): strategy (spot | bid-ask | bid-ask-sol), price (current price), sets (high | low, default high),
     for (id of a <still-range-gauge> to preview: the wheel writes its value into that gauge's `sets` edge and its shape).
     SOL-only rule: with strategy="bid-ask-sol" the whole range sits below the current price, so tops above `price` are
     blocked (struck through, skipped) and the wheel settles back on the highest allowed value. With on-above="switch"
     a top above price is allowed instead: strategy flips to bid-ask, a note says so and still:strategy fires.
   API: el.value (get/set). Events: change { detail: { value, index } } when the wheel settles on a new value;
     still:strategy { detail: { strategy, reason } } when the SOL-only rule switches it to two-sided.
   States (data-state): idle | playing (being scrolled) | done | reduced-motion. Keyboard: ↑ ↓ PageUp PageDown Home End.
   Size: full width of its container, 300px tall by default (--w-h); rows 64px (--w-item). */
(() => {
  if (customElements.get('still-wheel')) return;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  class StillWheel extends HTMLElement {
    connectedCallback() {
      if (this._built) return; this._built = true;
      this._opts = [...this.querySelectorAll('option')].map(o => ({ v: o.value, t: o.textContent.trim(), sub: o.dataset.sub }));
      this.textContent = '';
      const list = document.createElement('ul'); list.className = 'w-list'; list.setAttribute('aria-hidden', 'true');
      this._opts.forEach(o => { const li = document.createElement('li'); li.className = 'w-item'; li.textContent = o.t; list.appendChild(li); });
      const pill = document.createElement('div'); pill.className = 'w-pill';
      pill.innerHTML = '<span class="w-label"></span><span class="w-val"></span><span class="w-chg"></span>';
      pill.querySelector('.w-label').textContent = this.getAttribute('label') || '';
      this.append(list, pill);
      const note = document.createElement('p'); note.className = 'w-note'; note.setAttribute('aria-live', 'polite');
      this.insertAdjacentElement('afterend', note); this._note = note;
      this._list = list; this._items = [...list.children]; this._pill = pill; this._markBlocked();
      this.tabIndex = 0; this.setAttribute('role', 'spinbutton');
      this.setAttribute('aria-label', this.getAttribute('label') || 'Value');
      this.setAttribute('aria-valuemin', 0); this.setAttribute('aria-valuemax', this._opts.length - 1);
      let i = this._opts.findIndex(o => o.v === this.getAttribute('value')); if (i < 0) i = Math.floor(this._opts.length / 2);
      this.dataset.state = reduce() ? 'reduced-motion' : 'idle';
      requestAnimationFrame(() => { i = this._guard(i); this._go(i, false); this._select(i, false); });
      let raf = 0, settle = 0;
      list.addEventListener('scroll', () => {
        if (!reduce()) this.dataset.state = 'playing';
        cancelAnimationFrame(raf); raf = requestAnimationFrame(() => this._select(this._near(), false));
        clearTimeout(settle); settle = setTimeout(() => { const n = this._guard(this._near()); if (n !== this._near()) this._go(n, true); this._select(n, true); this.dataset.state = reduce() ? 'reduced-motion' : 'done'; }, 120);
      }, { passive: true });
      this.addEventListener('keydown', e => {
        const k = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key];
        let n = k ? this._i + k : e.key === 'Home' ? 0 : e.key === 'End' ? this._opts.length - 1 : null;
        if (n === null) return; e.preventDefault();
        n = this._guard(Math.max(0, Math.min(this._opts.length - 1, n)), k ? Math.sign(k) : 0); this._go(n, true); this._select(n, true);
      });
      this._items.forEach((li, n) => li.addEventListener('click', () => this._go(n, true)));
    }
    get value() { return this._opts && this._opts[this._i] ? this._opts[this._i].v : this.getAttribute('value'); }
    set value(v) { const n = this._opts.findIndex(o => o.v === String(v)); if (n >= 0) { this._go(n, true); this._select(n, false); } }
    static get observedAttributes() { return ['strategy', 'price']; }
    attributeChangedCallback() { if (this._built) { this._markBlocked(); const n = this._guard(this._i ?? 0); if (n !== this._i) { this._go(n, true); this._select(n, true); } } }
    _soloSol() { return this.getAttribute('strategy') === 'bid-ask-sol' && (this.getAttribute('sets') || 'high') === 'high' && isFinite(parseFloat(this.getAttribute('price'))); }
    _blocked(n) { return this._soloSol() && this.getAttribute('on-above') !== 'switch' && parseFloat(this._opts[n].v) > parseFloat(this.getAttribute('price')); }
    _markBlocked() { this._items.forEach((li, n) => { const b = this._blocked(n); li.classList.toggle('is-blocked', b); li.title = b ? 'SOL-only ranges sit below the current price' : ''; }); }
    _guard(n, dir) { // never settle on a blocked value: move to the nearest allowed one (below price)
      if (!this._blocked(n)) return n;
      for (let k = n; k >= 0 && k < this._opts.length; k += (dir > 0 ? 1 : -1) || -1) if (!this._blocked(k)) { this._say('SOL-only ranges sit below the current price, so the top stops there.'); return k; }
      for (let k = 0; k < this._opts.length; k++) if (!this._blocked(k)) return k;
      return n;
    }
    _say(t) { if (this._note) this._note.textContent = t; }
    _h() { return this._items[0] ? this._items[0].offsetHeight : 64; }
    _near() { return Math.max(0, Math.min(this._opts.length - 1, Math.round(this._list.scrollTop / this._h()))); }
    _go(n, smooth) { this._list.scrollTo({ top: n * this._h(), behavior: smooth && !reduce() ? 'smooth' : 'auto' }); }
    _select(n, commit) {
      const o = this._opts[n]; if (!o) return;
      if (n !== this._i) {
        this._items.forEach((li, k) => li.classList.toggle('is-sel', k === n));
        this._pill.querySelector('.w-val').textContent = o.t;
        const chg = this._pill.querySelector('.w-chg'), ref = parseFloat(this.getAttribute('ref'));
        let txt = o.sub || '';
        if (!txt && isFinite(ref) && ref !== 0 && isFinite(parseFloat(o.v))) {
          const p = (parseFloat(o.v) - ref) / ref * 100; txt = (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(1) + '%';
          chg.dataset.dir = p > 0 ? 'up' : p < 0 ? 'down' : '';
        }
        chg.textContent = txt;
        this.setAttribute('aria-valuenow', n);
        this.setAttribute('aria-valuetext', `${o.t}${txt ? ', ' + txt.replace('−', 'minus ') : ''}`);
        this._i = n;
        this._dirty = true;
      }
      if (commit && this._dirty) {
        this._dirty = false; this.setAttribute('value', o.v);
        if (this._soloSol() && this.getAttribute('on-above') === 'switch' && parseFloat(o.v) > parseFloat(this.getAttribute('price'))) {
          this.setAttribute('strategy', 'bid-ask'); this._say('Top above the current price, so this is now a two-sided Bid-Ask.');
          this.dispatchEvent(new CustomEvent('still:strategy', { bubbles: true, detail: { strategy: 'bid-ask', reason: 'top-above-price' } }));
        } else if (!this._blocked(n) && this._note && !this._note.textContent.startsWith('Top above')) { /* keep any rule note visible */ }
        const g = this.getAttribute('for') && document.getElementById(this.getAttribute('for'));
        if (g) { g.setAttribute(this.getAttribute('sets') || 'high', o.v); if (this.getAttribute('strategy')) g.setAttribute('shape', this.getAttribute('strategy')); }
        this.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value: o.v, index: n } }));
      }
    }
  }
  customElements.define('still-wheel', StillWheel);

  /* <still-mini-chart shape="spot|bid-ask|bid-ask-sol" price low high> · a tiny pool for choice tiles, drawn the same way as
     <still-range-gauge>: the basin's depth shows where liquidity sits. Optional price/low/high place the drop
     (otherwise: centre for spot and two-sided, the top edge for SOL-only). Decorative (aria-hidden). 100 × 52px. */
  let mcid = 0;
  if (!customElements.get('still-mini-chart')) customElements.define('still-mini-chart', class extends HTMLElement {
    connectedCallback() {
      const P = window.StillPool || { DEPTH: { 'spot': () => .86, 'bid-ask': t => .38 + .62 * Math.pow(Math.abs(2 * t - 1), 1.8), 'bid-ask-sol': t => .24 + .76 * Math.pow(1 - t, 1.6) },
        ss: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); } };
      const shape = P.DEPTH[this.getAttribute('shape')] ? this.getAttribute('shape') : 'spot', W = 96, G = 16, D = 28, xl = 12, xh = 84, id = 'mc' + (++mcid);
      const lo = parseFloat(this.getAttribute('low')), hi = parseFloat(this.getAttribute('high')), pr = parseFloat(this.getAttribute('price'));
      let tp = isFinite(lo) && isFinite(hi) && isFinite(pr) && hi > lo ? (pr - lo) / (hi - lo) : shape === 'bid-ask-sol' ? 1 : .5;
      const xp = Math.max(4, Math.min(92, xl + tp * (xh - xl)));
      let f = ''; for (let i = 0; i <= 24; i++) { const t = i / 24, e = P.ss(0, .08, Math.min(t, 1 - t)); f += `L${(xl + t * (xh - xl)).toFixed(1)},${(G + D * P.DEPTH[shape](t) * e).toFixed(1)}`; }
      // the same depth gradient as the big pool: no outline, deeper reads darker
      this.innerHTML = `<svg viewBox="0 0 ${W} 48" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${G}" x2="0" y2="${G + D}"><stop class="gd0" offset="0"/><stop class="gd1" offset=".42"/><stop class="gd2" offset="1"/></linearGradient></defs>`
        + `<path d="M${xl},${G}${f}Z" fill="url(#${id})"/><path class="m-ground" d="M0,${G}H${xl}M${xh},${G}H${W}"/>`
        + `<circle class="m-drop" cx="${xp}" cy="${G}" r="3.5"/></svg>`;
    }
  });
})();
