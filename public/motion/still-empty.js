/* <still-empty kind="closed|follow|grow"> · still-water illustrations for empty screens.
   closed  a settled half-ripple: nothing has moved yet
   follow  a dashed ring waiting for a drop
   grow    one drop hanging just above the line (Grow at 0 SOL)
   Put the words inside the element (h3 + p); the illustration is added above them and is decorative (aria-hidden).
   States (data-state): idle | playing | reduced-motion. Add the "animate" attribute for a very slow idle loop on the shared tempo. */
(() => {
  if (customElements.get('still-empty')) return;
  const TEMPO = 2500;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LINE = '<rect class="e-line" x="10" y="78" width="200" height="2" rx="1"/>';
  const ART = {
    closed: `<path class="e-anim" fill="currentColor" d="M80,79 A30,30 0 0 1 140,79 H131 A21,21 0 0 0 89,79 Z"/>
<path class="e-soft" fill="none" stroke="currentColor" stroke-width="2" d="M60,79 A50,50 0 0 1 160,79"/>
<ellipse class="e-soft" cx="110" cy="80" rx="26" ry="7" fill="none" stroke="currentColor" stroke-width="1.5" clip-path="inset(1px 0 0 0)"/>`,
    follow: `<path class="e-anim" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="6 6" stroke-linecap="round" d="M80,79 A30,30 0 0 1 140,79"/>
<circle class="e-soft" cx="110" cy="40" r="4" fill="none" stroke="currentColor" stroke-width="2"/>`,
    grow: `<circle class="e-anim" cx="110" cy="44" r="6" fill="var(--still-paper)" stroke="currentColor" stroke-width="2.5"/>
<path class="e-soft" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 5" d="M110,56 V74"/>`
  };
  class StillEmpty extends HTMLElement {
    connectedCallback() {
      if (!this._built) { this._built = true;
      const kind = ART[this.getAttribute('kind')] ? this.getAttribute('kind') : 'closed';
      this.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 220 100" aria-hidden="true" focusable="false">${ART[kind]}${LINE}</svg>`);
      this._media=matchMedia('(prefers-reduced-motion: reduce)'); this._preferenceChange=()=>this._updateState();
      }
      this._media.addEventListener?.('change',this._preferenceChange); this._updateState();
    }
    disconnectedCallback() { this._media?.removeEventListener?.('change',this._preferenceChange); }
    _updateState() {
      if (reduce()) { this.dataset.state = 'reduced-motion'; return; }
      if (this.hasAttribute('animate')) { this.style.setProperty('--still-phase', -(performance.now() % TEMPO) + 'ms'); this.dataset.state = 'playing'; }
      else this.dataset.state = 'idle';
    }
  }
  customElements.define('still-empty', StillEmpty);
})();
