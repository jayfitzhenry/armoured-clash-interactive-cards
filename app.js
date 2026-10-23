/* Armoured Clash unit cards — static app, no build step. */
(() => {
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('acc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('acc.' + k, JSON.stringify(v)); } catch {} }
};
const CATS = ['Command','Infantry','Fireteam','Cavalry','Field Gun','Armour','Carriage','Walker','Artillery','Fortification','Rotorcraft','Aircraft'];
const STRENGTH_SHORT = {Basic:'Basic', Reinforced:'Reinf.', Full:'Full'};

const S = {
  units: [], gloss: [], byId: {},
  faction: store.get('faction', 'All'),
  tab: 'units',
  q: '',
  cats: new Set(),
  gkind: 'all',
  sort: store.get('sort', 'orbat'),
  sel: null,           // open unit id
  selEntry: null,      // force entry key the card was opened from
  force: store.get('force', []),
  score: store.get('score', null),   // {f: [mine, opp], vp: [[mine, opp], ...per round], r: current round index}
  visible: []          // ids in current list order (for prev/next)
};

/* ---------- helpers ---------- */
const baseName = s => s.toLowerCase().replace(/[”"]/g,'').replace(/\(.*?\)/g,'').replace(/\s+/g,' ').trim().replace(/s$/,'');
const glossFor = name => {
  const b = baseName(name);
  return S.gloss.find(g => baseName(g.name) === b);
};
const terms = () => S.q.toLowerCase().split(/\s+/).filter(Boolean);
const hl = (text, ts = terms()) => {
  let out = esc(text);
  if (!ts.length) return out;
  const re = new RegExp('(' + ts.map(t => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return out.replace(re, '<mark>$1</mark>');
};
const attr = (u, label) => (u.attributes.find(a => a.label === label) || {}).value ?? '-';
const ptsRange = u => {
  const all = u.variants.flatMap(v => v.points).filter(n => n != null);
  const lo = Math.min(...all), hi = Math.max(...all);
  return lo === hi ? `${lo}` : `${lo}–${hi}`;
};
const minPts = u => Math.min(...u.variants.flatMap(v => v.points).filter(n => n != null));
const basicIdx = u => Math.max(0, u.strengths.indexOf('Basic'));
const narrow = () => matchMedia('(max-width:959px)').matches;
// Back to the top of the list, but no further than where the phone header tucks away.
const toTop = () => {
  const tuck = narrow() ? -parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr-tuck')) || 0 : 0;
  if (scrollY > tuck) scrollTo(0, tuck);
};
// Pass an undo function to give the toast an Undo button (and a longer life).
const toast = (msg, undo) => {
  const t = $('#toast');
  t.innerHTML = esc(msg) + (undo ? ' <button data-undo>Undo</button>' : '');
  toast.undo = undo; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; toast.undo = null; }, undo ? 5000 : 1800);
};
// Snapshot force and score, run a destructive change, then offer to put things back.
function undoable(msg, fn) {
  const before = JSON.stringify({force: S.force, score: S.score});
  fn(); render();
  toast(msg, () => { const b = JSON.parse(before); S.force = b.force; S.score = b.score; saveForce(); saveScore(); render(); });
}

function buildIndex(u) {
  const ruleText = u.rules.map(r => r.name + ' ' + r.blocks.map(b => b.type === 'p' ? b.text : b.rows.flat().join(' ')).join(' ')).join(' ');
  u._key = [u.name, u.faction, u.categories.join(' '), u.traits.join(' '), u.specialRules.join(' '), u.commandVariant || '',
            u.armament.map(a => a.name + ' ' + a.qualities.join(' ')).join(' ')].join(' ').toLowerCase();
  u._text = ruleText.toLowerCase();
  u._quals = [...new Set(u.armament.flatMap(a => a.qualities))];
}

function matchUnit(u, ts) {
  if (!ts.length) return {ok: true, score: 0};
  let score = 0, deep = [];
  for (const t of ts) {
    if (u.name.toLowerCase().includes(t)) score += 10;
    else if (u._key.includes(t)) score += 4;
    else if (u._text.includes(t)) { score += 1; deep.push(t); }
    else return {ok: false};
  }
  let why = '';
  if (deep.length) {
    const r = u.rules.find(r => deep.every(t => (r.name + ' ' + JSON.stringify(r.blocks)).toLowerCase().includes(t)));
    why = r ? `rule text: ${r.name}` : 'rule text';
  }
  return {ok: true, score, why};
}

function filtered() {
  const ts = terms();
  let list = S.units
    .filter(u => S.faction === 'All' || u.faction === S.faction)
    .filter(u => !S.cats.size || u.categories.some(c => S.cats.has(c)))
    .map(u => ({u, m: matchUnit(u, ts)}))
    .filter(x => x.m.ok);
  const sorters = {
    orbat: (a, b) => a.u.faction.localeCompare(b.u.faction) || a.u.page - b.u.page,
    name: (a, b) => a.u.name.localeCompare(b.u.name),
    size: (a, b) => (+a.u.size) - (+b.u.size) || a.u.name.localeCompare(b.u.name),
    points: (a, b) => minPts(a.u) - minPts(b.u)
  };
  list.sort(sorters[S.sort]);
  if (ts.length) list.sort((a, b) => b.m.score - a.m.score);
  return list;
}

/* ---------- force ---------- */
const forceCount = id => S.force.filter(e => e.u === id).length;
const entryPts = e => { const u = S.byId[e.u]; return u ? u.variants[e.v]?.points[e.s] ?? 0 : 0; };
const entryVpr = e => {
  const u = S.byId[e.u]; if (!u) return 0;
  const base = parseInt(u.vpr[e.s], 10) || 0;
  return base + (e.v > 0 && u.commandVariant && /\+1 VPR/.test(u.commandVariant) ? 1 : 0);
};
function saveForce() { store.set('force', S.force); $('#forceCount').textContent = S.force.length; }
function addToForce(id) {
  const u = S.byId[id];
  S.force.push({k: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), u: id, s: basicIdx(u), v: 0});
  saveForce(); toast(`${u.name} added to your force`); render();
}
function removeOne(id) {
  const i = S.force.map(e => e.u).lastIndexOf(id);
  if (i > -1) undoable(`${S.byId[id].name} removed`, () => { S.force.splice(i, 1); saveForce(); });
}
function shareForce() {
  const code = S.force.map(e => `${e.u}~${e.s}~${e.v}`).join(',');
  const url = location.href.split('#')[0] + '#force=' + encodeURIComponent(code);
  if (navigator.share) navigator.share({title: 'My Armoured Clash force', url}).catch(() => {});
  else navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => prompt('Copy this link', url));
}
function importFromHash() {
  const m = location.hash.match(/force=([^&]+)/);
  if (!m) return;
  const entries = decodeURIComponent(m[1]).split(',').map(s => s.split('~')).filter(p => S.byId[p[0]])
    .map(([u, s, v], i) => ({k: 'i' + i + Date.now().toString(36), u, s: +s || 0, v: +v || 0}));
  history.replaceState(null, '', location.pathname + location.search);
  if (!entries.length) return;
  if (!S.force.length || confirm(`Replace your current force with the shared one (${entries.length} units)?`)) {
    S.force = entries; saveForce(); S.tab = 'force';
  }
}

/* ---------- score ---------- */
const allFactions = () => [...new Set(S.units.map(u => u.faction))].sort();
function newScore() {
  const fs = allFactions();
  const forceF = S.byId[S.force[0]?.u]?.faction;
  const mine = S.faction !== 'All' ? S.faction : forceF || fs[0];
  return {f: [mine, S.score?.f[1] ?? fs.find(f => f !== mine)], vp: [[0, 0]], r: 0};
}
// Stored scores can come from older builds or a hand-edited localStorage: rebuild anything malformed.
function checkScore() {
  const sc = S.score, fs = allFactions();
  const ok = sc && Array.isArray(sc.f) && sc.f.length === 2 && Array.isArray(sc.vp) && sc.vp.length
    && sc.vp.every(r => Array.isArray(r) && r.length === 2 && r.every(n => Number.isInteger(n) && n >= 0));
  if (!ok) { S.score = null; S.score = newScore(); return saveScore(); }
  sc.f = sc.f.map((f, i) => fs.includes(f) ? f : fs[i] ?? fs[0]);
  sc.r = Math.min(Math.max(0, sc.r | 0), sc.vp.length - 1);
}
function saveScore() { store.set('score', S.score); }
const scoreTot = i => S.score.vp.reduce((a, r) => a + r[i], 0);
function goRound(r) {
  const sc = S.score;
  if (r < 0) return;
  if (r === sc.vp.length) sc.vp.push([0, 0]);
  sc.r = Math.min(r, sc.vp.length - 1);
  // Drop untouched rounds after the one being viewed, so a stray "next round" tap can be undone by going back.
  while (sc.vp.length - 1 > sc.r && !sc.vp.at(-1)[0] && !sc.vp.at(-1)[1]) sc.vp.pop();
  saveScore(); render();
}

/* ---------- rendering: header bits ---------- */
function renderFactions() {
  const fs = [...new Set(S.units.map(u => u.faction))].sort();
  if (S.faction !== 'All' && !fs.includes(S.faction)) S.faction = 'All';
  $('#factions').innerHTML = [['All', 'All factions'], ...fs.map(f => [f, f])]
    .map(([f, l]) => `<button data-faction="${esc(f)}" ${f !== 'All' ? `data-f="${esc(f)}"` : ''} aria-pressed="false">${f !== 'All' ? '<i></i>' : ''}${esc(l)}</button>`).join('');
}
function renderHeader() {
  document.querySelectorAll('.faction-switch button').forEach(b => b.setAttribute('aria-pressed', b.dataset.faction === S.faction));
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  $('#forceCount').textContent = S.force.length;
  const f = $('#filters');
  if (S.tab === 'rules') {
    const kinds = [['all','Everything'],['Special Rule','Special rules'],['Weapon Quality','Weapon qualities'],['force','Used by my force']];
    f.innerHTML = kinds.map(([k, l]) => `<button class="chip" data-gkind="${k}" aria-pressed="${S.gkind === k}">${l}</button>`).join('');
  } else if (S.tab === 'score') {
    f.innerHTML = '';
  } else {
    const present = new Set(S.units.filter(u => S.faction === 'All' || u.faction === S.faction).flatMap(u => u.categories));
    f.innerHTML = CATS.filter(c => present.has(c)).map(c => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${S.cats.has(c)}">${c}</button>`).join('')
      + (S.cats.size || S.q ? `<span class="sep"></span><button class="chip clear" data-clear>Clear filters</button>` : '');
  }
  measureHeader();
  document.querySelector('.faction-switch [aria-pressed=true]')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  fades();
}
// Fade the edge of a sideways-scrolling chip row while there is more to see in that direction.
function fades() {
  document.querySelectorAll('.faction-switch, .filters').forEach(el => {
    el.classList.toggle('more-r', el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    el.classList.toggle('more-l', el.scrollLeft > 2);
  });
}
function measureHeader() {
  const root = document.documentElement.style;
  root.setProperty('--hdr', $('.top').offsetHeight + 12 + 'px');
  // On phones the title row scrolls away; search, tabs and filters stay pinned.
  root.setProperty('--hdr-tuck', -($('.search-row').offsetTop - 8) + 'px');
}

/* ---------- rendering: lists ---------- */
function rowHTML(u, why) {
  const n = forceCount(u.id);
  return `<li class="row" data-id="${u.id}" data-f="${u.faction}" ${S.sel === u.id ? 'aria-current="true"' : ''} tabindex="0">
    ${u.img ? `<img src="${u.img}" alt="" loading="lazy" width="56" height="44">` : '<span class="noimg"></span>'}
    <div class="row-main">
      <p class="row-name">${hl(u.name)}</p>
      <div class="row-sub">${why ? hl(why) : esc(u.categories.join(', ') + (S.faction === 'All' ? ', ' + u.faction : ''))}</div>
      <div class="row-stats"><span>Spd <b>${esc(attr(u,'Speed'))}</b></span><span>Def <b>${esc(attr(u,'Defence'))}</b></span><span>DL <b>${esc(attr(u,'Damage Limit'))}</b></span><span>Disc <b>${esc(attr(u,'Discipline'))}</b></span><span><b>${ptsRange(u)}</b> pts</span></div>
    </div>
    <button class="add" data-add="${u.id}" aria-pressed="${n > 0}" aria-label="Add ${esc(u.name)} to my force" title="Add to my force">${n ? `<span class="n">${n}</span>` : '+'}</button>
  </li>`;
}

function renderUnits() {
  const list = filtered();
  S.visible = list.map(x => x.u.id);
  const pane = $('#listPane');
  if (!list.length) {
    pane.innerHTML = `<div class="empty">No units match${S.q ? ` “${esc(S.q)}”` : ''}${S.cats.size ? ' in the selected categories' : ''}.<br><button class="btn" data-clear>Clear search and filters</button></div>`;
    return;
  }
  pane.innerHTML = `<div class="meta-line"><span>${list.length} unit${list.length > 1 ? 's' : ''}</span>
    <label>Sort <select id="sort">${[['orbat','ORBAT order'],['name','Name'],['size','Size'],['points','Points']].map(([v,l]) => `<option value="${v}" ${S.sort===v?'selected':''}>${l}</option>`).join('')}</select></label></div>
    <ul class="rows">${list.map(x => rowHTML(x.u, x.m.why)).join('')}</ul>`;
}

function renderForce() {
  const pane = $('#listPane');
  const ts = terms();
  const entries = S.force.filter(e => S.byId[e.u]).filter(e => {
    const u = S.byId[e.u];
    return (S.faction === 'All' || u.faction === S.faction) && (!S.cats.size || u.categories.some(c => S.cats.has(c))) && matchUnit(u, ts).ok;
  });
  S.visible = [...new Set(entries.map(e => e.u))];
  if (!S.force.length) {
    pane.innerHTML = `<div class="empty">Your force is empty. Go to <b>All units</b> and tap <b>+</b> on the units you're playing.<br><button class="btn primary" data-tab-go="units">Pick units</button></div>`;
    return;
  }
  const total = S.force.reduce((a, e) => a + entryPts(e), 0);
  const vpr = S.force.reduce((a, e) => a + entryVpr(e), 0);
  const factions = [...new Set(S.force.map(e => S.byId[e.u]?.faction))].filter(Boolean);
  pane.innerHTML = `<div class="force-summary">
      <div><span class="big">${total}</span><small>points</small></div>
      <div><span class="big">${S.force.length}</span><small>units</small></div>
      <div><span class="big">${vpr}</span><small>total VPR</small></div>
      <div class="actions"><button class="btn" data-share>Share</button><button class="btn" data-clearforce>Clear</button></div>
    </div>
    ${factions.length > 1 ? `<div class="meta-line"><span>Mixed factions: ${factions.join(', ')}</span></div>` : ''}
    ${entries.length < S.force.length ? `<div class="meta-line"><span>Showing ${entries.length} of ${S.force.length} (filters on)</span></div>` : ''}
    <ul class="rows">${entries.map(e => {
      const u = S.byId[e.u];
      return `<li class="entry" data-f="${u.faction}" data-key="${e.k}">
        <div class="entry-top">
          ${u.img ? `<img src="${u.img}" alt="" loading="lazy" width="44" height="34" data-open="${u.id}" data-entry="${e.k}">` : ''}
          <p class="row-name" data-open="${u.id}" data-entry="${e.k}" tabindex="0">${hl(u.variants[e.v]?.name || u.name)}</p>
          <span class="pts">${entryPts(e)}</span>
          <button class="icon-btn" data-remove="${e.k}" aria-label="Remove ${esc(u.name)}" title="Remove">×</button>
        </div>
        <div class="entry-ctrls">
          ${u.strengths.length > 1 ? `<span class="seg" role="group" aria-label="Strength">${u.strengths.map((s, i) => `<button data-str="${e.k}:${i}" aria-pressed="${e.s === i}">${STRENGTH_SHORT[s]}</button>`).join('')}</span>` : `<span class="row-sub">${u.strengths[0] === 'Full' ? 'Full strength' : u.strengths[0]} only</span>`}
          ${u.variants.length > 1 ? `<span class="seg" role="group" aria-label="Variant">${u.variants.map((v, i) => `<button data-var="${e.k}:${i}" aria-pressed="${e.v === i}">${i ? 'Command' : 'Standard'}</button>`).join('')}</span>` : ''}
          <span class="row-sub">${u.models[e.s]} model${u.models[e.s] === '1' ? '' : 's'}, VPR ${entryVpr(e)}</span>
        </div>
      </li>`;}).join('')}</ul>`;
}

function renderRules() {
  const ts = terms();
  const forceRules = new Set(), forceQuals = new Set();
  S.force.forEach(e => { const u = S.byId[e.u]; if (!u) return;
    [...u.specialRules, ...(e.v > 0 ? u.commandVariantRules : [])].forEach(r => forceRules.add(baseName(r)));
    u._quals.forEach(q => forceQuals.add(baseName(q))); });
  const pool = S.units.filter(u => S.faction === 'All' || u.faction === S.faction);
  let list = S.gloss.filter(g => {
    if (S.gkind === 'force') { const b = baseName(g.name); if (!(g.type === 'Weapon Quality' ? forceQuals : forceRules).has(b)) return false; }
    else if (S.gkind !== 'all' && g.type !== S.gkind) return false;
    const hay = (g.name + ' ' + g.paras.join(' ')).toLowerCase();
    return ts.every(t => hay.includes(t));
  });
  if (ts.length) list.sort((a, b) => (ts.some(t => b.name.toLowerCase().includes(t)) - ts.some(t => a.name.toLowerCase().includes(t))));
  const pane = $('#listPane');
  if (!list.length) {
    pane.innerHTML = `<div class="empty">${S.gkind === 'force' && !S.force.length ? 'Add units to your force to see the rules they use.' : `No rules match${S.q ? ` “${esc(S.q)}”` : ''}.`}</div>`;
    return;
  }
  // A long list reads best as a scannable index of names; searching or a short list opens everything.
  const open = ts.length || list.length <= 8 || S.glossOpen;
  pane.innerHTML = `<div class="meta-line"><span>${list.length} entr${list.length > 1 ? 'ies' : 'y'}, from the Glossary of Rules &amp; Qualities v1.11</span>
    ${list.length > 8 && !ts.length ? `<button class="linkish" data-glossall>${S.glossOpen ? 'Collapse all' : 'Expand all'}</button>` : ''}</div>` +
    list.map(g => {
      const b = baseName(g.name);
      const users = pool.filter(u => g.type === 'Weapon Quality' ? u._quals.some(q => baseName(q) === b) : [...u.specialRules, ...u.commandVariantRules].some(r => baseName(r) === b));
      return `<details class="gloss" ${open ? 'open' : ''}><summary><h3>${hl(g.name)}<small>${g.type === 'Weapon Quality' ? 'Weapon quality' : 'Special rule'}</small></h3></summary>
        ${g.paras.map(p => `<p>${hl(p)}</p>`).join('')}
        ${users.length ? `<div class="users">Used by: ${users.map(u => `<button data-open="${u.id}">${esc(u.name)}</button>`).join(', ')}</div>` : ''}
      </details>`;
    }).join('');
}

function renderScore() {
  checkScore();
  const sc = S.score, fs = allFactions(), cur = sc.vp[sc.r];
  const tot = [scoreTot(0), scoreTot(1)], gap = Math.abs(tot[0] - tot[1]);
  const lead = tot[0] === tot[1] ? -1 : +(tot[1] > tot[0]);
  const who = i => i ? 'Opponent' : 'You';
  const name = i => sc.f[0] === sc.f[1] ? who(i) : sc.f[i];
  const last = sc.r === sc.vp.length - 1;
  const side = i => `<section class="vp-side ${lead === i ? 'ahead' : ''}" data-f="${esc(sc.f[i])}" aria-label="${who(i)}">
      <label class="vp-who"><small>${who(i)}</small>
        <select data-side="${i}" aria-label="${who(i)}: faction">${fs.map(f => `<option ${f === sc.f[i] ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
      <div class="vp-total"><span class="vp-n">${tot[i]}</span><small>VP${lead === i ? ', leading' : ''}</small></div>
      <div class="vp-ctrl" role="group" aria-label="${who(i)}: round ${sc.r + 1} points">
        <button class="vp-btn" data-vp="${i}:-1" aria-label="${who(i)}: remove a point from round ${sc.r + 1}" ${cur[i] ? '' : 'disabled'}>−</button>
        <span class="vp-round"><small>Round ${sc.r + 1}</small><b>${cur[i] ? '+' + cur[i] : '0'}</b></span>
        <button class="vp-btn" data-vp="${i}:1" aria-label="${who(i)}: add a point to round ${sc.r + 1}">+</button>
      </div>
    </section>`;
  const cell = (r, i) => `<td class="${r[i] > r[1 - i] ? 'won' : ''}">${r[i]}</td>`;
  $('#listPane').innerHTML = `<div class="score">
    <div class="vp-sides">${side(0)}${side(1)}</div>
    <p class="vp-status" role="status">${lead < 0 ? (tot[0] ? `Level at ${tot[0]} VP each` : 'No points scored yet') : `<b data-f="${esc(sc.f[lead])}">${esc(name(lead))}</b> ${name(lead) === 'You' ? 'lead' : 'leads'} by ${gap} VP`}</p>
    <div class="round-bar">
      <button class="btn" data-round="-1" ${sc.r ? '' : 'disabled'} aria-label="Previous round">‹</button>
      <span class="round-name">Round <b>${sc.r + 1}</b>${sc.vp.length > 1 ? `<small> of ${sc.vp.length}</small>` : ''}</span>
      ${last ? `<button class="btn primary" data-round="1">Start round ${sc.r + 2}</button>`
             : `<button class="btn" data-round="1" aria-label="Next round">›</button>`}
    </div>
    ${sc.vp.length > 1 ? `<table class="vp-table">
      <caption>Points by round. Tap a round to edit it.</caption>
      <thead><tr><th scope="col">Round</th><th scope="col" data-f="${esc(sc.f[0])}">${esc(name(0))}</th><th scope="col" data-f="${esc(sc.f[1])}">${esc(name(1))}</th></tr></thead>
      <tbody>${sc.vp.map((r, i) => `<tr data-goround="${i}" tabindex="0" ${i === sc.r ? 'class="sel" aria-current="true"' : ''}><th scope="row">${i + 1}</th>${cell(r, 0)}${cell(r, 1)}</tr>`).join('')}</tbody>
      <tfoot><tr><th scope="row">Total</th>${cell(tot, 0)}${cell(tot, 1)}</tr></tfoot>
    </table>` : `<p class="vp-hint">Score each round with <b>+</b> and <b>−</b>, then start the next round. Totals add up automatically.</p>`}
    <div class="score-actions"><button class="btn" data-resetscore>New game</button></div>
  </div>`;
}

/* ---------- rendering: card ---------- */
function cardHTML(u) {
  const entry = S.force.find(e => e.k === S.selEntry && e.u === u.id);
  const n = forceCount(u.id);
  const qTag = q => `<button class="tag" data-q="${esc(q)}">${hl(q)}</button>`;
  const pos = S.visible.indexOf(u.id);
  const selS = entry ? entry.s : basicIdx(u);
  const cvRules = new Set(u.commandVariantRules.map(baseName));
  const prev = pos > 0, next = pos > -1 && pos < S.visible.length - 1;
  const addBtns = `<button class="btn primary" data-add="${u.id}">${n ? `Add another <span class="n">(${n} in force)</span>` : 'Add to my force'}</button>
        ${n ? `<button class="btn" data-removeone="${u.id}">Remove one</button>` : ''}`;
  return `
  <div class="sheet-bar">
    <button class="sheet-close" data-close aria-label="Close unit card"><span aria-hidden="true">✕</span> Close</button>
    ${pos > -1 && S.visible.length > 1 ? `<span class="sheet-pos">${pos + 1} of ${S.visible.length}</span>` : ''}
    <span class="sheet-nav">${prev ? `<button data-step="-1" aria-label="Previous unit">‹ Prev</button>` : ''}${next ? `<button data-step="1" aria-label="Next unit">Next ›</button>` : ''}</span>
  </div>
  <article class="card" data-f="${u.faction}">
    <div class="card-head">
      <div class="card-kicker"><span class="fac">The ${u.faction}</span>, ${esc(u.categories.join(' / '))}</div>
      <h2>${esc(u.name)}</h2>
      <div class="size" title="Size">${esc(u.size)}<small>size</small></div>
      <div class="card-actions">${addBtns}</div>
    </div>
    ${u.img ? `<div class="card-photo"><img src="${u.img}" alt="${esc(u.name)} miniatures"></div>` : ''}
    <div class="gauges">${u.attributes.map(a => `<div class="gauge"><span class="v">${esc(a.value)}</span><span class="l">${esc(a.label)}</span></div>`).join('')}</div>

    <div class="sec">
      <h3>Armament</h3>
      ${!u.armament.length ? '<p class="arm-none">No armament.</p>' : ''}
      <div class="arm-wrap" ${!u.armament.length ? 'hidden' : ''}><table class="arm">
        <thead><tr><th>Attack</th><th>Range</th>${u.brackets.map(b => `<th>${esc(u.bracketType)}<br>${esc(b)}</th>`).join('')}<th class="qcol">Qualities</th></tr></thead>
        <tbody>${u.armament.map(a => `<tr class="${a.qualities.length ? 'has-q' : ''}"><td class="w">${esc(a.name)}</td><td class="r">${esc(a.range)}</td>${a.dice.map(d => `<td class="d">${esc(d).replace(/\((\d+)\)/, '<small>($1)</small>')}</td>`).join('')}<td class="q qcol">${a.qualities.map(qTag).join('')}</td></tr>${a.qualities.length ? `<tr class="qrow"><td class="q" colspan="${a.dice.length + 2}">${a.qualities.map(qTag).join('')}</td></tr>` : ''}`).join('')}</tbody>
      </table></div>
    </div>

    <div class="sec">
      <h3>Strength and points</h3>
      <table class="strength"><thead><tr><th></th><th>Models</th><th>VPR</th>${u.variants.map(v => `<th>${esc(u.variants.length > 1 ? v.name : 'Points')}</th>`).join('')}</tr></thead>
      <tbody>${u.strengths.map((s, i) => `<tr class="${selS === i ? 'sel' : ''}"><td>${s}</td><td>${esc(u.models[i])}</td><td>${esc(u.vpr[i])}</td>${u.variants.map(v => `<td>${v.points[i] ?? '-'}</td>`).join('')}</tr>`).join('')}</tbody></table>
    </div>

    <div class="sec">
      <h3>Traits</h3>
      <div class="tags">${u.traits.map(t => `<button class="tag" data-trait="${esc(t)}" title="Show units with ${esc(t)}">${hl(t)}</button>`).join('')}</div>
      ${u.commandVariant ? `<div class="cv"><b>Command variant.</b> ${esc(u.commandVariant)}</div>` : ''}
    </div>

    ${u.rules.length ? `<div class="sec">
      <h3>Special rules</h3>
      ${u.rules.map(r => {
        const inQ = terms().length && terms().every(t => (r.name + JSON.stringify(r.blocks)).toLowerCase().includes(t));
        return `<details class="rule" ${inQ || S.openAll ? 'open' : ''}><summary><span>${hl(r.name)}${r.commandVariant || cvRules.has(baseName(r.name)) && !u.specialRules.some(x => baseName(x) === baseName(r.name)) ? '<em>command variant</em>' : ''}</span></summary>
          <div class="rule-body">${r.blocks.map(b => b.type === 'p' ? `<p>${hl(b.text)}</p>` : `<table class="rtable">${b.rows.map(row => `<tr><td>${esc(row[0])}</td><td>${hl(row[1])}</td></tr>`).join('')}</table>`).join('')}</div></details>`;
      }).join('')}
    </div>` : `<div class="sec"><h3>Special rules</h3><p class="row-sub">None.</p></div>`}
    <div class="src">ORBAT ${esc(u.orbat)}, page ${u.page}.${S.visible.length > 1 ? ' <span class="swipe-hint">Swipe sideways for the next unit.</span>' : ''}</div>
  </article>
  <div class="sheet-foot">
    <button class="btn step" data-step="-1" aria-label="Previous unit" ${prev ? '' : 'disabled'}>‹</button>
    <button class="btn primary" data-add="${u.id}" aria-label="${n ? `Add another, ${n} in force` : 'Add to my force'}">${n ? `Add another <span class="n">(${n})</span>` : 'Add to my force'}</button>
    ${n ? `<button class="btn" data-removeone="${u.id}" aria-label="Remove one from my force">Remove</button>` : ''}
    <button class="btn step" data-step="1" aria-label="Next unit" ${next ? '' : 'disabled'}>›</button>
  </div>`;
}

function renderDetail() {
  const d = $('#detail');
  const u = S.sel && S.byId[S.sel];
  document.body.classList.toggle('has-card', !!u);
  d.hidden = !u;
  d.innerHTML = u ? cardHTML(u) : '';
}

function render() {
  document.body.classList.toggle('wide', S.tab === 'rules' || S.tab === 'score');
  renderHeader();
  document.body.classList.toggle('scoring', S.tab === 'score');
  ({units: renderUnits, force: renderForce, rules: renderRules, score: renderScore}[S.tab] || renderUnits)();
  renderDetail();
  wakeLock();
}

/* ---------- popover ---------- */
function showGloss(name) {
  const g = glossFor(name);
  const pop = $('#pop');
  pop.innerHTML = `<button class="icon-btn x" data-closepop aria-label="Close">×</button>
    <h4>${esc(name)}</h4><div class="kind">${g ? (g.type === 'Weapon Quality' ? 'Weapon quality' : 'Special rule') : ''}</div>
    ${g ? g.paras.map(p => `<p>${esc(p)}</p>`).join('') : '<p>No glossary entry found.</p>'}
    ${/\(.+\)/.test(name) && g ? `<p class="kind">The bracketed value on the card replaces X or limits the target, as described above.</p>` : ''}`;
  pop.hidden = false;
  $('.x', pop).focus();
}
const closePop = () => { $('#pop').hidden = true; };

/* ---------- events ---------- */
function openUnit(id, entryKey = null) {
  // On phones the card is a full-screen sheet, so let the back button/gesture close it.
  if (!S.sel && narrow()) history.pushState({sheet: 1}, '');
  S.sel = id; S.selEntry = entryKey;
  if (S.tab === 'rules' || S.tab === 'score') S.tab = 'units';
  render();
  const d = $('#detail'); d.scrollTop = 0;
  if (!narrow()) $(`.row[data-id="${id}"]`)?.scrollIntoView({block: 'nearest'});
}
function closeSheet() {
  if (history.state?.sheet) return history.back();   // popstate does the closing
  S.sel = null; S.selEntry = null; render();
}
// Swipe sideways on the card sheet to step through the list. Ignore swipes that start in the
// sideways-scrolling armament table, and anything more vertical than horizontal.
let swipe = null;
$('#detail').addEventListener('touchstart', e => {
  swipe = e.touches.length === 1 && narrow() && !e.target.closest('.arm-wrap') ? {x: e.touches[0].clientX, y: e.touches[0].clientY} : null;
}, {passive: true});
$('#detail').addEventListener('touchend', e => {
  if (!swipe) return;
  const dx = e.changedTouches[0].clientX - swipe.x, dy = e.changedTouches[0].clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
  const i = S.visible.indexOf(S.sel) + (dx < 0 ? 1 : -1);
  if (S.visible[i]) { openUnit(S.visible[i]); $('#detail .card')?.classList.add(dx < 0 ? 'in-r' : 'in-l'); }
}, {passive: true});
window.addEventListener('popstate', () => { if (S.sel) { S.sel = null; S.selEntry = null; render(); } });

document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-open], [data-step], [data-goround], .row, a');
  if (!t) { if (!e.target.closest('#pop')) closePop(); return; }
  const ds = t.dataset;
  if (!t.closest('#pop') && !('q' in ds)) closePop();
  if (ds.faction) { S.faction = ds.faction; store.set('faction', S.faction); S.cats.clear(); render(); toTop(); return; }
  if (ds.tab) { S.tab = ds.tab; render(); window.scrollTo(0, 0); return; }
  if (ds.tabGo) { S.tab = ds.tabGo; render(); return; }
  if (ds.cat) { S.cats.has(ds.cat) ? S.cats.delete(ds.cat) : S.cats.add(ds.cat); render(); toTop(); return; }
  if (ds.gkind) { S.gkind = ds.gkind; render(); toTop(); return; }
  if ('glossall' in ds) { S.glossOpen = !S.glossOpen; render(); return; }
  if ('clear' in ds) { S.cats.clear(); S.q = ''; $('#q').value = ''; render(); return; }
  if (ds.add) { e.stopPropagation(); addToForce(ds.add); return; }
  if (ds.removeone) { removeOne(ds.removeone); return; }
  if (ds.remove) { const u = S.byId[S.force.find(x => x.k === ds.remove)?.u]; undoable(`${u?.name || 'Unit'} removed`, () => { S.force = S.force.filter(x => x.k !== ds.remove); saveForce(); }); return; }
  if (ds.str) { const [k, i] = ds.str.split(':'); const en = S.force.find(x => x.k === k); en.s = +i; saveForce(); render(); return; }
  if (ds.var) { const [k, i] = ds.var.split(':'); const en = S.force.find(x => x.k === k); en.v = +i; saveForce(); render(); return; }
  if ('share' in ds) { shareForce(); return; }
  if (ds.vp) {
    const [i, d] = ds.vp.split(':').map(Number), r = S.score.vp[S.score.r];
    r[i] = Math.max(0, r[i] + d); navigator.vibrate?.(8); saveScore(); render(); return;
  }
  if (ds.round) { goRound(S.score.r + (+ds.round)); return; }
  if (ds.goround) { goRound(+ds.goround); return; }
  if ('resetscore' in ds) { undoable('Scores cleared for a new game', () => { S.score = {...newScore(), f: S.score.f}; saveScore(); }); return; }
  if ('clearforce' in ds) { undoable(`Force cleared (${S.force.length} units)`, () => { S.force = []; saveForce(); }); return; }
  if ('undo' in ds) { const u = toast.undo; $('#toast').hidden = true; toast.undo = null; u?.(); return; }
  if (ds.q) { showGloss(ds.q); return; }
  if (ds.trait) { S.q = ds.trait; $('#q').value = ds.trait; S.tab = S.tab === 'force' ? 'force' : 'units'; S.sel = null; if (history.state?.sheet) history.back(); render(); toast(`Showing units with ${ds.trait}`); return; }
  if (ds.step) { e.stopPropagation(); const i = S.visible.indexOf(S.sel) + (+ds.step); if (S.visible[i]) openUnit(S.visible[i]); return; }
  if ('close' in ds) { closeSheet(); return; }
  if ('closepop' in ds) { closePop(); return; }
  if (ds.open) { openUnit(ds.open, ds.entry || null); return; }
  if (t.classList.contains('row')) { openUnit(ds.id); return; }
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== $('#q')) { e.preventDefault(); $('#q').focus(); return; }
  if (e.key === 'Escape') {
    if (!$('#pop').hidden) return closePop();
    if (document.activeElement === $('#q') && S.q) { S.q = ''; $('#q').value = ''; return render(); }
    if (S.sel) return closeSheet();
  }
  if (e.key === 'Enter' && (e.target.classList.contains('row') || e.target.dataset.open || e.target.dataset.goround)) e.target.click();
  if (S.sel && document.activeElement?.tagName !== 'INPUT' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const i = S.visible.indexOf(S.sel) + (e.key === 'ArrowRight' ? 1 : -1);
    if (S.visible[i]) openUnit(S.visible[i]);
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'sort') { S.sort = e.target.value; store.set('sort', S.sort); render(); }
  if (e.target.dataset.side) { S.score.f[+e.target.dataset.side] = e.target.value; saveScore(); render(); }
});
let qt;
$('#q').addEventListener('input', e => {
  clearTimeout(qt);
  qt = setTimeout(() => { S.q = e.target.value.trim(); if (S.tab === 'score') S.tab = 'units'; render(); }, 90);
});
window.addEventListener('hashchange', () => { importFromHash(); render(); });
window.addEventListener('resize', () => { measureHeader(); fades(); });
document.querySelectorAll('.faction-switch, .filters').forEach(el => el.addEventListener('scroll', fades, {passive: true}));
// Search button on a phone keyboard: hide the keyboard so the results are visible.
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

// Keep the screen awake while keeping score, so it doesn't dim mid-game.
let wake = null;   // a promise for the current lock, so overlapping renders don't ask twice
function wakeLock() {
  const want = S.tab === 'score' && document.visibilityState === 'visible';
  if (want && !wake && navigator.wakeLock) {
    const p = wake = navigator.wakeLock.request('screen')
      .then(l => { l.addEventListener('release', () => { if (wake === p) wake = null; }); return l; })
      .catch(() => { if (wake === p) wake = null; });
  } else if (!want && wake) { wake.then(l => l?.release()); wake = null; }
}
document.addEventListener('visibilitychange', wakeLock);

/* ---------- boot ---------- */
Promise.all([fetch('data/units.json').then(r => r.json()), fetch('data/glossary.json').then(r => r.json())])
  .then(([units, gloss]) => {
    S.units = units; S.gloss = gloss;
    units.forEach(u => { S.byId[u.id] = u; buildIndex(u); });
    S.force = S.force.filter(e => S.byId[e.u]);
    renderFactions();
    importFromHash();
    render();
  })
  .catch(err => { $('#listPane').innerHTML = `<div class="empty">Couldn't load the unit data (${esc(err.message)}). If you opened index.html straight from disk, serve the folder over HTTP instead (GitHub Pages does this for you).</div>`; });

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
