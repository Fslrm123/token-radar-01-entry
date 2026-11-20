// TOKEN RADAR v5 terminal: renders window.RADAR (data.js) — no fetch, no network, deterministic.
// Views: BOARD (ranked pre-token protocols), LIVE TOKENS (traded, calibration peers),
// CALIBRATION (per-category multiples), SET ASIDE (pre-token products the rule excludes, with reasons).
// The board is sortable and filterable; every row opens a detail panel with the model breakdown,
// the closest traded peers and the farm plan. Keyboard: / search, arrows move, Enter opens, Esc clears.
(function () {
  'use strict';
  var D = window.RADAR;
  var $ = function (id) { return document.getElementById(id); };

  // ---------------------------------------------------------- formatting
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) {
    if (n === null || n === undefined) return '—';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    if (n === null || n === undefined) return '<span class="neu">—</span>';
    var cls = n > 0.05 ? 'pos' : n < -0.05 ? 'neg' : 'neu';
    var sign = n > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + n.toFixed(1) + '%</span>';
  }
  function mult(n) {
    if (n === null || n === undefined) return '—';
    return n.toFixed(2) + '×';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function chainsLabel(chains) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length === 1) return esc(chains[0]);
    return esc(chains[0]) + ' +' + (chains.length - 1);
  }
  function chainsFull(chains) {
    if (!chains || chains.length === 0) return 'no chain recorded';
    if (chains.length <= 4) return esc(chains.join(', '));
    return esc(chains.slice(0, 4).join(', ')) + ' +' + (chains.length - 4) + ' more';
  }

  // ---------------------------------------------------------- state
  var params = new URLSearchParams(location.search);
  var state = {
    view: params.get('view') || 'board',
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    band: params.get('band') || '',
    tier: params.get('tier') || '',
    wl: params.get('wl') === '1',
    sortKey: params.get('sort') || 'rank',
    sortDir: params.get('dir') === 'asc' ? 1 : -1,
    slug: params.get('slug') || null,
    cursor: 0,
  };
  var maxImplied = D.rows.length ? D.rows[0].implied_value_usd : 1;

  // ---------------------------------------------------------- top stats
  function renderTop() {
    var totalImplied = D.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    $('topstats').innerHTML =
      stat('SNAPSHOT', D.as_of, 'c') +
      stat('PROTOCOLS SCANNED', D.protocol_count, '') +
      stat('WATCHLIST', D.watchlist_size, 'a') +
      stat('RANKED PRE-TOKEN', D.board_size, 'g') +
      stat('EARLY (BELOW FLOOR)', D.early_size, '') +
      stat('SET ASIDE', D.set_aside_size, '') +
      stat('TOTAL IMPLIED', money(totalImplied), 'g');
    function stat(k, v, cls) {
      return '<div class="tstat">' + k + '<b class="' + cls + '">' + esc(v) + '</b></div>';
    }
    $('formula').innerHTML =
      'MODEL <b>' + esc(D.model_version) + '</b>: implied = TVL × base × growth × maturity × chains · ' +
      'base = category mcap/TVL log-median of ' + D.calibration.global_peers + ' traded peers (shrunk, prior 3) · ' +
      'growth = 1 + clamp(7d, −60, +40)/100 × 0.5 · maturity = 0.6 + min(age,1095d)/1095 × 0.4 · chains = 1 + 0.10 × ln(chains)';
  }

  // ---------------------------------------------------------- filters
  function fillFilters() {
    var cats = {}, chains = {};
    D.rows.forEach(function (r) {
      if (r.category) cats[r.category] = (cats[r.category] || 0) + 1;
      r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; });
    });
    var catSel = $('fcat');
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c.toUpperCase() + ' (' + cats[c] + ')';
      catSel.appendChild(o);
    });
    var chainSel = $('fchain');
    Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a]; }).forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c.toUpperCase() + ' (' + chains[c] + ')';
      chainSel.appendChild(o);
    });
    $('q').value = state.q;
    catSel.value = state.cat;
    chainSel.value = state.chain;
    $('fband').value = state.band;
    $('ftier').value = state.tier;
    $('fwl').checked = state.wl;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var band = state.band ? Number(state.band) : 0;
    return D.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.tier && r.tier !== state.tier) return false;
      if (band && r.implied_value_usd < band) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  var SORTS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    category: function (r) { return (r.category || '').toLowerCase(); },
    chains: function (r) { return r.chains.length; },
    tvl: function (r) { return r.tvl_usd; },
    change: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
    age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    implied: function (r) { return r.implied_value_usd; },
    multiple: function (r) { return r.multiple; },
  };

  function sortedRows(rows) {
    var key = SORTS[state.sortKey] || SORTS.rank;
    var dir = state.sortKey === 'rank' ? 1 : state.sortDir;
    return rows.slice().sort(function (a, b) {
      var x = key(a), y = key(b);
      if (x < y) return -dir;
      if (x > y) return dir;
      return a.rank - b.rank;
    });
  }

  // ---------------------------------------------------------- table views
  var COLUMNS = [
    { key: 'rank', label: 'RK', left: true },
    { key: 'name', label: 'PROTOCOL', left: true },
    { key: 'category', label: 'CATEGORY', left: true },
    { key: 'chains', label: 'CHAINS', left: true },
    { key: 'tvl', label: 'TVL' },
    { key: 'change', label: '7D %' },
    { key: 'age', label: 'AGE' },
    { key: 'implied', label: 'IMPLIED VALUE' },
    { key: 'multiple', label: 'MULT' },
    { key: 'tier', label: 'TIER' },
  ];

  function renderHead() {
    var html = '';
    var cols = {
      board: ['c-rk', 'c-name', 'c-cat', 'c-chains', 'c-tvl', 'c-chg', 'c-age', 'c-impl', 'c-mult', 'c-tier'],
      live: ['c-rk', 'c-name', 'c-cat', 'c-chains', 'c-tvl', 'c-tvl', 'c-mult', 'c-chg'],
      calib: ['c-name', 'c-tvl', 'c-mult', 'c-mult', 'c-mult', 'c-mult'],
      aside: ['c-name', 'c-cat', 'c-tvl', 'c-name'],
    }[state.view] || [];
    $('cols').innerHTML = cols.map(function (c) { return '<col class="' + c + '">'; }).join('');
    if (state.view === 'board') {
      COLUMNS.forEach(function (c) {
        var sorted = state.sortKey === c.key;
        var arrow = sorted ? ' <span class="arrow">' + (state.sortDir > 0 ? '▲' : '▼') + '</span>' : '';
        html += '<th data-sort="' + c.key + '" class="' + (c.left ? 'l ' : '') + (sorted ? 'sorted' : '') + '">' + c.label + arrow + '</th>';
      });
    } else if (state.view === 'live') {
      html = '<th class="l">#</th><th class="l">PROTOCOL (TOKEN TRADES)</th><th class="l">CATEGORY</th><th class="l">CHAINS</th><th>TVL</th><th>MARKET CAP</th><th>MCAP / TVL</th><th>7D %</th>';
    } else if (state.view === 'calib') {
      html = '<th class="l">CATEGORY</th><th>TRADED PEERS</th><th>P25 ×</th><th>MEDIAN ×</th><th>P75 ×</th><th>BASE USED ×</th>';
    } else {
      html = '<th class="l">PROTOCOL (SET ASIDE)</th><th class="l">CATEGORY</th><th>TVL</th><th class="l">REASON</th>';
    }
    $('headrow').innerHTML = html;
    Array.prototype.forEach.call($('headrow').querySelectorAll('th[data-sort]'), function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (state.sortKey === k) state.sortDir = -state.sortDir;
        else { state.sortKey = k; state.sortDir = k === 'name' || k === 'category' ? 1 : -1; }
        render();
      });
    });
  }

  function tierChip(t) {
    return '<span class="tier tier-' + t + '">' + t + '</span>';
  }

  function boardRowHtml(r, i) {
    var w = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
    var sel = state.slug === r.slug ? ' sel' : '';
    var cur = i === state.cursor ? ' cursor' : '';
    return '<tr data-slug="' + esc(r.slug) + '" class="' + (sel + cur).trim() + '">' +
      '<td class="l rank">' + r.rank + '</td>' +
      '<td class="l"><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="wl">◆WL</span>' : '') + ' <span class="pslug">' + esc(r.slug) + '</span></td>' +
      '<td class="l cat">' + esc(r.category || '—') + '</td>' +
      '<td class="l chains">' + chainsLabel(r.chains) + '</td>' +
      '<td>' + money(r.tvl_usd) + '</td>' +
      '<td>' + pct(r.change_7d) + '</td>' +
      '<td>' + ageLabel(r.age_days) + '</td>' +
      '<td class="impl">' + money(r.implied_value_usd) + '<span class="bar"><i style="width:' + w + '%"></i></span></td>' +
      '<td class="mult">' + mult(r.multiple) + '</td>' +
      '<td>' + tierChip(r.tier) + '</td></tr>';
  }

  function renderTable() {
    renderHead();
    var html = '';
    var n = 0;
    if (state.view === 'board') {
      var rows = sortedRows(filteredRows());
      n = rows.length;
      html = rows.map(boardRowHtml).join('');
      $('count').innerHTML = 'SHOWING <b>' + n + '</b> / ' + D.board_size + ' RANKED';
    } else if (state.view === 'live') {
      n = D.live.length;
      html = D.live.map(function (r, i) {
        return '<tr data-live="' + esc(r.slug) + '"><td class="l rank">' + (i + 1) + '</td>' +
          '<td class="l"><span class="pname">' + esc(r.name) + '</span> <span class="pslug">' + esc(r.slug) + '</span></td>' +
          '<td class="l cat">' + esc(r.category || '—') + '</td>' +
          '<td class="l chains">' + chainsLabel(r.chains) + '</td>' +
          '<td>' + money(r.tvl_usd) + '</td><td>' + money(r.mcap_usd) + '</td>' +
          '<td class="mult">' + mult(r.multiple) + '</td><td>' + pct(r.change_7d) + '</td></tr>';
      }).join('');
      $('count').innerHTML = 'TOP <b>' + n + '</b> TRADED TOKENS BY MARKET CAP — CALIBRATION PEERS, NEVER RANKED';
    } else if (state.view === 'calib') {
      var c = D.calibration;
      n = c.categories.length;
      html = '<tr><td class="l"><span class="pname">ALL CATEGORIES (GLOBAL)</span></td><td>' + c.global_peers + '</td><td>' + mult(c.global_p25) + '</td><td>' + mult(c.global_median) + '</td><td>' + mult(c.global_p75) + '</td><td class="mult">' + mult(c.global_median) + '</td></tr>' +
        c.categories.map(function (r) {
          return '<tr><td class="l"><span class="pname">' + esc(r.category) + '</span></td><td>' + r.peers + '</td><td>' + mult(r.p25) + '</td><td>' + mult(r.median) + '</td><td>' + mult(r.p75) + '</td><td class="mult">' + mult(r.base) + '</td></tr>';
        }).join('');
      $('count').innerHTML = 'MCAP/TVL OF <b>' + c.global_peers + '</b> TRADED PEERS · BASE = LOG-MEDIAN SHRUNK TO GLOBAL (PRIOR 3), CLAMPED 0.05×–2.00×';
    } else {
      n = D.set_aside.length;
      html = D.set_aside.map(function (r) {
        return '<tr><td class="l"><span class="pname">' + esc(r.name) + '</span> <span class="pslug">' + esc(r.slug) + '</span></td>' +
          '<td class="l cat">' + esc(r.category || '—') + '</td><td>' + money(r.tvl_usd) + '</td>' +
          '<td class="l cat">' + esc(r.reason) + '</td></tr>';
      }).join('');
      $('count').innerHTML = '<b>' + n + '</b> PRE-TOKEN PROTOCOLS SET ASIDE BY THE NO-TOKEN RULE — NOT RANKED';
    }
    $('rows').innerHTML = html;
    $('empty').hidden = n > 0;
    Array.prototype.forEach.call($('rows').querySelectorAll('tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug')); });
    });
    Array.prototype.forEach.call($('tabs').querySelectorAll('.tab'), function (t) {
      t.classList.toggle('on', t.getAttribute('data-view') === state.view);
    });
  }

  // ---------------------------------------------------------- detail panel
  function kv(k, v, cls) {
    return '<div class="kv"><span class="k">' + k + '</span><span class="v ' + (cls || '') + '">' + v + '</span></div>';
  }

  function bandBar(r) {
    var lo = r.band_lo_usd, hi = r.band_hi_usd, mid = r.implied_value_usd;
    var span = Math.max(1, hi - lo);
    var pos = Math.round(((mid - lo) / span) * 100);
    return '<div class="bandbar"><div class="range" style="left:0;width:100%"></div><div class="mark" style="left:' + pos + '%"></div></div>' +
      '<div class="bandscale"><span>P25 ' + money(lo) + '</span><span>IMPLIED ' + money(mid) + '</span><span>P75 ' + money(hi) + '</span></div>';
  }

  function peersTable(r) {
    if (!r.peers || r.peers.length === 0) return '<div class="formula-line">No traded peer in this category; the global median prices this row.</div>';
    var rows = r.peers.map(function (p) {
      return '<tr><td class="l pn">' + esc(p.name) + '</td><td>' + money(p.tvl_usd) + '</td><td>' + money(p.mcap_usd) + '</td><td class="mult">' + mult(p.multiple) + '</td></tr>';
    }).join('');
    return '<table class="mini"><thead><tr><th class="l">TRADED PEER</th><th>TVL</th><th>MCAP</th><th>×</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function drawChart(r) {
    var cv = $('chart');
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d');
    var W = cv.width = cv.clientWidth * 2;
    var H = cv.height = 168;
    ctx.clearRect(0, 0, W, H);
    var items = (r.peers || []).map(function (p) { return { label: p.name, v: p.multiple, me: false }; });
    items.push({ label: r.name + ' (implied)', v: r.multiple, me: true });
    var max = Math.max.apply(null, items.map(function (i) { return i.v; }).concat([0.01])) * 1.15;
    var bw = W / items.length;
    ctx.font = '18px monospace';
    items.forEach(function (it, i) {
      var h = (it.v / max) * (H - 52);
      var x = i * bw + bw * 0.22, w = bw * 0.56, y = H - 26 - h;
      ctx.fillStyle = it.me ? '#00d98a' : '#2c4a6b';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = it.me ? '#00d98a' : '#8fb4d8';
      ctx.textAlign = 'center';
      ctx.fillText(it.v.toFixed(2) + '×', x + w / 2, y - 6);
      ctx.fillStyle = '#5f7186';
      var lab = it.label.length > 14 ? it.label.slice(0, 13) + '…' : it.label;
      ctx.fillText(lab, x + w / 2, H - 6);
    });
  }

  function farmHtml(r) {
    var f = r.farm;
    var head = '<div class="farm-meta">' +
      '<span class="chip">CHAIN <b>' + esc(f.chain) + '</b> (cheapest gas)</span>' +
      '<span class="chip">CAPITAL <b>$' + f.capital + '</b></span>' +
      '<span class="chip">HOLD <b>' + f.hold_days + ' DAYS</b></span>' +
      '<span class="chip">GAS/TX <b>' + (f.gas_usd < 0.1 ? '<$0.10' : '$' + f.gas_usd.toFixed(2)) + '</b></span></div>';
    var steps = f.steps.map(function (s, i) {
      return '<div class="step"><div class="step-n">' + (i + 1) + '</div><div><div class="step-t">' + esc(s.text) + '</div>' +
        '<div class="step-m"><span>COST <b>' + esc(s.cost) + '</b></span><span>TIME <b>' + esc(s.time) + '</b></span></div></div></div>';
    }).join('');
    return head + steps;
  }

  function renderDetail() {
    var el = $('detail');
    var r = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === state.slug) { r = D.rows[i]; break; }
    if (!r) {
      el.innerHTML = '<div class="d-none"><div class="big">NO SIGNAL</div>SELECT A PROTOCOL<br>CLICK A ROW OR USE ↑ ↓ + ↵</div>';
      return;
    }
    el.innerHTML =
      '<div class="d-head"><div class="d-rank">RANK #' + r.rank + ' / ' + D.board_size + ' · TIER ' + r.tier + (r.watchlist ? ' · <span class="wl">◆ WATCHLIST</span>' : ' · EARLY RADAR') + '</div>' +
      '<div class="d-name">' + esc(r.name) + '</div>' +
      '<div class="d-sub">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + ' · ' + chainsFull(r.chains) + '</div>' +
      '<div class="d-value"><div class="lab">IMPLIED LAUNCH VALUE</div><div class="big">' + moneyFull(r.implied_value_usd) + '</div>' +
      '<div class="d-band">band <b>' + money(r.band_lo_usd) + '</b> – <b>' + money(r.band_hi_usd) + '</b> (peer p25–p75) · multiple <b>' + mult(r.multiple) + '</b> of TVL</div></div>' +
      bandBar(r) + '</div>' +
      '<div class="d-sec"><h3><b>▸</b> SNAPSHOT RECORD</h3>' +
      kv('TVL', moneyFull(r.tvl_usd)) +
      kv('TVL CHANGE 7D', pct(r.change_7d)) +
      kv('LISTED', esc(r.listed_at || '—') + ' · ' + ageLabel(r.age_days) + ' old') +
      kv('CHAINS', r.chains.length + ' — ' + chainsFull(r.chains)) +
      kv('TOKEN', 'records no token', 'a') + '</div>' +
      '<div class="d-sec"><h3><b>▸</b> MODEL BREAKDOWN</h3>' +
      kv('BASE (category ×)', mult(r.base_multiple), 'c') +
      kv('GROWTH (7d ' + (r.growth_pct > 0 ? '+' : '') + r.growth_pct.toFixed(1) + '%)', '×' + r.growth_multiplier.toFixed(3)) +
      kv('MATURITY', '×' + r.maturity_multiplier.toFixed(3)) +
      kv('CHAINS (log)', '×' + r.chain_multiplier.toFixed(3)) +
      kv('PEERS BEHIND BASE', r.peer_count) +
      '<div class="formula-line">' + money(r.tvl_usd) + ' × <b>' + mult(r.base_multiple) + '</b> × <b>' + r.growth_multiplier.toFixed(2) + '</b> × <b>' + r.maturity_multiplier.toFixed(2) + '</b> × <b>' + r.chain_multiplier.toFixed(2) + '</b> = <b>' + money(r.implied_value_usd) + '</b></div></div>' +
      '<div class="d-sec"><h3><b>▸</b> CLOSEST TRADED PEERS</h3>' + peersTable(r) +
      '<canvas class="chart" id="chart"></canvas>' +
      '<div class="formula-line">mcap/TVL of the nearest traded peers vs this protocol\'s implied multiple (green).</div></div>' +
      '<div class="d-sec" id="farm"><h3><b>▸</b> FARM PLAN — ' + r.farm.steps.length + ' STEPS</h3>' + farmHtml(r) + '</div>';
    drawChart(r);
    if (params.get('focus') === 'farm') {
      var farmEl = $('farm');
      if (farmEl) farmEl.scrollIntoView();
    }
  }

  // ---------------------------------------------------------- interaction
  function select(slug) {
    state.slug = slug;
    render();
  }

  function render() {
    renderTable();
    renderDetail();
  }

  function bind() {
    $('q').addEventListener('input', function (e) { state.q = e.target.value; state.cursor = 0; render(); });
    $('fcat').addEventListener('change', function (e) { state.cat = e.target.value; state.cursor = 0; render(); });
    $('fchain').addEventListener('change', function (e) { state.chain = e.target.value; state.cursor = 0; render(); });
    $('fband').addEventListener('change', function (e) { state.band = e.target.value; state.cursor = 0; render(); });
    $('ftier').addEventListener('change', function (e) { state.tier = e.target.value; state.cursor = 0; render(); });
    $('fwl').addEventListener('change', function (e) { state.wl = e.target.checked; state.cursor = 0; render(); });
    Array.prototype.forEach.call($('tabs').querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () { state.view = t.getAttribute('data-view'); state.cursor = 0; render(); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); return; }
      if (e.key === 'Escape') {
        state.q = ''; state.cat = ''; state.chain = ''; state.band = ''; state.tier = ''; state.wl = false; state.slug = null;
        $('q').value = ''; $('fcat').value = ''; $('fchain').value = ''; $('fband').value = ''; $('ftier').value = ''; $('fwl').checked = false;
        render(); return;
      }
      if (state.view !== 'board') return;
      var rows = sortedRows(filteredRows());
      if (e.key === 'ArrowDown') { e.preventDefault(); state.cursor = Math.min(rows.length - 1, state.cursor + 1); render(); scrollCursor(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); state.cursor = Math.max(0, state.cursor - 1); render(); scrollCursor(); }
      else if (e.key === 'Enter' && rows[state.cursor]) { select(rows[state.cursor].slug); }
    });
  }

  function scrollCursor() {
    var tr = $('rows').querySelector('tr.cursor');
    if (tr) tr.scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------- init
  renderTop();
  fillFilters();
  bind();
  render();
})();
