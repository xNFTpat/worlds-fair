// Pure range-state transitions. This module cannot sign or submit transactions.
const minute = 60_000;
export function validateSettings(value) {
  if (!value || !Array.isArray(value.wallets) || !value.wallets.length) throw new Error('Set the wallets to monitor.');
  const grace = n => Number.isInteger(n) && n >= 0 && n <= 10080;
  if (!grace(value.defaultGraceMinutes)) throw new Error('Grace period must be 0–10080 whole minutes.');
  if (!Number.isInteger(value.maxDataAgeMinutes) || value.maxDataAgeMinutes < 1 || value.maxDataAgeMinutes > 60) throw new Error('Invalid data freshness limit.');
  for (const [id, rule] of Object.entries(value.pools || {})) {
    if (!id || !rule || !grace(rule.graceMinutes) || (rule.enabled != null && typeof rule.enabled !== 'boolean')) throw new Error('Invalid pool alert settings.');
  }
  return value;
}

export function checkRanges(payload, previous, settings, now = Date.now()) {
  validateSettings(settings);
  const state = structuredClone(previous || { version: 1, wallets: {}, positions: {} });
  if (state.version !== 1 || !state.wallets || !state.positions) throw new Error('Unrecognised monitor state.');
  const events = [];
  state.episodes ||= {};
  const iso = ms => new Date(ms).toISOString();
  const emit = (kind, p, extra = {}) => events.push({ kind, at: iso(now), wallet: p.wallet, pair: p.pair, positionId: p.id, poolAddress: p.poolAddress, chain: p.chain, pnlUsd: p.pnlUsd ?? null, ...extra });
  const recent = stamp => {
    const t = Date.parse(stamp);
    return Number.isFinite(t) && t <= now + minute && now - t <= settings.maxDataAgeMinutes * minute;
  };
  const rows = Array.isArray(payload?.positions) ? payload.positions : [];
  for (const wallet of settings.wallets) {
    const h = payload?.sources?.['positions:' + wallet];
    const current = rows.filter(p => p.wallet === wallet);
    const trusted = Array.isArray(payload?.positions) && h?.status === 'fresh' && recent(h.lastSuccessAt) &&
      current.every(p => p.id && recent(p.fetchedAt));
    const health = state.wallets[wallet] ||= { unavailableSince: null, notified: false };
    if (!trusted) {
      if (!health.notified) {
        events.push({ kind: 'data-unavailable', at: iso(now), wallet, message: 'Fresh position data is unavailable. Range changes cannot be confirmed; grace reminders are paused.' });
        health.notified = true;
      }
      health.unavailableSince ||= iso(now);
      for (const p of Object.values(state.positions)) if (p.wallet === wallet) p.interrupted = true;
      continue;
    }
    if (health.notified) events.push({ kind: 'data-restored', at: iso(now), wallet, message: 'Fresh position data has returned. Any out-of-range grace period restarts from a fresh observation.' });
    health.notified = false; health.unavailableSince = null;
    const seen = new Set();
    for (const original of current) {
      const p = {...original};
      if (p.rangeStatus) p.inRange = p.rangeStatus.out == null ? null : p.rangeStatus.out === 0;
      seen.add(p.id);
      const rule = settings.pools?.[p.chain + ':' + p.poolAddress];
      const graceMinutes = rule?.graceMinutes ?? settings.defaultGraceMinutes;
      if (rule?.enabled === false) { delete state.positions[p.id]; continue; }
      const old = state.positions[p.id];
      // A non-boolean range is uncertainty, not an in-range reading.
      if (typeof p.inRange !== 'boolean') {
        if (!old?.rangeUnknown) emit('range-unknown', p, { message: 'The source cannot confirm this position’s range. Grace reminders are paused.' });
        state.positions[p.id] = { ...old, id:p.id, wallet, pair:p.pair, poolAddress:p.poolAddress, chain:p.chain, rangeUnknown:true, interrupted:true };
        continue;
      }
      const sampleTime = Date.parse(p.fetchedAt);
      // Discard older observations even if the provider labels them fresh.
      if (old?.lastSampleAt && sampleTime < Date.parse(old.lastSampleAt)) continue;
      const wasOut = old?.inRange === false;
      const gap = !!old?.interrupted || !!old?.lastSampleAt && sampleTime-Date.parse(old.lastSampleAt)>settings.maxDataAgeMinutes*minute;
      const entry = { ...old, id:p.id, wallet, pair:p.pair, poolAddress:p.poolAddress, chain:p.chain, pnlUsd:p.pnlUsd, inRange:p.inRange, lastSampleAt:p.fetchedAt, graceMinutes, rangeStatus:p.rangeStatus, rangeUnknown:false, interrupted:false };
      if (p.inRange) {
        if (wasOut) emit('range-return', p, { outSince:old.outSince, lastObservedOutAt:old.lastSampleAt, observationGap:gap, message:'The latest fresh read shows this position back in range. This does not mean the position is back in profit.' });
        else if (old?.rangeUnknown) emit('range-confirmed', p, {message:'The latest fresh read confirms this position is in range.'});
        entry.outSince = null; entry.dueAt = null; entry.graceNotified = false;
      } else {
        if (!wasOut || gap) {
          entry.outSince = iso(now); entry.graceNotified = false;
          if (!wasOut) emit('range-exit', p, { alreadyOutAtStart:!old, graceMinutes, firstObservedOutAt:entry.outSince, message:!old?'Already out of range when monitoring started; the actual crossing time is unknown.':'A fresh read shows this position out of range.' });
          else emit('grace-restarted', p, {graceMinutes, firstObservedOutAt:entry.outSince, message:'Still out of range after a data gap. The reminder timer has restarted; continuous range status during the gap is unknown.'});
        }
        else if (p.rangeStatus?.out != null && old.rangeStatus?.out != null && p.rangeStatus.out !== old.rangeStatus.out) emit('range-count-changed',p,{message:`${p.rangeStatus.out} of ${p.rangeStatus.total} positions in this pool are now out of range. The existing pool review timer continues.`});
        entry.dueAt = iso(Date.parse(entry.outSince) + graceMinutes * minute);
        const episodeId = p.id + ':' + entry.outSince;
        state.episodes[episodeId] = { id:episodeId, positionId:p.id, wallet, pair:p.pair, chain:p.chain, poolAddress:p.poolAddress, firstObservedOutAt:entry.outSince, lastObservedOutAt:p.fetchedAt };
        // Require an observation taken at/after the deadline. An old saved row cannot trigger an expiry.
        if (!entry.graceNotified && now >= Date.parse(entry.dueAt) && sampleTime >= Date.parse(entry.dueAt)) {
          emit('grace-expired', p, { graceMinutes, firstObservedOutAt:entry.outSince, latestReadAt:p.fetchedAt, message:'The review timer has elapsed and the latest fresh read still shows this position out of range. Decide whether to keep holding or review an exit; no action has been taken.' });
          entry.graceNotified = true;
        }
      }
      state.positions[p.id] = entry;
    }
    // Only a complete fresh wallet read may retire positions. Absence never means recovery.
    for (const [id, p] of Object.entries(state.positions)) if (p.wallet === wallet && !seen.has(id)) delete state.positions[id];
  }
  state.lastCheckedAt = iso(now);
  state.episodes = Object.fromEntries(Object.entries(state.episodes).sort((a,b)=>Date.parse(b[1].lastObservedOutAt)-Date.parse(a[1].lastObservedOutAt)).slice(0,100));
  return { state, events };
}
