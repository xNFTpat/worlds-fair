import {volumeSignal} from "./volume";
import type { Pool } from './schema';

export function selectPools(pools: Pool[], q: URLSearchParams) {
  const number = (name: string) => {
    const raw = q.get(name);
    if (!raw) return 0;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name} filter`);
    return value;
  };
  const min = number('minTvl'), max = number('maxTvl'), volume = number('minVol'), age = number('maxAgeH');
  if (max && max < min) throw new Error('Maximum pool size must be at least the minimum.');
  const search = (q.get('search') || '').trim().toLowerCase();
  const watch=q.has('watch')?new Set((q.get('watch')||'').split(',').slice(0,200)):null;
  const matches = pools.filter(p =>
    (!watch || watch.has(p.id)) &&
    (!q.get('chain') || p.chain === q.get('chain')) &&
    (!q.get('venue') || p.venue === q.get('venue')) &&
    (!q.get('tag') || p.tags.includes(q.get('tag')!)) &&
    (!(min || max) || (p.tvlUsd != null && p.tvlUsd >= min && (!max || p.tvlUsd < max))) &&
    p.volume24hUsd >= volume &&
    (!age || (p.ageHours != null && p.ageHours <= age)) &&
    (!search || [p.pair, p.address, p.base.address, p.quote.address, p.base.name, p.quote.name].some(v => v?.toLowerCase().includes(search)))
  );
  const sort = q.get('sort') || 'volume24hUsd';
  const key = (p: Pool): number => {
    if (sort === 'volume30mUsd') return p.activity?.volume30m ?? -1;
    if (sort === 'volume1hUsd') return p.activity?.volume1h ?? -1;
    if (sort === 'volumeAcceleration') {const s=volumeSignal(p);return (s.latest30m??0)>=500?s.ratio??-1:-1;}
    if (sort === 'fees1hUsd') return p.activity?.fees1h ?? -1;
    if (sort === 'feeTvl1h') return p.feeTvl?.h1 ?? -1;
    if (sort === 'feeTvl4h') return p.feeTvl?.mid ?? -1;
    if (sort === 'feeTvl24h') return p.feeTvl?.h24 ?? -1;
    const value = p[sort as keyof Pool];
    return typeof value === 'number' && Number.isFinite(value) ? value : -1;
  };
  matches.sort((a, b) => key(b) - key(a) || a.id.localeCompare(b.id));
  return { pools: matches.slice(0, 300).map(p=>({...p,volumeSignal:volumeSignal(p)})), matched: matches.length, catalogued: pools.length };
}
