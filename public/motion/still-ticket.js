/* <still-verdict> · the Pre-flight verdict as one clean glass panel, built only from live data passed in. No defaults, no demo values.
   <still-ticket> is the same component under its v5.1 name and keeps working.
   Markup:
     <still-verdict kicker="Pre-flight" heading="SOL-USDC" verdict="marginal" summary="…" action-label="Open on paper">
       <still-check label="Fees" status="pass" value="…" reason="…"></still-check>
       <still-check label="Costs" status="caution" value="…" reason="…"></still-check>
       <still-check label="Downside" status="fail" value="…" reason="…"></still-check>
     </still-verdict>
   Panel attributes:
     verdict          worth-a-look | marginal | skip-for-now. Anything else (or missing) shows "Verdict unavailable".
     heading          what is being checked, e.g. the pair (optional).
     kicker           small label beside it (optional; e.g. "Pre-flight").
     summary          one short line under the verdict (optional; omitted when missing).
     action-label     text for the full-width button at the bottom (optional; no button when missing).
     action-disabled  present -> the button is disabled (e.g. while data is stale).
   <still-check> attributes (one per row, in display order):
     label   row name (required; rows without a label are skipped).
     status  pass | caution | fail. Anything else shows an "Unavailable" chip.
     value   the figure as display text, already formatted by the app (e.g. "0.42%"). Missing -> "Unavailable".
     reason  one short line explaining the status (optional; omitted when missing).
   Layout: verdict at the top; each row = chip, label and value on one line, the reason on the line below; full-width button last.
   Events: still:action { verdict, from } when the button is pressed. Re-renders on any attribute or <still-check> change.
   All text is set with textContent. */
(() => {
  if (customElements.get('still-verdict')) return;
  const VERDICT = { 'worth-a-look': 'Worth a look', 'marginal': 'Marginal', 'skip-for-now': 'Skip for now', 'caution': 'Caution' };
  const CHIP = { pass: 'Pass', caution: 'Caution', fail: 'Fail' };
  const ICON = { // Lucide check, triangle-alert, x
    pass: '<path d="M20 6 9 17l-5-5"/>',
    caution: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    fail: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const has = (n, a) => n.hasAttribute(a) && n.getAttribute(a).trim() !== '';
  class StillVerdict extends HTMLElement {
    static get observedAttributes() { return ['verdict', 'heading', 'kicker', 'summary', 'action-label', 'action-disabled']; }
    connectedCallback() {
      if (!this._out) {
        this._out = el('div', 'tk'); this.appendChild(this._out);
        this._mo = new MutationObserver(m => { if (m.some(r => !this._out.contains(r.target) && !(r.target === this && r.type === 'attributes'))) this._render(); });
        this._mo.observe(this, { childList: true, subtree: true, attributes: true });
      }
      this._render();
    }
    disconnectedCallback() { this._mo && this._mo.disconnect(); }
    attributeChangedCallback() { if (this._out) this._render(); }
    _render() {
      const o = this._out; o.textContent = '';
      const v = this.getAttribute('verdict');
      if (has(this, 'kicker') || has(this, 'heading')) {
        const head = el('div', 'tk-head');
        if (has(this, 'kicker')) head.append(el('span', 'tk-kicker', this.getAttribute('kicker')));
        if (has(this, 'heading')) head.append(el('span', 'tk-title', this.getAttribute('heading')));
        o.append(head);
      }
      const vd = el('p', 'tk-verdict', VERDICT[v] || 'Verdict unavailable'); vd.dataset.verdict = VERDICT[v] ? v : 'unavailable'; o.append(vd);
      if (has(this, 'summary')) o.append(el('p', 'tk-summary', this.getAttribute('summary')));
      const rows = el('ul', 'tk-rows');
      [...this.querySelectorAll(':scope > still-check')].forEach(c => {
        if (!has(c, 'label')) return;
        const st = c.getAttribute('status'), li = el('li', 'tk-row');
        const chip = el('span', 'still-chip ' + (CHIP[st] ? 'still-chip--' + st : 'tk-chip-na'));
        if (CHIP[st]) chip.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[st]}</svg>`;
        chip.append(document.createTextNode(CHIP[st] || 'Unavailable'));
        const val = el('span', 'tk-val', has(c, 'value') ? c.getAttribute('value') : 'Unavailable'); if (!has(c, 'value')) val.dataset.missing = '';
        li.append(chip, el('span', 'tk-label', c.getAttribute('label')), val);
        if (has(c, 'reason')) li.append(el('span', 'tk-reason', c.getAttribute('reason')));
        rows.append(li);
      });
      o.append(rows);
      if (has(this, 'action-label')) {
        const b = el('button', 'still-cta still-cta--solid tk-action', this.getAttribute('action-label')); b.type = 'button';
        b.disabled = this.hasAttribute('action-disabled');
        b.addEventListener('click', () => this.dispatchEvent(new CustomEvent('still:action', { bubbles: true, detail: { verdict: VERDICT[v] ? v : null, from: b } })));
        o.append(b);
      }
      this.setAttribute('role', 'group'); this.setAttribute('aria-label', `${has(this, 'heading') ? this.getAttribute('heading') + ': ' : ''}${VERDICT[v] || 'Verdict unavailable'}`);
    }
  }
  customElements.define('still-verdict', StillVerdict);
  if (!customElements.get('still-ticket')) customElements.define('still-ticket', class extends StillVerdict {});
})();
