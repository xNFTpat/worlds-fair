/* Read-only evidence shared by the pool list and drawer. No return forecasts. */
globalThis.LPDiscovery = {
  alphaModes: {
    depth: { label: 'More depth', minTvl: 25000, maxTvl: 0, minVol: 50000 },
    degen: { label: 'Degen', minTvl: 2500, maxTvl: 25000, minVol: 25000 },
  },
  queryFilters(tab, mode, fields) {
    if (tab !== 'alpha') return { ...fields };
    if (/^(?:[1-9A-HJ-NP-Za-km-z]{32,44}|0x[a-fA-F0-9]{40})$/.test(fields.search || '')) return {...fields,minTvl:0,maxTvl:0,minVol:0};
    const { minTvl, maxTvl, minVol } = this.alphaModes[mode] || this.alphaModes.depth;
    return { ...fields, minTvl, maxTvl, minVol };
  },
  presets: {
    all: { minTvl: 0, maxTvl: 0, minVol: 0 },
    small: { minTvl: 0, maxTvl: 25000, minVol: 0 },
    depth: { minTvl: 25000, maxTvl: 0, minVol: 0 },
  },
  evidence(p, now = Date.now()) {
    const valid = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    const dollars = v => '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const a = p.activity || {}, age = p.ageHours;
    const stale = !Number.isFinite(Date.parse(p.fetchedAt)) || now - Date.parse(p.fetchedAt) > 600000;
    const hour = valid(a.fees1h) ? a.fees1h : null;
    const half = valid(a.fees30m) ? a.fees30m : null;
    const completeHour = valid(age) && age >= 1;
    const completeFour = valid(age) && age >= 4;
    const priorHalf = hour != null && half != null && half <= hour ? hour - half : null;
    const shortRatio = completeHour && priorHalf > 0 ? half / priorHalf : null;
    const priorThree = completeFour && hour != null && valid(a.fees4h) && a.fees4h >= hour ? (a.fees4h - hour) / 3 : null;
    const hourlyRatio = priorThree > 0 ? hour / priorThree : null;
    let signal = 'Hourly activity unavailable';
    if (hour != null) signal = !completeHour ? 'Short history' : shortRatio != null ? shortRatio < .5 ? 'Cooling · last 30m' : shortRatio > 2 ? 'Building · last 30m' : 'Similar pace · last 30m' : priorHalf === 0 && half > 0 ? 'Fees resumed · last 30m' : hour === 0 ? 'No fees in last hour' : 'Recent fees available';
    if (stale) signal = 'Saved · ' + signal;
    const reasons = [];
    if (hour != null) reasons.push(`${dollars(hour)} in pool fees over the last hour${!completeHour ? ' (the pool has less than an hour of known history)' : ''}. These fees are shared across active liquidity, not paid to each position.`);
    else reasons.push('Hourly fee amounts are unavailable. The daily figure cannot show whether activity is still continuing.');
    if (completeHour && priorHalf != null) reasons.push(`Latest 30 minutes: ${dollars(half)}; previous 30 minutes: ${dollars(priorHalf)}.`);
    if (hourlyRatio != null) reasons.push(`The last hour ran at ${hourlyRatio.toFixed(1)}× the hourly average of the preceding three hours.`);
    const risks = [stale ? 'Saved data: refresh before comparing.' : null,
      !valid(age) ? 'Pool age unavailable; full comparison windows cannot be confirmed.' : age < 24 ? 'Less than a day old. The 24h total covers only its short lifetime.' : age < 96 ? 'Under four days old: limited history for a 24–48h hold.' : null,
      p.tvlUsd == null ? 'Pool liquidity unavailable.' : p.tvlUsd < 25000 ? 'Small pool: fee/TVL percentages can look huge against a small or shrinking balance. TVL is not your executable exit depth.' : 'Total pool liquidity includes bins away from price; check an exit quote for your size.',
      shortRatio != null && shortRatio < .5 ? 'The latest half-hour paid less than half as much as the previous one. Check for a fading burst.' : null,
      'Token value can fall faster than fees accrue. Mint permissions, holder concentration and future sellability are not established by this ranking.'
    ].filter(Boolean);
    const next = [
      stale ? 'Refresh this pool before choosing a setup.' : shortRatio != null && shortRatio < .5 ? 'Wait for another activity check before treating the earlier burst as ongoing.' : 'Compare another fresh read to see whether this fee flow continues.',
      'For a 24–48h idea, inspect the chart and a Spot range first. Curve needs a reason for price to keep trading near your centre; Bid-Ask needs a deliberate buy-lower / sell-higher plan.',
      `Decide whether you would still want ${p.base.symbol} if the range fills into it. Use the preview to check both conversion costs and account rent.`,
      'Reconsider the position if fee flow fades, price leaves your range, or the token thesis changes. These are review conditions, not automatic exits.'
    ];
    if(p.venue==='meteora-damm-v2') {
      next[1]='Inspect whether this DAMM v2 pool uses full-range or pool-wide concentrated liquidity. DLMM Spot, Curve and Bid-Ask distributions do not apply.';
      next[2]='Check launch fee schedules, locks, compounded versus claimable fees and both token mints on Meteora. The terminal does not execute DAMM v2 positions.';
      risks[risks.length-2]=p.tvlUsd<25000?'Small liquidity balance; obtain a quote for your exit size.':'TVL does not establish executable depth for your trade size.';
    }
    return { signal, reason: reasons.join(' '), risks, next, stale, shortRatio, hourlyRatio };
  }
};
