/* <still-reveal> · shows a <still-loader> while content loads, then the last ripple settles and the card rises out of the water (520ms).
   Usage: <still-reveal label="Running Pre-flight"><div class="still-glass">…card…</div></still-reveal>
   The card stays in the layout the whole time (hidden), so nothing shifts when it appears (no CLS).
   States (data-state): idle | playing | done | reduced-motion
   API: el.start(), el.reveal() -> Promise, el.reset()
   Attributes: autoplay, label
   Events: still:done (after the card has risen) */
(() => {
  if (customElements.get('still-reveal')) return;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SETTLE = 'cubic-bezier(.16,1,.3,1)', RISE = 'cubic-bezier(.3,.7,.2,1)';
  class StillReveal extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      const content = document.createElement('div');
      content.className = 'sr-content';
      while (this.firstChild) content.appendChild(this.firstChild);
      const stage = document.createElement('div');
      stage.className = 'sr-stage';
      stage.innerHTML = `<still-loader label="${(this.getAttribute('label') || 'Loading').replace(/"/g, '&quot;')}"></still-loader>`;
      this.append(content, stage);
      this._content = content; this._stage = stage; this._loader = stage.firstElementChild;
      this.dataset.state = 'idle';
      if (this.hasAttribute('autoplay')) requestAnimationFrame(() => this.start());
    }
    start() {
      this._stage.hidden = false;
      this._content.setAttribute('aria-hidden', 'true');
      this._loader.start();
      this.dataset.state = reduce() ? 'reduced-motion' : 'playing';
    }
    reveal() {
      const content = this._content, stage = this._stage, rm = reduce() || this.dataset.state === 'reduced-motion';
      const finish = () => {
        stage.hidden = true; content.removeAttribute('aria-hidden');
        this.dataset.state = 'done';
        this.dispatchEvent(new CustomEvent('still:done', { bubbles: true }));
      };
      if (rm) { // plain crossfade, 200ms
        content.style.visibility = 'visible';
        stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
        return content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'none' }).finished.then(finish);
      }
      // 0–200ms: the loader's last ring settles into the half-ripple
      this._loader.finish();
      stage.animate([{ opacity: 1 }, { opacity: 1, offset: .6 }, { opacity: 0 }], { duration: 300, easing: 'ease-out', fill: 'forwards' });
      // 140–520ms: the card rises out of the water line at its base
      content.style.visibility = 'visible';
      const h = Math.min(96, content.offsetHeight || 96);
      const water = document.createElement('div');
      water.className = 'sr-water'; water.style.top = (content.offsetHeight - 1) + 'px';
      this.appendChild(water);
      water.animate([{ transform: 'scaleX(.2)', opacity: 0 }, { transform: 'scaleX(.6)', opacity: 1, offset: .25 }, { transform: 'scaleX(1)', opacity: 1, offset: .6 }, { transform: 'scaleX(1)', opacity: 0 }],
        { duration: 400, delay: 120, easing: SETTLE, fill: 'both' }).finished.then(() => water.remove());
      return content.animate([
        { transform: `translateY(${h}px)`, clipPath: `inset(-60px -60px ${h}px -60px)`, opacity: 0 },
        { opacity: 1, offset: .35 },
        { transform: 'translateY(0)', clipPath: 'inset(-60px -60px -60px -60px)', opacity: 1 }
      ], { duration: 380, delay: 140, easing: RISE, fill: 'backwards' }).finished.then(() => { content.style.visibility = ''; finish(); });
    }
    reset() { this._loader.reset(); this._content.style.visibility = ''; this.dataset.state = 'idle'; }
  }
  customElements.define('still-reveal', StillReveal);
})();
