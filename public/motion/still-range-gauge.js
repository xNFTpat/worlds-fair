/* <still-range-gauge price="…" low="…" high="…"> · the price is a drop on the horizon line, the range is a half-ring.
   Range states (data-range): in | above | below | unavailable
     in     "In range"           drop inside the ring, Deep water ring, slight breathing on the shared 2.5s tempo
     above  "Price above range"  drop right of the ring (a SOL-only Bid-Ask the price rose past sits unfilled), dashed Slate ring
     below  "Price below range"  drop left of the ring, Ochre (Caution) ring, chevron if the price runs off the scale
   Edges are inclusive: price === high is In range (a new SOL-only Bid-Ask opens there).
   Missing or non-numeric price/low/high renders "Unavailable", never a dash or 0.
   Motion states (data-state): idle | playing | done | reduced-motion
     playing = breathing (in range only) · done = settled, not breathing · the gauge only moves noticeably when the
     state changes: one ring spreads from the drop and still:change fires with { detail: { range } }.
   Optional attributes: unit (e.g. "USDC"), decimals (default auto). Size: fluid 240–640px wide, 84px graphic + 20px header. */
(() => {
  if (customElements.get('still-range-gauge')) return;
  const TEMPO = 2500, NS = 'http://www.w3.org/2000/svg';
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LABEL = { in: 'In range', above: 'Price above range', below: 'Price below range', unavailable: 'Unavailable' };
  const num = v => (v === null || String(v).trim() === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  const fmt = (v, d) => Math.abs(v)>0 && Math.abs(v)<0.000001 ? v.toExponential(2) : v.toLocaleString('en-GB', { maximumFractionDigits: d ?? (Math.abs(v) >= 100 ? 2 : Math.abs(v) >= 1 ? 4 : 6) });
  class StillRangeGauge extends HTMLElement {
    static get observedAttributes() { return ['price', 'low', 'high', 'unit', 'decimals']; }
    connectedCallback() {
      if (!this._built) {
        this.innerHTML = `<div class="g-head"><span class="g-state"></span><span class="g-price"></span></div>
<svg viewBox="0 0 600 84" preserveAspectRatio="none" aria-hidden="true" focusable="false">
<g class="g-breathe"><path class="g-ring"/></g><path class="g-pulse"/>
<line class="g-line" x1="0" y1="60" x2="600" y2="60"/>
<path class="g-chev" d=""/>
<circle class="g-drop" cx="0" cy="53" r="7"/>
<text class="g-tick g-lo" y="82" text-anchor="middle"></text><text class="g-tick g-hi" y="82" text-anchor="middle"></text>
</svg>`;
        this.setAttribute('role', 'img');
        this._built = true;
        this._ro = new ResizeObserver(() => this._draw(false));
        this._media = matchMedia('(prefers-reduced-motion: reduce)');
        this._preferenceChange = () => this._draw(false);
      }
      this._ro.observe(this); this._media.addEventListener?.('change', this._preferenceChange);
      this.style.setProperty('--still-phase', -(performance.now() % TEMPO) + 'ms');
      this._draw(false);
    }
    disconnectedCallback() { this._ro?.disconnect(); this._media?.removeEventListener?.('change', this._preferenceChange); }
    attributeChangedCallback() { if (this._built) this._draw(true); }
    _draw(animate) {
      const W = 600, svg = this.querySelector('svg'), q = s => this.querySelector(s);
      // keep the drawing undistorted: viewBox width follows the element's real width
      const px = Math.max(240, Math.min(640, this.clientWidth || 480)); svg.setAttribute('viewBox', `0 0 ${px} 84`);
      q('.g-line').setAttribute('x2', px);
      const price = num(this.getAttribute('price')), low = num(this.getAttribute('low')), high = num(this.getAttribute('high'));
      const digits = num(this.getAttribute('decimals'));
      const d = digits === null ? undefined : Math.max(0, Math.min(12, Math.trunc(digits))), unit = this.getAttribute('unit') || '';
      const prev = this.dataset.range;
      let range;
      if (price === null || low === null || high === null || high <= low) range = 'unavailable';
      else range = price > high ? 'above' : price < low ? 'below' : 'in';
      this.dataset.range = range;
      q('.g-state').textContent = LABEL[range];
      if (range === 'unavailable') {
        q('.g-price').textContent = '';
        ['.g-ring', '.g-chev', '.g-pulse'].forEach(s => q(s).setAttribute('d', ''));
        q('.g-drop').style.display = 'none'; q('.g-lo').textContent = q('.g-hi').textContent = '';
        this.setAttribute('aria-label', 'Range gauge: Unavailable');
        this.dataset.state = reduce() ? 'reduced-motion' : 'idle'; return;
      }
      q('.g-drop').style.display = '';
      // scale: the range sits in the middle half; anything beyond the padded scale pins to the edge with a chevron
      const span = high - low, lo = low - span * 0.75, hi = high + span * 0.75, pad = 16;
      const X = v => pad + (v - lo) / (hi - lo) * (px - 2 * pad);
      const xl = X(low), xh = X(high), r = (xh - xl) / 2, cx = (xl + xh) / 2, ry = Math.min(r, 44);
      q('.g-ring').setAttribute('d', `M${xl},60 A${r},${ry} 0 0 1 ${xh},60`);
      const off = price < lo ? -1 : price > hi ? 1 : 0;
      const xp = off < 0 ? pad + 20 : off > 0 ? px - pad - 20 : X(price);
      q('.g-drop').style.transform = `translateX(${xp.toFixed(1)}px)`;
      q('.g-chev').setAttribute('d', off < 0 ? `M${pad + 4},47 l-6,6 l6,6` : off > 0 ? `M${px - pad - 4},47 l6,6 l-6,6` : '');
      q('.g-lo').setAttribute('x', xl); q('.g-hi').setAttribute('x', xh);
      q('.g-lo').textContent = fmt(low, d); q('.g-hi').textContent = fmt(high, d);
      q('.g-price').textContent = `Price ${fmt(price, d)}${unit ? ' ' + unit : ''}`;
      this.setAttribute('aria-label', `${LABEL[range]}. Price ${fmt(price, d)}, range ${fmt(low, d)} to ${fmt(high, d)}${unit ? ' ' + unit : ''}.`);
      const rm = reduce();
      this.dataset.state = rm ? 'reduced-motion' : range === 'in' ? 'playing' : 'done';
      // ripple only on change
      if (animate && prev && prev !== range && prev !== 'unavailable') {
        this.dispatchEvent(new CustomEvent('still:change', { bubbles: true, detail: { range } }));
        if (!rm) {
          const p = q('.g-pulse'); p.setAttribute('d', `M${xp - 10},60 A10,10 0 0 1 ${xp + 10},60`);
          p.animate([{ opacity: .9, transform: 'scale(.6)' }, { opacity: 0, transform: 'scale(4)' }], { duration: 900, easing: 'cubic-bezier(.16,1,.3,1)' });
        }
      }
    }
  }
  customElements.define('still-range-gauge', StillRangeGauge);
})();
