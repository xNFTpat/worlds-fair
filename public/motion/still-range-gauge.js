/* <still-range-gauge> · the range as a pool of deep water cut into the horizon line (the hero of Still). v6.
   Attributes (all live):
     price, low, high   numbers. Missing or non-numeric -> "Unavailable" (flat ground, no water).
     shape              spot (even depth) | bid-ask (two-sided: deepest at both edges) | bid-ask-sol (SOL-only: deepest at the
                        low end). The water is one vertical depth gradient, so the deepest bins are the darkest.
     fee-rate           the POOL's yearly fee rate in % (a pool-wide average from the data, never the user's return).
                        Shown as "Pool fees: 85% a year (pool average)". Ripple period = clamp(2.5s × √(100 / fee-rate), 0.9s, 8s).
                        Missing -> still water and "Pool fees: Unavailable". Never invent a value.
     unit, decimals     formatting.
     editable           the pool edges become handles you drag (or move with arrow keys when focused).
     bin-step           v6: the pool's DLMM bin step in basis points (e.g. 10). With it, edges snap to real bins and the
                        readout shows the bin price. Without it, edges move by `step` and the readout says the bin step is unavailable.
     active-bin-price   v6: the active bin's exact price, the anchor for the bin grid. Bin k sits at active-bin-price × (1 + bin-step/10000)^k.
                        If missing, `price` is used as the anchor (exact when `price` is the pool's active-bin price, as Meteora reports it).
     step               price step when there is no bin-step (default: 1/100 of the visible scale). PageUp/PageDown = 10 steps or bins.
     min, max           fix the visible price scale (default: worked out once from price/low/high, then held while editing).
     on-above="switch"  SOL-only rule: for shape="bid-ask-sol" the top edge stops at the current price. With on-above="switch"
                        dragging it above price turns the shape two-sided ("bid-ask"), says so on screen and fires still:strategy.
     compact            small version for position lists (no footer, shallower pool).
     primary            v6: this gauge's price is the screen's one live number, shown in the live colour. Put it on one gauge per screen.
   Range states (data-range) and labels: in "In range" · above "Price above range" · below "Price below range" · unavailable "Unavailable".
   Motion states (data-state): playing | done | idle | reduced-motion. data-fees: known | unknown. data-paused while off-screen.
   Events: still:change { range } · still:range { low, high, edge, final, lowBin, highBin } (bins relative to the active bin, null
     without bin-step) · still:strategy { strategy: 'bid-ask', reason: 'top-above-price' }.
   The price ticks to its new value when it changes (480ms, ease-out, no overshoot); under reduced motion it swaps. */
(() => {
  if (customElements.get('still-range-gauge')) return;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LABEL = { in: 'In range', above: 'Price above range', below: 'Price below range', unavailable: 'Unavailable' };
  const num = v => (v === null || String(v).trim() === '' || !isFinite(+v)) ? null : +v;
  const fmt = (v, d) => v.toLocaleString('en-GB', d !== undefined ? { maximumFractionDigits: Math.max(0,Math.min(20,Number.isFinite(d)?d:4)) } : Math.abs(v) >= 1 ? { maximumFractionDigits: Math.abs(v) >= 100 ? 2 : 4 } : { maximumSignificantDigits: 4 });
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const DEPTH = { 'curve': t => .3 + .7 * Math.pow(1-Math.abs(2*t-1),1.8), 'spot': t => .86, 'bid-ask': t => .38 + .62 * Math.pow(Math.abs(2 * t - 1), 1.8), 'bid-ask-sol': t => .24 + .76 * Math.pow(1 - t, 1.6) };
  window.StillPool = { DEPTH, ss };
  const NOTE_STOP = 'SOL-only ranges sit below the current price, so the top edge stops there.';
  const NOTE_SWITCH = 'The top is above the current price, so this is now a two-sided Bid-Ask.';
  // pause the caustic light and ripples while a gauge is off-screen
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => e.target.toggleAttribute('data-paused', !e.isIntersecting))) : null;
  // caustic light: a few soft bright lines in a 96px tile, drifting slowly
  const CAUS = '<path d="M0 6C12 1 20 11 34 6S58 1 70 7 88 3 96 6"/><path d="M0 17C10 12 26 22 40 16S62 11 76 18 90 14 96 17"/><path d="M8 11c6-3 10 2 16 0M52 12c5-3 11 2 17-1M30 22c5-2 9 1 14-1"/>';
  let uid = 0;
  class StillRangeGauge extends HTMLElement {
    static get observedAttributes() { return ['price', 'low', 'high', 'shape', 'fee-rate', 'unit', 'decimals', 'editable', 'min', 'max', 'compact', 'bin-step', 'active-bin-price']; }
    connectedCallback() {
      if (!this._built) {
        const id = this._id = 'g' + (++uid);
        const handle = e => `<g class="g-handle" data-edge="${e}" tabindex="-1" role="slider" aria-label="Range ${e === 'low' ? 'bottom' : 'top'}" style="display:none">
<rect class="h-hit" x="-22" y="0" width="44" height="100"/><circle class="h-ring" r="11"/><line class="h-stem"/><circle class="h-knob" r="5"/></g>`;
        const rip = s => `<path class="g-rip${s ? ' g-rip--sol' : ''}"${s ? ` stroke="url(#${id}s)"` : ''}/>`;
        this.innerHTML = `<div class="g-head"><span class="g-state"></span><span class="g-price"></span></div>
<svg focusable="false">
<defs><linearGradient id="${id}d" gradientUnits="userSpaceOnUse" x1="0" x2="0"><stop class="gd0" offset="0"/><stop class="gd1" offset=".42"/><stop class="gd2" offset="1"/></linearGradient>
<linearGradient id="${id}h" x1="0" x2="1"><stop class="gh" offset="0" stop-opacity="0"/><stop class="gh" offset=".5" stop-opacity=".9"/><stop class="gh" offset="1" stop-opacity="0"/></linearGradient>
<linearGradient id="${id}s" x1="0" x2="1"><stop offset="0" stop-color="#9945FF"/><stop offset="1" stop-color="#14F195"/></linearGradient>
<linearGradient id="${id}f" gradientUnits="userSpaceOnUse" x1="0" x2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<pattern id="${id}p" width="96" height="24" patternUnits="userSpaceOnUse"><g fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round">${CAUS}</g></pattern>
<clipPath id="${id}c"><path class="g-clip"/></clipPath><mask id="${id}m"><rect class="g-fade" x="0" width="2000" fill="url(#${id}f)"/></mask></defs>
<path class="g-water" fill="url(#${id}d)"/>
<g class="g-caus" clip-path="url(#${id}c)" mask="url(#${id}m)"><rect class="g-caus-a" x="0" width="2000" fill="url(#${id}p)"/><g transform="scale(1 -1)"><rect class="g-caus-b" x="0" width="2000" fill="url(#${id}p)"/></g></g>
<path class="g-floor"/><path class="g-ground"/><line class="g-surface" stroke="url(#${id}h)"/>
${rip(1)}${rip(0)}${rip(0)}<path class="g-pulse"/><path class="g-chev"/><circle class="g-drop" cx="0" r="4.5"/>
<text class="g-tick g-lo" text-anchor="middle" aria-hidden="true"></text><text class="g-tick g-hi" text-anchor="middle" aria-hidden="true"></text>
${handle('low')}${handle('high')}
</svg><span class="g-read" aria-hidden="true"></span><p class="g-note" aria-live="polite"></p><div class="g-foot"><span class="g-fee"></span><span class="g-shape"></span></div>`;
        this.setAttribute('role', 'group'); this._built = true;
        this._svg = this.querySelector('svg');
        this._ro = new ResizeObserver(() => this._draw(false));
        this.querySelectorAll('.g-handle').forEach(h => this._bindHandle(h));
      }
      this._ro.observe(this);
      io && io.observe(this);
      this._draw(false);
    }
    disconnectedCallback() { cancelAnimationFrame(this._raf); clearTimeout(this._rt); this._ro && this._ro.disconnect(); io && io.unobserve(this); }
    attributeChangedCallback(n, o, v) {
      if (n === 'min' || n === 'max' || n === 'editable') this._dom = null;
      if (this._built) this._draw(true, n === 'price' ? num(o) : undefined);
    }
    // ---- bins ----
    _bins() { const bs = num(this.getAttribute('bin-step')), a = num(this.getAttribute('active-bin-price')) ?? num(this.getAttribute('price')); return bs > 0 && a > 0 ? { bs, a, r: 1 + bs / 10000 } : null; }
    _binOf(v, b) { return Math.round(Math.log(v / b.a) / Math.log(b.r)); }
    _binPrice(k, b) { return b.a * Math.pow(b.r, k); }
    // ---- editing ----
    _bindHandle(h) {
      const edge = h.dataset.edge;
      // the hit area takes the touch; only while a handle is held does the page stop scrolling
      h.addEventListener('touchstart', e => { if (this.hasAttribute('editable')) e.preventDefault(); }, { passive: false });
      h.addEventListener('pointerdown', e => {
        if (!this.hasAttribute('editable')) return;
        e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add('is-drag'); h.focus({ preventScroll: true }); this._read(edge, true);
        const move = ev => { const r = this._svg.getBoundingClientRect(); this._setEdge(edge, this._inv(ev.clientX - r.left), false); };
        const up = () => { h.classList.remove('is-drag'); this._read(edge, false); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); this._emit(edge, true); };
        h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
      });
      h.addEventListener('keydown', e => {
        if (!this.hasAttribute('editable')) return;
        const k = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
        const cur = num(this.getAttribute(edge)), b = this._bins();
        let v = null;
        if (k && cur !== null) v = b ? this._binPrice(this._binOf(cur, b) + k, b) : cur + k * this._step();
        else if (e.key === 'Home') v = -Infinity; else if (e.key === 'End') v = Infinity;
        if (v === null) return; e.preventDefault(); this._setEdge(edge, v, true); this._read(edge, true);
        clearTimeout(this._rt); this._rt = setTimeout(() => this._read(edge, false), 1200);
      });
      h.addEventListener('blur', () => this._read(edge, false));
    }
    _read(edge, on) {
      const r = this.querySelector('.g-read'); if (!on) { delete r.dataset.on; this._readEdge = null; return; }
      this._readEdge = edge; r.dataset.on = ''; this._placeRead();
    }
    _placeRead() {
      const edge = this._readEdge; if (!edge) return;
      const r = this.querySelector('.g-read'), v = num(this.getAttribute(edge)), b = this._bins(), d = this.hasAttribute('decimals') ? +this.getAttribute('decimals') : undefined;
      const exact = v => v.toLocaleString('en-GB', { maximumSignificantDigits: 6 });
      r.textContent = b ? `Bin price ${exact(v)} · Bin step ${fmt(b.bs)} (${fmt(b.bs / 100, 2)}%)` : `${fmt(v, d)} · Bin step unavailable`;
      const x = edge === 'low' ? this._xl : this._xh, svgTop = this._svg.offsetTop;
      r.style.left = Math.max(r.offsetWidth / 2, Math.min(this.clientWidth - r.offsetWidth / 2, x)) + 'px'; r.style.top = (svgTop + this._G - 52) + 'px';
    }
    _step() { const s = num(this.getAttribute('step')); if (s > 0) return s; const d = this._dom || [0, 100]; return +((d[1] - d[0]) / 100).toPrecision(2); }
    _inv(x) { const d = this._dom, pad = 16; return d[0] + (x - pad) / (this._px - 2 * pad) * (d[1] - d[0]); }
    _setEdge(edge, v, final) {
      const d = this._dom, b = this._bins(), st = this._step(); let low = num(this.getAttribute('low')), high = num(this.getAttribute('high'));
      const price = num(this.getAttribute('price')), shape = this.getAttribute('shape');
      v = Math.max(d[0], Math.min(d[1], v));
      // snap to a real bin (or the plain step), and keep at least one bin/step between the edges
      const snap = x => b ? this._binPrice(this._binOf(x, b), b) : +(Math.round(x / st) * st).toFixed(10);
      const up = x => b ? this._binPrice(this._binOf(x, b) + 1, b) : x + st, down = x => b ? this._binPrice(this._binOf(x, b) - 1, b) : x - st;
      v = snap(v); let note = '';
      if (edge === 'low') v = Math.min(v, down(high));
      else {
        v = Math.max(v, up(low));
        if (shape === 'bid-ask-sol' && price !== null && v > price) {
          if (this.getAttribute('on-above') === 'switch') {
            this.setAttribute('shape', 'bid-ask'); note = NOTE_SWITCH;
            this.dispatchEvent(new CustomEvent('still:strategy', { bubbles: true, detail: { strategy: 'bid-ask', reason: 'top-above-price' } }));
          } else { v = Math.max(up(low), b ? this._binPrice(this._binOf(price, b), b) : price); note = NOTE_STOP; }
        }
      }
      v = +v.toPrecision(12);
      if (note) this.querySelector('.g-note').textContent = note;
      if (+this.getAttribute(edge) !== v) { this.setAttribute(edge, v); this._emit(edge, false); }
      if (final) this._emit(edge, true);
      this._placeRead();
    }
    _emit(edge, final) {
      const b = this._bins(), low = num(this.getAttribute('low')), high = num(this.getAttribute('high'));
      this.dispatchEvent(new CustomEvent('still:range', { bubbles: true, detail: { low, high, edge, final,
        lowBin: b && low ? this._binOf(low, b) : null, highBin: b && high ? this._binOf(high, b) : null } }));
    }
    // ---- price ticks to its new value ----
    _tick(from, to, d, unit) {
      const el = this.querySelector('.g-price'), show = v => el.textContent = `Price ${fmt(v, d)}${unit ? ' ' + unit : ''}`;
      cancelAnimationFrame(this._raf);
      if (from === null || from === undefined || from === to || reduce()) return show(to);
      const t0 = performance.now(), T = 480, ease = t => 1 - Math.pow(1 - t, 3);
      const step = now => { const t = Math.min(1, (now - t0) / T); show(from + (to - from) * ease(t)); if (t < 1) this._raf = requestAnimationFrame(step); };
      this._raf = requestAnimationFrame(step);
    }
    // ---- drawing ----
    _draw(animate, prevPrice) {
      const q = s => this.querySelector(s), svg = this._svg, C = this.hasAttribute('compact'), ED = this.hasAttribute('editable');
      const G = this._G = C ? 32 : 48, D = C ? 36 : 72, H = C ? 92 : G + D + 32;
      const px = this._px = Math.max(240, Math.min(640, this.clientWidth || 480)); svg.setAttribute('viewBox', `0 0 ${px} ${H}`); svg.style.height = H + 'px';
      const price = num(this.getAttribute('price')), low = num(this.getAttribute('low')), high = num(this.getAttribute('high'));
      const fee = num(this.getAttribute('fee-rate')), shape = DEPTH[this.getAttribute('shape')] ? this.getAttribute('shape') : 'spot';
      const d = this.hasAttribute('decimals') ? +this.getAttribute('decimals') : undefined, unit = this.getAttribute('unit') || '';
      const prev = this.dataset.range, rm = reduce();
      const range = (price === null || low === null || high === null || high <= low) ? 'unavailable' : price > high ? 'above' : price < low ? 'below' : 'in';
      this.dataset.range = range; q('.g-state').textContent = LABEL[range];
      this.dataset.fees = fee !== null && fee > 0 ? 'known' : 'unknown';
      q('.g-fee').textContent = fee !== null && fee >= 0 ? `Pool fees: ${fmt(fee, 1)}% a year (pool average)` : 'Pool fees: Unavailable';
      q('.g-shape').textContent = { 'curve': 'Curve', 'spot': 'Spot', 'bid-ask': 'Bid-Ask, two-sided', 'bid-ask-sol': 'Bid-Ask, SOL only' }[shape];
      const hs = this.querySelectorAll('.g-handle');
      if (range === 'unavailable') {
        q('.g-ground').setAttribute('d', `M0,${G}H${px}`);
        ['.g-water', '.g-clip', '.g-chev', '.g-pulse', '.g-floor'].forEach(s => q(s).setAttribute('d', ''));
        q('.g-surface').setAttribute('x1', 0); q('.g-surface').setAttribute('x2', 0); q('.g-caus').style.display = 'none';
        q('.g-drop').style.display = 'none'; q('.g-lo').textContent = q('.g-hi').textContent = ''; q('.g-price').textContent = 'Unavailable';
        hs.forEach(h => h.style.display = 'none');
        this.dataset.state = rm ? 'reduced-motion' : 'idle'; this.setAttribute('aria-label', 'Pool: Unavailable'); return;
      }
      q('.g-caus').style.display = '';
      const mn = num(this.getAttribute('min')), mx = num(this.getAttribute('max'));
      if (mn !== null && mx !== null && mx > mn) this._dom = [mn, mx];
      else if (!ED || !this._dom || low < this._dom[0] || high > this._dom[1]) { const sp = high - low; this._dom = [Math.min(low - sp * .7, price), Math.max(high + sp * .7, price)]; }
      const [lo, hi] = this._dom, pad = 16, X = v => pad + (v - lo) / (hi - lo) * (px - 2 * pad), xl = this._xl = X(low), xh = this._xh = X(high);
      const pts = []; for (let i = 0; i <= 48; i++) { const t = i / 48, e = ss(0, .08, Math.min(t, 1 - t)); pts.push([xl + t * (xh - xl), G + D * DEPTH[shape](t) * e]); }
      const floor = pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(''), water = `M${xl.toFixed(1)},${G}${floor}Z`;
      const grad = q(`#${this._id}d`); grad.setAttribute('y1', G); grad.setAttribute('y2', G + D);
      const fade = q(`#${this._id}f`); fade.setAttribute('y1', G); fade.setAttribute('y2', G + D * .5);
      const fr = q('.g-fade'); fr.setAttribute('y', G); fr.setAttribute('height', D);
      this.querySelectorAll('.g-caus rect').forEach((r, i) => { r.setAttribute('y', i ? -(G + D) : G); r.setAttribute('height', D); });
      q('.g-water').setAttribute('d', water); q('.g-clip').setAttribute('d', water);
      q('.g-floor').setAttribute('d', `M${xl.toFixed(1)},${G}${floor}`);
      q('.g-ground').setAttribute('d', `M0,${G}H${xl.toFixed(1)}M${xh.toFixed(1)},${G}H${px}`);
      const sf = q('.g-surface'); sf.setAttribute('x1', xl); sf.setAttribute('x2', xh); sf.setAttribute('y1', G + 1); sf.setAttribute('y2', G + 1);
      const off = price < lo ? -1 : price > hi ? 1 : 0, xp = off < 0 ? pad + 20 : off > 0 ? px - pad - 20 : X(price);
      const dr = q('.g-drop'); dr.style.display = ''; dr.setAttribute('cy', G); dr.setAttribute('r', C ? 3.5 : 4.5); dr.style.transform = `translateX(${xp.toFixed(1)}px)`;
      q('.g-chev').setAttribute('d', off < 0 ? `M${pad + 4},${G - 10} l-6,6 l6,6` : off > 0 ? `M${px - pad - 4},${G - 10} l6,6 l-6,6` : '');
      const R = Math.max(12, Math.min(C ? 24 : 40, (xh - xl) * .3));
      this.querySelectorAll('.g-rip').forEach(e => e.setAttribute('d', `M${(xp - R).toFixed(1)},${G}a${R},${R} 0 0 1 ${2 * R},0`));
      if (fee > 0) this.style.setProperty('--ripple-period', Math.max(.9, Math.min(8, 2.5 * Math.sqrt(100 / fee))).toFixed(2) + 's');
      const lt = q('.g-lo'), ht = q('.g-hi'), ty = G + D + (C ? 16 : 24), gap = Math.max(0, (C ? 64 : 80) - (xh - xl)) / 2;
      lt.setAttribute('x', Math.max(28, xl - gap)); ht.setAttribute('x', Math.min(px - 28, xh + gap)); lt.setAttribute('y', ty); ht.setAttribute('y', ty);
      lt.style.fontSize = ht.style.fontSize = C ? '12px' : ''; lt.textContent = fmt(low, d); ht.textContent = fmt(high, d);
      hs.forEach(h => {
        const e = h.dataset.edge, x = e === 'low' ? xl : xh, v = e === 'low' ? low : high;
        h.style.display = ED ? '' : 'none'; h.setAttribute('tabindex', ED ? '0' : '-1'); h.setAttribute('transform', `translate(${x.toFixed(1)},0)`);
        h.querySelector('.h-hit').setAttribute('y', G - 32); h.querySelector('.h-hit').setAttribute('height', D + 40);
        h.querySelector('.h-knob').setAttribute('cy', G - 16); h.querySelector('.h-ring').setAttribute('cy', G - 16);
        const s = h.querySelector('.h-stem'); s.setAttribute('y1', G - 11); s.setAttribute('y2', G);
        h.setAttribute('aria-valuemin', e === 'low' ? lo : low); h.setAttribute('aria-valuemax', e === 'low' ? high : hi);
        h.setAttribute('aria-valuenow', v); h.setAttribute('aria-valuetext', `${fmt(v, d)}${unit ? ' ' + unit : ''}`);
      });
      this._tick(animate ? prevPrice : null, price, d, unit);
      this.setAttribute('aria-label', `${LABEL[range]}. Price ${fmt(price, d)}, range ${fmt(low, d)} to ${fmt(high, d)}${unit ? ' ' + unit : ''}. ${q('.g-shape').textContent}. ${q('.g-fee').textContent}.`);
      this.dataset.state = rm ? 'reduced-motion' : (range === 'in' && fee > 0 ? 'playing' : 'done');
      if (animate && prev && prev !== range && prev !== 'unavailable') {
        this.dispatchEvent(new CustomEvent('still:change', { bubbles: true, detail: { range } }));
        if (!rm) { const p = q('.g-pulse'); p.setAttribute('d', `M${xp - 10},${G} A10,10 0 0 1 ${xp + 10},${G}`);
          p.animate([{ opacity: .9, transform: 'scale(.6)' }, { opacity: 0, transform: 'scale(4)' }], { duration: 900, easing: 'cubic-bezier(.16,1,.3,1)' }); }
      }
      this._placeRead();
    }
  }
  customElements.define('still-range-gauge', StillRangeGauge);

  /* <still-pool-list> · the "On paper" list: one small pool per position ADDRESS, each with its own range, drop and state.
     Two positions in the same pool stay separate. Markup (one <still-position> per position, keyed by address):
       <still-pool-list>
         <still-position address="7xKX…" name="SOL-USDC" price="146" low="138" high="156" shape="spot" fee-rate="…" bin-step="10" href="/positions/7xKX…"></still-position>
       </still-pool-list>
     Each item renders a compact <still-range-gauge> with the same props. Duplicate addresses are ignored (first wins). */
  if (!customElements.get('still-pool-list')) customElements.define('still-pool-list', class extends HTMLElement {
    connectedCallback() {
      const seen = new Set();
      [...this.querySelectorAll('still-position')].forEach(p => {
        const addr = p.getAttribute('address') || '';
        if (!addr || seen.has(addr)) { p.remove(); return; } seen.add(addr);
        const a = document.createElement(p.getAttribute('href') ? 'a' : 'div'); a.className = 'p-item';
        if (p.getAttribute('href')) a.href = p.getAttribute('href');
        const top = document.createElement('div'); top.className = 'p-top';
        const n = document.createElement('span'); n.className = 'p-name'; n.textContent = p.getAttribute('name') || 'Position';
        const ad = document.createElement('span'); ad.className = 'p-addr'; ad.textContent = addr.length > 12 ? addr.slice(0, 4) + '…' + addr.slice(-4) : addr; ad.title = addr;
        top.append(n, ad);
        const g = document.createElement('still-range-gauge'); g.setAttribute('compact', '');
        ['price', 'low', 'high', 'shape', 'fee-rate', 'unit', 'decimals', 'bin-step', 'active-bin-price'].forEach(k => { if (p.hasAttribute(k)) g.setAttribute(k, p.getAttribute(k)); });
        a.append(top, g); a.dataset.address = addr; p.replaceWith(a);
      });
    }
  });
})();
