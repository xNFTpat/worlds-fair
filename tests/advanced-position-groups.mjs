import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html = await readFile('public/index.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if (match[1].trim()) new vm.Script(match[1]);
const helpers = html.slice(html.indexOf('  // Presentation groups retain'), html.indexOf('  function renderHome()'));
const home = html.slice(html.indexOf('  function renderHome()'), html.indexOf('  function tile('));
const positions = html.slice(html.indexOf('  function renderPositions()'), html.indexOf('  // ---------- history ----------'));
const sumKnown = html.slice(html.indexOf('  function sumKnown('), html.indexOf('  // Presentation groups retain'));
const rows = [
  {id: 'position-first', positionAddress: 'FirstUniquePositionAddress', poolAddress: 'pool-a'},
  {id: 'position-second', positionAddress: 'SecondUniquePositionAddress', poolAddress: 'pool-b'},
  {id: 'position-third', positionAddress: 'ThirdUniquePositionAddress', poolAddress: 'pool-a'},
  {id: 'unresolved-first'}, {id: 'unresolved-second'},
].map(row => ({...row, pair: 'SAME/SOL', chain: 'solana', wallet: 'Practice', venue: 'Meteora', inRange: true, valueUsd: 1, depositedUsd: 1, depositScope: 'open-positions', feesEarnedUsd: 0}));
const nodes = new Map();
const $ = selector => {if (!nodes.has(selector)) nodes.set(selector, {innerHTML: '', hidden: false, textContent: ''}); return nodes.get(selector);};
const controlledRows = new Map(rows.map((_row, i) => ['advanced-position-row-' + i, {hidden: true}]));
const esc = text => String(text ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const context = {state: {positions: {positions: rows, balances: [{wallet: 'Practice', native: 0, symbol: 'SOL'}], sources: {'positions:Practice': {lastSuccessAt: new Date().toISOString()}}, errors: {}}}, $, esc,
  document: {getElementById: id => controlledRows.get(id)}, clientErrors: {}, window: {}, LPExperience: {miniRange: () => ''},
  sourceState: () => 'fresh', sources: () => ({}), usd: value => value == null ? null : '$' + value, num: value => String(value), signedUsd: value => value == null ? null : '$' + value,
  timeText: () => 'Now', pnlData: () => ({totalPnlUsd: 0, positionPnlUsd: 0, claimedFeesUsd: 0, unclaimedFeesUsd: 0, status: 'reconciled'}), pnlClass: () => '',
  cell: value => `<td>${value ?? '—'}</td>`, pnlCells: () => '<td>0</td><td>0</td><td>0</td><td>0</td>', held: () => '', chartPrice: String};
vm.createContext(context);
vm.runInContext(sumKnown + helpers + home + positions + '\nthis.groups = positionPoolGroups; this.toggle = togglePositionPool;', context);
const groups = context.groups(rows);
assert.equal(groups.length, 4, 'Only observed matching pool identities group; pair name and missing pool do not merge');
assert.deepEqual(Array.from(groups[0].members, member => member.index), [0, 2], 'Grouping keeps the original drawer indexes');
assert.equal(groups[0].members[0].position, rows[0]); assert.equal(groups[0].members[1].position, rows[2]);
assert.equal(rows.length, 5); assert.equal(new Set(rows.map(row => row.id)).size, 5);
context.renderPositions();
const cards = $('#homePositions').innerHTML, table = $('#posGrid tbody').innerHTML;
assert.equal((cards.match(/<details class="advanced-position-group"/g) || []).length, 4);
assert.equal((cards.match(/data-position="/g) || []).length, 5);
assert.equal((table.match(/class="position-pool-heading"/g) || []).length, 4);
assert.equal((table.match(/data-pi="/g) || []).length, 5);
for (let i = 0; i < rows.length; i++) {
  assert.ok(cards.includes(`data-position="${i}"`)); assert.ok(table.includes(`data-pi="${i}"`));
  assert.ok(cards.includes(rows[i].positionAddress || rows[i].id));
}
assert.match(table, /aria-expanded="false" aria-controls="advanced-position-row-0 advanced-position-row-2"/);
assert.match(table, /id="advanced-position-row-0" data-pi="0" hidden/);
assert.match($('#homeMetrics').innerHTML, /Open positions/); assert.match($('#posCards').innerHTML, /Open positions/);
assert.doesNotMatch($('#homeMetrics').innerHTML + $('#posCards').innerHTML, /Open LP groups/);
assert.ok(table.indexOf('data-pi="2"') < table.indexOf('data-pi="1"'), 'Table groups visually without retargeting each position');
const attributes = new Map([['aria-expanded', 'false'], ['aria-controls', 'advanced-position-row-0 advanced-position-row-2']]);
const chevron = {textContent: '▸'};
const toggle = {dataset: {positionGroupKey: groups[0].key}, getAttribute: name => attributes.get(name), setAttribute: (name, value) => attributes.set(name, value), querySelector: () => chevron};
context.toggle(toggle);
assert.equal(attributes.get('aria-expanded'), 'true'); assert.equal(chevron.textContent, '▾');
assert.equal(controlledRows.get('advanced-position-row-0').hidden, false); assert.equal(controlledRows.get('advanced-position-row-2').hidden, false);
assert.equal(controlledRows.get('advanced-position-row-1').hidden, true, 'Expanding one pool does not reveal or target another pool');
context.renderPositions();
assert.match($('#homePositions').innerHTML, /data-position-pool="[^"]+" open/);
assert.match($('#posGrid tbody').innerHTML, /id="advanced-position-row-0" data-pi="0">/);
context.toggle(toggle); assert.equal(controlledRows.get('advanced-position-row-0').hidden, true); assert.equal(attributes.get('aria-expanded'), 'false');
rows[0].pair = '<img src=x onerror=alert(1)>';
context.renderHome(); assert.ok($('#homePositions').innerHTML.includes('&lt;img')); assert.ok(!$('#homePositions').innerHTML.includes('<img'));
console.log('Advanced position groups: original IDs/indexes, separate same-pair pools, unique unresolved positions, accessible expansion and honest counts passed.');
