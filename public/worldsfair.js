/* Presentation policy for the separate World's Fair paper demo. */
(() => {
  const storageKey = 'worldsfair:show-robinhood';
  let showRobinhood = false;
  try { showRobinhood = globalThis.sessionStorage?.getItem(storageKey) === 'true'; } catch {}
  const referencePaths = new Set(['/api/pools', '/api/stats', '/api/positions', '/api/history', '/api/long-game', '/api/cesto', '/api/pool-context', '/api/pool-lookup', '/api/wallet-intelligence', '/api/position-chart', '/api/position-break-even', '/api/range-alerts']);
  function dataUrl(value, includeRobinhood = showRobinhood) {
    const origin = globalThis.location?.origin || 'https://paper.invalid';
    const url = new URL(value, origin);
    if (url.origin !== origin || !referencePaths.has(url.pathname)) return value;
    if (includeRobinhood) url.searchParams.set('includeOther', '1');
    else url.searchParams.delete('includeOther');
    return url.pathname + url.search + url.hash;
  }
  const isRobinhood = row => row?.chain === 'robinhood' || /^0x/i.test(row?.walletAddress || '');
  function filterResponse(url, data, includeRobinhood = showRobinhood) {
    if (includeRobinhood || !data || typeof data !== 'object') return data;
    const path = new URL(url, 'https://paper.invalid').pathname;
    if (path === '/api/long-game') return {...data, items:(data.items || []).filter(item => String(item.chain).toLowerCase() === 'solana')};
    if (!['/api/pools', '/api/positions', '/api/history'].includes(path)) return data;
    const filtered = {...data};
    const hiddenWallets = new Set(Object.keys(data.robinhood || {}));
    for (const key of ['pools', 'positions', 'balances', 'open', 'closed']) {
      if (!Array.isArray(data[key])) continue;
      for (const row of data[key]) if (isRobinhood(row) && row.wallet) hiddenWallets.add(row.wallet);
      filtered[key] = data[key].filter(row => !isRobinhood(row));
    }
    // An unavailable wallet can have no position rows, but its source still
    // identifies it. Suppress the associated totals and errors as well.
    for (const [key, value] of Object.entries(data.totals || {})) {
      if (/robinhood|uniswap/i.test(value?.note || '')) hiddenWallets.add(key);
    }
    const visible = (key, value) => !hiddenWallets.has(key)
      && ![...hiddenWallets].some(wallet => key.endsWith(':' + wallet))
      && !/robinhood|uniswap/i.test(key + ' ' + (value?.label || ''));
    for (const key of ['sources', 'positionSources', 'historySources', 'errors', 'totals']) {
      if (data[key] && typeof data[key] === 'object' && !Array.isArray(data[key])) {
        filtered[key] = Object.fromEntries(Object.entries(data[key]).filter(([id, value]) => visible(id, value)));
      }
    }
    if (data.robinhood) filtered.robinhood = {};
    return filtered;
  }
  function versionLabel(version) {
    const sha = /^[a-f0-9]{40,64}$/i.test(version?.gitSha || '') ? version.gitSha : null;
    return sha ? 'git ' + sha.slice(0, 8) + (version.branch ? ' · ' + version.branch : '') : 'Build identity unavailable';
  }
  globalThis.WorldsFair = {dataUrl, filterResponse, versionLabel, get showRobinhood() { return showRobinhood; }};
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.showRobinhood = String(showRobinhood);
  function mount() {
    const toggle = document.querySelector('#worldsfairRobinhood');
    if (toggle) {
      toggle.checked = showRobinhood;
      toggle.addEventListener('change', () => {
        showRobinhood = toggle.checked;
        document.documentElement.dataset.showRobinhood = String(showRobinhood);
        try { sessionStorage.setItem(storageKey, String(showRobinhood)); } catch {}
        document.dispatchEvent(new CustomEvent('worldsfair:visibility'));
      });
    }
    const node = document.querySelector('#worldsfairVersion');
    fetch('/api/version', {cache:'no-store', signal:AbortSignal.timeout(15000)})
      .then(async response => { if (!response.ok) throw Error('Build unavailable'); return response.json(); })
      .then(version => {
        if (!node) return;
        node.textContent = versionLabel(version);
        node.title = 'Built ' + (version.buildAt || version.builtAt || 'date unavailable');
        node.dataset.build = version.gitSha || '';
      }).catch(() => { if (node) node.textContent = 'Build identity unavailable'; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
})();
