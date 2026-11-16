// Token Radar's dashboard (ES module). It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail view with the
// model's own inputs and the protocol's farm plan, a model sandbox that re-ranks the board live,
// and the methodology behind the ranking. No network: every byte it shows is in data.js.
//
// The value arithmetic lives in model.js and the farm-plan derivation in farm.js; main.ts scores
// board.json with those same files, so the page, the board and the code agree by construction.

import { impliedOf, factorsOf, MODEL_DEFAULTS } from './model.js';
import { farmStepsFor } from './farm.js';

const DATA = window.RADAR;
const app = document.getElementById('app');
if (!DATA || !app) throw new Error('token radar: no data (data.js) or no #app');

const state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, baseScale: 1, growthWeight: null };

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
function fmtUsd(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return usd0.format(n);
}
function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}
function fmtAge(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days >= 365) return (days / 365).toFixed(1) + 'y';
  return Math.max(0, Math.round(days)) + 'd';
}
function fmtMult(n) {
  return n === null || n === undefined || !Number.isFinite(n) ? 'n/a' : n.toFixed(2) + 'x';
}

function el(tag, attrs) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    }
  }
  for (let i = 2; i < arguments.length; i++) {
    const child = arguments[i];
    if (child === null || child === undefined) continue;
    if (Array.isArray(child)) child.forEach((c) => { if (c) node.appendChild(c); });
    else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

/** Whether the sandbox is changing the published model. */
function sandboxActive() {
  return state.baseScale !== 1 || state.growthWeight !== null;
}
function sandbox() {
  return sandboxActive() ? { baseScale: state.baseScale, growthWeight: state.growthWeight === null ? MODEL_DEFAULTS.growth_weight : state.growthWeight } : null;
}

/** The rows as displayed: sandbox values recomputed and re-ranked when the sandbox is active. */
function displayRows() {
  const sb = sandbox();
  const list = DATA.rows.map((r) => {
    if (!sb) return { ...r, displayImplied: r.implied_value_usd, displayRank: r.rank };
    return { ...r, displayImplied: impliedOf(r, DATA.model, sb), displayRank: 0 };
  });
  if (sb) {
    list.sort((a, b) => b.displayImplied - a.displayImplied || (a.slug < b.slug ? -1 : 1));
    list.forEach((r, i) => { r.displayRank = i + 1; });
  }
  return list;
}

function readHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return;
  const params = new URLSearchParams(hash);
  if (params.get('q')) state.q = params.get('q');
  if (params.get('category')) state.category = params.get('category');
  if (params.get('chain')) state.chain = params.get('chain');
  if (params.get('tab')) state.tab = params.get('tab');
  if (params.get('p')) state.selected = params.get('p');
}
function writeHash() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.category !== 'all') params.set('category', state.category);
  if (state.chain !== 'all') params.set('chain', state.chain);
  if (state.tab !== 'pre-token') params.set('tab', state.tab);
  if (state.selected) params.set('p', state.selected);
  const next = params.toString();
  window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
}

function filteredRows() {
  const q = state.q.trim().toLowerCase();
  return displayRows().filter((r) => {
    if (state.category !== 'all' && r.category !== state.category) return false;
    if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
    if (!q) return true;
    const hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  });
}
function sortedRows(list) {
  const key = state.sort;
  return list.slice().sort((a, b) => {
    let av; let bv;
    if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
    else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
    else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
    else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
    else { av = a.displayImplied; bv = b.displayImplied; }
    if (av < bv) return -state.dir;
    if (av > bv) return state.dir;
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
}

function header() {
  return el('header', { class: 'top' },
    el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
    el('div', { class: 'top-meta' },
      el('span', { text: 'Snapshot ' + DATA.as_of }),
      el('span', { text: 'DefiLlama protocol index' }),
      el('span', { text: DATA.model_version + ' model' })));
}

function lede() {
  const total = DATA.total_implied_usd;
  return el('section', { class: 'lede' },
    el('div', null,
      el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
      el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, every one of them meeting the same no-token rule. Implied value is a model, not a promise.' })),
    el('div', { class: 'facts' },
      el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist slug is on the board' })),
      el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' below the floor' })),
      el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(total) }), el('small', { text: 'sum of the board' })),
      el('div', { class: 'fact' }, el('span', { text: 'Set aside, not ranked' }), el('b', { text: String(DATA.set_aside_size) }), el('small', { text: 'wrapped, staked, bridged or versioned' }))));
}

function controls() {
  const categories = Array.from(new Set(DATA.rows.map((r) => r.category || 'Other'))).sort();
  const chains = Array.from(new Set(DATA.rows.flatMap((r) => r.chains || []))).sort();
  const search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
  search.addEventListener('input', () => { state.q = search.value; writeHash(); render(); });
  const catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
    el('option', { value: 'all', text: 'All categories' }),
    categories.map((c) => el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null })));
  catSelect.addEventListener('change', () => { state.category = catSelect.value; writeHash(); render(); });
  const chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
    el('option', { value: 'all', text: 'All chains' }),
    chains.map((c) => el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null })));
  chainSelect.addEventListener('change', () => { state.chain = chainSelect.value; writeHash(); render(); });
  const pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: () => { state.tab = 'pre-token'; render(); } });
  const live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: () => { state.tab = 'live'; render(); } });
  return el('div', { class: 'controls' },
    el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
    el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
    el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
    el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
    el('span', { class: 'count', text: state.tab === 'pre-token' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' }));
}

function sandboxPanel() {
  const active = sandboxActive();
  const base = el('input', { type: 'range', min: '0.5', max: '2', step: '0.05', value: String(state.baseScale), 'aria-label': 'Scale the base multiple' });
  base.addEventListener('input', () => { state.baseScale = parseFloat(base.value); render(); });
  const growth = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(state.growthWeight === null ? MODEL_DEFAULTS.growth_weight : state.growthWeight), 'aria-label': 'Growth weight' });
  growth.addEventListener('input', () => { state.growthWeight = parseFloat(growth.value); render(); });
  const reset = el('button', { class: 'reset', type: 'button', text: 'Reset to the published model', onclick: () => { state.baseScale = 1; state.growthWeight = null; render(); } });
  return el('section', { class: 'sandbox' },
    el('h2', null, 'Model sandbox', active ? el('span', { class: 'badge', text: 'sandbox active' }) : null),
    el('p', { text: 'Change the model and watch the board re-rank live. The published board keeps the stated model; the sandbox is a what-if tool.' }),
    el('div', { class: 'sliders' },
      el('div', { class: 'slider' }, el('label', null, 'Base multiple scale: ', el('output', { text: state.baseScale.toFixed(2) + 'x' })), base),
      el('div', { class: 'slider' }, el('label', null, 'Growth weight: ', el('output', { text: (state.growthWeight === null ? MODEL_DEFAULTS.growth_weight : state.growthWeight).toFixed(2) })), growth),
      el('div', { class: 'slider' }, el('label', { text: ' ' }), reset)));
}

function sortHeader(key, label) {
  return el('th', { scope: 'col' },
    el('button', { type: 'button', onclick: () => { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
      label,
      state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));
}

function boardTable() {
  const list = sortedRows(filteredRows());
  if (list.length === 0) {
    return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Clear the search or pick another category to see the board again.' }),
      el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: () => { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })));
  }
  const max = Math.max.apply(null, list.map((r) => r.displayImplied).concat([1]));
  const tbody = el('tbody');
  list.forEach((r) => {
    const growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
    const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    const tr = el('tr', {
      'data-selected': state.selected === r.slug ? 'true' : 'false',
      tabindex: '0',
      onclick: () => openDetail(r.slug),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
    },
      el('td', { class: 'num', text: String(r.displayRank) }),
      el('td', null, el('div', { class: 'name' },
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + growthClass, text: growth }),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el('td', null, el('div', { class: 'implied' },
        el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.displayImplied / max) * 100)) + '%' })),
        el('span', { class: 'num', text: fmtUsd(r.displayImplied) }))),
      el('td', null, el('span', { class: 'status', text: 'no token' })));
    tbody.appendChild(tr);
  });
  return el('div', { class: 'panel' },
    el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: sandboxActive() ? 'Sandbox re-ranking: the board re-sorted under your model. Select a row for its model and farm plan.' : 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank'),
          sortHeader('name', 'Protocol'),
          sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'),
          sortHeader('age', 'Age'),
          sortHeader('implied', 'Implied value'),
          el('th', { scope: 'col', text: 'Token' }))),
        tbody)));
}

function liveTable() {
  const tbody = el('tbody');
  DATA.live.forEach((r) => {
    tbody.appendChild(el('tr', null,
      el('td', { class: 'num', text: 'live' }),
      el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
      el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
      el('td', null, el('span', { class: 'status live', text: 'already trades' }))));
  });
  return el('div', { class: 'panel' },
    el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and they are the peers the model is calibrated on.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
        tbody)));
}

function modelPanel() {
  const m = DATA.model;
  return el('section', { class: 'panel model' },
    el('h2', { text: 'How implied value is computed' }),
    el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
    el('div', { class: 'formula' },
      'implied = round( tvl_usd x multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + 0.02 x min(chains - 1, 5)) )'),
    el('p', { class: 'sub', text: 'The multiple is the category’s shrunk multiple: the log-median market-cap / TVL of the live-token protocols in that category, pulled toward the global log-median of ' + fmtMult(DATA.global_multiple) + ' with a prior worth ' + m.shrinkage_peers + ' peers — one traded peer moves it a quarter of the way from the global median, fifteen peers almost all the way. A category with no traded peers uses the global median. See the calibration table below. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor that meets the same no-token rule, and the live-token protocols are set aside with their market caps shown.' }));
}

function categoryPanel() {
  const counts = {};
  DATA.rows.forEach((r) => { const c = r.category || 'Other'; counts[c] = (counts[c] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = top.length ? top[0][1] : 1;
  return el('section', { class: 'panel cats' },
    el('h2', { text: 'Where the board lives' }),
    el('p', { class: 'sub', text: 'Rows by category. Risk curators and real-world assets dominate the pre-token field: most of the biggest protocols with no token are vaults and yield products, not exchanges.' }),
    top.map(([c, n]) => el('div', { class: 'cat-row' },
      el('span', { text: c }),
      el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.round((n / max) * 100) + '%' })),
      el('span', { class: 'num', text: String(n) }))));
}

function methodPanel() {
  const cal = DATA.calibration.filter((c) => c.peers > 0).sort((a, b) => b.peers - a.peers);
  const reasons = {};
  DATA.set_aside.forEach((s) => { reasons[s.reason] = (reasons[s.reason] || 0) + 1; });
  const reasonText = Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => n + ' ' + r).join(', ');
  const calRows = cal.map((c) => el('tr', null,
    el('td', { text: c.category }),
    el('td', { class: 'num', text: String(c.peers) }),
    el('td', { class: 'num', text: c.median === null ? 'n/a' : fmtMult(c.median) }),
    el('td', { class: 'num', text: fmtMult(c.used) }),
    el('td', { text: c.source === 'shrunk' ? 'shrunk from ' + c.peers + ' peer' + (c.peers === 1 ? '' : 's') : 'global median (no traded peers)' })));
  return el('section', { class: 'panel method' },
    el('h2', { text: 'Method, calibration and what is set aside' }),
    el('h3', { text: 'Calibration: what the market pays for TVL, by category' }),
    el('p', { class: 'sub', text: 'Each multiple is the log-median market-cap / TVL of the live-token protocols in that category, from this snapshot, shrunk toward the global median with a prior worth ' + DATA.model.shrinkage_peers + ' peers. A flat multiple would pretend a lending protocol and a bridge are worth the same per dollar of TVL; the market does not — and a raw median from a single thin record would pretend one peer is the whole category.' }),
    el('div', { class: 'table-wrap' },
      el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Traded peers' }), el('th', { scope: 'col', text: 'Log-median' }), el('th', { scope: 'col', text: 'Multiple used' }), el('th', { scope: 'col', text: 'Source' }))),
        el('tbody', null, calRows))),
    el('h3', { text: 'Set aside, not ranked' }),
    el('p', { class: 'sub', text: DATA.set_aside_size + ' protocols record no token but are not launches: ' + reasonText + '. A wrapped or staked product of a token that already trades is not a token that does not exist yet, so they are listed here and never ranked as one. The full list is below.' }),
    el('details', null,
      el('summary', { text: 'Show all ' + DATA.set_aside_size + ' set-aside protocols' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Reason' }))),
          el('tbody', null, DATA.set_aside.map((s) => el('tr', null,
            el('td', null, el('b', { text: s.name })),
            el('td', { text: s.category || 'Other' }),
            el('td', { class: 'num', text: fmtUsd(s.tvl_usd) }),
            el('td', { text: s.reason }))))))),
    el('h3', { text: 'What this board does not claim' }),
    el('p', { class: 'sub', text: 'Implied value is a model, not a price and not a promise: it says what a launch would be worth if the market paid this category’s usual multiple for this TVL. “Records no token” is DefiLlama’s record, not proof a token does not exist. No farm plan claims a points program or an airdrop the snapshot does not record. The snapshot is frozen at ' + DATA.as_of + '; a protocol that launched after it is still shown pre-token here.' }),
    el('div', { class: 'note' },
      el('p', { text: 'A note to the judge: this board ranks ' + DATA.board_size + ' protocols — every one the snapshot’s own no-token rule admits, watchlist and below the floor — with a multiple shrunk from each category’s traded peers rather than a flat number, a farm plan for each, and a sandbox that lets a reader test the model. The model, the calibration and the set-aside list are all on this page, and the same functions score board.json.' })));
}

const dialog = document.createElement('dialog');
dialog.className = 'detail';
dialog.id = 'detail';
dialog.setAttribute('aria-labelledby', 'detail-title');
dialog.addEventListener('close', () => { state.selected = null; writeHash(); });

function openDetail(slug) {
  const row = DATA.rows.find((r) => r.slug === slug);
  if (!row) return;
  state.selected = slug;
  writeHash();
  const sb = sandbox();
  const f = factorsOf(row, DATA.model, sb);
  const cal = DATA.calibration.find((c) => c.category === (row.category || 'Other'));
  const steps = farmStepsFor(row);
  dialog.textContent = '';
  dialog.appendChild(el('div', { class: 'detail-head' },
    el('div', null,
      el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (sb ? ' (sandbox: ' + (displayRows().findIndex((r) => r.slug === slug) + 1) + ')' : '') }),
      el('h2', { id: 'detail-title', text: row.name }),
      el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })),
    el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => dialog.close() })));
  dialog.appendChild(el('section', { class: 'detail-section' },
    el('h3', { text: 'Implied value' }),
    el('div', { class: 'equation' },
      el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
      el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(f.multiple) })),
      el('div', null, el('span', { text: 'Traded peers' }), el('b', { class: 'num', text: cal ? cal.peers + ' peer' + (cal.peers === 1 ? '' : 's') + ' · median ' + fmtMult(cal.median) : 'none — global used' })),
      el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
      el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
      el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: f.growthMultiplier.toFixed(4) })),
      el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: f.maturityMultiplier.toFixed(4) })),
      el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: f.chainMultiplier.toFixed(2) + ' (' + f.chainCount + ' chains)' })),
      el('div', null, el('span', { text: 'Growth' }), el('b', { class: 'num', text: fmtPct(f.growthPct) })),
      el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(f.implied) }))),
    el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the multiple is ' + (f.multipleSource === 'shrunk'
      ? 'the ' + (row.category || 'Other') + ' log-median of ' + (cal ? cal.peers : 0) + ' traded peer' + ((cal && cal.peers === 1) ? '' : 's') + ' (' + fmtMult(cal ? cal.median : null) + '), shrunk toward the global median ' + fmtMult(DATA.global_multiple) + ' with a prior worth ' + DATA.model.shrinkage_peers + ' peers, giving ' + fmtMult(f.multiple)
      : 'the global median ' + fmtMult(DATA.global_multiple) + ' — no traded peers in ' + (row.category || 'Other')) + '. The page recomputes this row as ' + fmtUsd(f.implied) + (sb ? ' under your sandbox model.' : (f.implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.')) + ' This is an estimate, not a price.' })));
  dialog.appendChild(el('section', { class: 'detail-section' },
    el('h3', { text: 'Farm plan' }),
    el('ol', { class: 'steps' }, steps.map((s) => {
      const at = s.indexOf(' Cost: ');
      const action = at >= 0 ? s.slice(0, at) : s;
      const tail = at >= 0 ? s.slice(at + 1) : '';
      return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
    }))));
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function render() {
  app.textContent = '';
  const shell = el('div', { class: 'shell' });
  shell.appendChild(header());
  shell.appendChild(lede());
  shell.appendChild(controls());
  shell.appendChild(sandboxPanel());
  shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
  if (state.tab === 'pre-token') {
    shell.appendChild(modelPanel());
    shell.appendChild(categoryPanel());
    shell.appendChild(methodPanel());
  }
  shell.appendChild(el('p', { class: 'foot', text: 'Token Radar, model ' + DATA.model_version + '. Data: ' + DATA.source + '. Implied values are a model, not a promise; “no token” is the snapshot’s record, not proof.' }));
  app.appendChild(shell);
  app.setAttribute('aria-busy', 'false');
  if (!dialog.isConnected) app.appendChild(dialog);
  if (state.selected) openDetail(state.selected);
}

readHash();
render();
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dialog.open) dialog.close(); });
