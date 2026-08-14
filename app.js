/* ═══════════════════════════════════════════════════════
   USA Trip 2026 — app.js
════════════════════════════════════════════════════════════ */

/* ── Place colors & emoji ─────────────────── */
/* Legacy presets: older stops reference these by `image` key. */
const PLACES = {
  newyork:       { emoji: '🗽', color: '#e8eefc', accent: '#1d4ed8' },
  washington:    { emoji: '🏛️', color: '#f0e8fc', accent: '#6d28d9' },
  sanfrancisco:  { emoji: '🌉', color: '#fce8ee', accent: '#e8002d' },
  losangeles:    { emoji: '🎬', color: '#fdeede', accent: '#f57c00' },
  tampa:         { emoji: '🌴', color: '#e8f5e9', accent: '#2e7d32' },
};

/* Colour swatches offered in the destination form; a stop stores its `color` id. */
const PALETTE = [
  { id: 'red',      color: '#fce8ee', accent: '#e8002d' },
  { id: 'pink',     color: '#fce7f3', accent: '#db2777' },
  { id: 'fuchsia',  color: '#fae8ff', accent: '#c026d3' },
  { id: 'purple',   color: '#f0e8fc', accent: '#7c3aed' },
  { id: 'violet',   color: '#ede9fe', accent: '#6d28d9' },
  { id: 'indigo',   color: '#e8eaff', accent: '#4f46e5' },
  { id: 'blue',     color: '#e8eefc', accent: '#1d4ed8' },
  { id: 'sky',      color: '#e0f2fe', accent: '#0284c7' },
  { id: 'cyan',     color: '#e0f7fa', accent: '#0891b2' },
  { id: 'teal',     color: '#e0f5f2', accent: '#0d9488' },
  { id: 'emerald',  color: '#e3f7ee', accent: '#059669' },
  { id: 'green',    color: '#e8f5e9', accent: '#2e7d32' },
  { id: 'lime',     color: '#f0f8e0', accent: '#65a30d' },
  { id: 'yellow',   color: '#fdf6e3', accent: '#ca8a04' },
  { id: 'amber',    color: '#fdf0dd', accent: '#d97706' },
  { id: 'orange',   color: '#fdeede', accent: '#f57c00' },
  { id: 'brown',    color: '#f5ece4', accent: '#92400e' },
  { id: 'navy',     color: '#e6eaf5', accent: '#1e3a8a' },
  { id: 'maroon',   color: '#fae8ec', accent: '#9f1239' },
  { id: 'slate',    color: '#eef1f5', accent: '#475569' },
];

const DEFAULT_THEME = { color: '#f0ebe4', accent: '#d94f7a' };

/* A stop's `color` id wins; otherwise fall back to its legacy `image` preset. */
function stopTheme(key, colorId) {
  return PALETTE.find(p => p.id === colorId) || PLACES[key] || DEFAULT_THEME;
}

/* `emoji` (optional) overrides the preset's icon, so stops can use any emoji. */
function placeCircle(key, emoji, colorId) {
  const p = stopTheme(key, colorId);
  const icon = emoji || PLACES[key]?.emoji || '📍';
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" fill="${p.color}"/>
    <circle cx="50" cy="50" r="38" fill="${p.accent}" opacity="0.15"/>
    <text x="50" y="64" font-size="38" text-anchor="middle">${icon}</text>
  </svg>`;
}

/* ── Date utils ─────────────────────────────────────── */
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseDate(str) {
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y, m-1, d);
}
function fmtDate(str) {
  const d = parseDate(str);
  return `${MONTHS[d.getMonth()]} ${d.getDate()} (${DAYS[d.getDay()]})`;
}
function fmtDateShort(str) {
  const d = parseDate(str);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
function nightsBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

/* ── Element helper ─────────────────────────────────── */
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/* ════════════════════════════════════════════════════════
   OVERLAY HISTORY
   Each open overlay pushes a history entry so the phone's Back
   gesture closes it instead of leaving the site.
════════════════════════════════════════════════════════ */
const _ovlStack = [];
let _ovlIgnorePop = false;   // set while we unwind history ourselves

function pushOverlay(name, close) {
  _ovlStack.push({ name, close });
  history.pushState({ ovl: name }, '');
}

/* Close from the UI (✕, backdrop, Cancel…) and keep history in sync. */
function closeOverlay(name) {
  const i = _ovlStack.findIndex(o => o.name === name);
  if (i < 0) return false;
  const removed = _ovlStack.splice(i).reverse();
  removed.forEach(o => { try { o.close(); } catch (e) { console.error(e); } });
  _ovlIgnorePop = true;
  history.go(-removed.length);
  return true;
}

window.addEventListener('popstate', () => {
  if (_ovlIgnorePop) { _ovlIgnorePop = false; return; }
  closeStopMenu();
  const top = _ovlStack.pop();
  if (top) { try { top.close(); } catch (e) { console.error(e); } }
});

/* ════════════════════════════════════════════════════════
   RENDER ITEMS
════════════════════════════════════════════════════════ */

function renderFlight(item) {
  const isReturn = item.label.toLowerCase().includes('return');
  const wrap = el('div', 'tl-item tl-flight');
  wrap.innerHTML = `
    <div class="tl-dot-wrap">
      <div class="tl-dot-flight">${isReturn ? '🛬' : '🛫'}</div>
    </div>
    <div class="tl-body">
      <div class="tl-flight-label">${item.label}</div>
      <div class="tl-flight-date">${fmtDate(item.date)}${item.time ? ` · ${item.time}` : ''}</div>
      ${item.note ? `<div class="tl-flight-note">${item.note}</div>` : ''}
    </div>
  `;
  return wrap;
}

function renderMajor(item) {
  const nights  = nightsBetween(item.arrival, item.departure);
  const nLabel  = nights === 1 ? '1 night' : `${nights} nights`;
  const arrTime = item.arrivalTime ? ` ${item.arrivalTime}` : '';

  const wrap = el('div', 'tl-item tl-major');
  wrap.dataset.id = item.id;
  wrap.innerHTML = `
    <div class="tl-dot-wrap">
      <div class="tl-dot-major">
        <div class="tl-circle-inner">${placeCircle(item.image, item.emoji, item.color)}</div>
      </div>
    </div>
    <div class="tl-body">
      <div class="tl-major-name">${item.name}</div>
      <div class="tl-major-dates">${fmtDateShort(item.arrival)}${arrTime} → ${fmtDateShort(item.departure)}</div>
      <span class="tl-nights">${nLabel}</span>
      ${item.transit ? `<div class="tl-transit">${item.transit}</div>` : ''}
      ${item.transitBook ? `<div class="tl-book-badge">📅 Book ${item.transitBook.days} days ahead · ${item.transitBook.note}</div>` : ''}
    </div>
  `;
  wrap.addEventListener('click', () => {
    if (_tlSuppressClick) { _tlSuppressClick = false; return; }
    openStop(item);
  });
  return wrap;
}

function renderWaypoints(item) {
  const wrap   = el('div', 'tl-item tl-waypoints');
  const dotWrap = el('div', 'tl-dot-wrap');
  dotWrap.innerHTML = `<div class="tl-dot-via">via</div>`;

  const body = el('div', 'tl-body');
  const row  = el('div', 'tl-wps-row');

  if (item.transit) {
    const transitEl = el('div', 'tl-wp-transit-group', item.transit);
    body.appendChild(transitEl);
  }

  item.items.forEach(wp => {
    const wpEl = el('div', 'tl-wp');
    wpEl.innerHTML = `
      <div class="tl-wp-ring"><div class="tl-wp-inner">${placeCircle(wp.image, wp.emoji, wp.color)}</div></div>
      <div class="tl-wp-name">${wp.name}</div>
      ${wp.transit ? `<div class="tl-wp-transit">${wp.transit}</div>` : ''}
    `;
    wpEl.addEventListener('click', () => openWaypoint(wp));
    row.appendChild(wpEl);
  });

  body.appendChild(row);
  wrap.appendChild(dotWrap);
  wrap.appendChild(body);
  return wrap;
}

/* ════════════════════════════════════════════════════════
   VERTICAL TIMELINE
════════════════════════════════════════════════════════ */

function buildTimeline(data) {
  const tl = document.getElementById('timeline');
  tl.innerHTML = '';
  tl.className = 'tl-list';

  const canEditNow = typeof canEdit === 'function' && canEdit();

  // Render in chronological order (by flight date / stop arrival). Waypoints
  // have no date of their own, so they inherit the sort key of the entry above.
  const items = timelineSorted(data.timeline);

  items.forEach(item => {
    let itemEl;
    if      (item.type === 'flight')    itemEl = renderFlight(item);
    else if (item.type === 'major')     itemEl = renderMajor(item);
    else if (item.type === 'waypoints') itemEl = renderWaypoints(item);
    else return;
    if (canEditNow && (item.type === 'major' || item.type === 'flight')) {
      attachStopEditHandlers(itemEl, item);
    }
    tl.appendChild(itemEl);
  });

  if (canEditNow) tl.appendChild(renderAddDestButton());

  updateHeaderDates(items);
}

/* Header subtitle: full span of the trip, e.g. "Oct 17 – Oct 27, 2026". */
function updateHeaderDates(items) {
  const sub = document.querySelector('.header-sub');
  if (!sub) return;
  const dates = items.flatMap(i => [i.date, i.arrival, i.departure]).filter(Boolean).sort();
  if (!dates.length) { sub.textContent = 'Dates TBD'; return; }
  const first = dates[0], last = dates[dates.length - 1];
  sub.textContent = `${fmtDateShort(first)} – ${fmtDateShort(last)}, ${parseDate(last).getFullYear()}`;
}

/* Chronological order: flights use `date`, stops use `arrival`; waypoints keep
   the position of the preceding entry so they stay attached to their stop. */
function timelineSorted(timeline) {
  const keyed = timeline.map((item, i) => ({ item, i, key: item.date || item.arrival || '' }));
  let lastKey = '';
  keyed.forEach(k => { if (k.key) lastKey = k.key; else k.key = lastKey; });
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i));
  return keyed.map(k => k.item);
}

/* ── Detail views ───────────────────────────────────── */
function openStop(item)   { openCity(item); }
function openWaypoint(wp) { openCity(wp);   }

/* ════════════════════════════════════════════════════════
   TIMELINE EDITOR  (add / edit / delete stops & flights)
   Only active in edit mode for approved editors (canEdit()).
════════════════════════════════════════════════════════ */

let _tlSuppressClick = false;   // set after a long-press so the tap doesn't open the city

function _esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Inclusive list of YYYY-MM-DD dates between arrival and departure. */
function datesInRange(a, b) {
  const out = [];
  for (let d = parseDate(a); d <= parseDate(b); d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

/* Slug id from a name, made unique against existing timeline ids. */
function uniqueStopId(name) {
  const base = name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-') || 'stop';
  const taken = new Set((window._tripData?.timeline || []).filter(t => t.id).map(t => t.id));
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

/* ── Right-click (desktop) + long-press (touch) on a timeline node ── */
function attachStopEditHandlers(node, item) {
  node.addEventListener('contextmenu', e => {
    e.preventDefault();
    showStopMenu(e.clientX, e.clientY, item);
  });

  let press = null;
  const clear = () => {
    if (press?.timer) clearTimeout(press.timer);
    press = null;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', clear);
    document.removeEventListener('pointercancel', clear);
  };
  const onMove = e => {
    if (press && (Math.abs(e.clientX - press.x) > 8 || Math.abs(e.clientY - press.y) > 8)) clear();
  };
  node.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;   // desktop uses right-click
    press = { x: e.clientX, y: e.clientY, timer: setTimeout(() => {
      _tlSuppressClick = true;
      showStopMenu(press.x, press.y, item);
      clear();
    }, 420) };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', clear);
    document.addEventListener('pointercancel', clear);
  });
}

/* ── Floating Edit / Delete menu ── */
function showStopMenu(x, y, item) {
  closeStopMenu();
  const isFlight = item.type === 'flight';
  const menu = document.createElement('div');
  menu.className = 'tl-menu';
  menu.id = 'tl-menu';
  menu.innerHTML = `
    <button class="tl-menu-item" data-act="edit">✏️ Edit</button>
    ${isFlight ? '' : '<button class="tl-menu-item tl-menu-danger" data-act="delete">🗑️ Delete</button>'}
  `;
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth  - r.width  - 8)) + 'px';
  menu.style.top  = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';

  menu.addEventListener('click', e => {
    const act = e.target.closest('.tl-menu-item')?.dataset.act;
    closeStopMenu();
    if (act === 'edit')   isFlight ? openFlightForm(item) : openDestForm(item);
    if (act === 'delete') deleteStop(item);
  });
  setTimeout(() => document.addEventListener('pointerdown', _onDocDownForMenu, true), 0);
}
function _onDocDownForMenu(e) { if (!e.target.closest('#tl-menu')) closeStopMenu(); }
function closeStopMenu() {
  document.getElementById('tl-menu')?.remove();
  document.removeEventListener('pointerdown', _onDocDownForMenu, true);
}

/* ── "Add destination" button at the bottom of the timeline ── */
function renderAddDestButton() {
  const btn = el('button', 'tl-add-btn', '➕ Add destination');
  btn.addEventListener('click', () => openDestForm(null));
  return btn;
}

/* ── Destination form ── */
/* Pre-select the swatch matching a stop's stored colour (or its legacy preset). */
function _selectedColorId(d) {
  if (d.color) return d.color;
  const accent = PLACES[d.image]?.accent;
  return PALETTE.find(p => p.accent === accent)?.id || '';
}

function _swatchGrid(selected) {
  return PALETTE.map(p => `
    <button type="button" class="df-swatch${p.id === selected ? ' df-swatch-sel' : ''}"
      data-color="${p.id}" title="${p.id}"
      style="background:${p.color};--sw:${p.accent}">
      <span style="background:${p.accent}"></span>
    </button>`).join('');
}

function openDestForm(item) {
  const isNew = !item;
  const d = item || { name: '', image: '', emoji: '', color: '', arrival: '', departure: '', transit: '' };
  const selColor = _selectedColorId(d);
  const modal = document.createElement('div');
  modal.className = 'loc-modal';
  modal.id = 'dest-form-modal';
  modal.innerHTML = `
    <div class="loc-modal-box">
      <button class="loc-close" onclick="closeDestForm()">✕</button>
      <div class="loc-modal-title">${isNew ? 'Add destination' : 'Edit destination'}</div>
      <label class="loc-label">Name</label>
      <div class="df-name-row">
        <input class="loc-input df-emoji-input" id="df-emoji" value="${_esc(d.emoji || PLACES[d.image]?.emoji || '')}" placeholder="📍" maxlength="8">
        <input class="loc-input" id="df-name" value="${_esc(d.name)}" placeholder="e.g. Miami">
      </div>
      <label class="loc-label">Color</label>
      <div class="df-swatches" id="df-swatches">${_swatchGrid(selColor)}</div>
      <input type="hidden" id="df-color" value="${selColor}">
      <label class="loc-label">Arrival</label>
      <input class="loc-input" id="df-arrival" type="date" value="${d.arrival || ''}">
      <label class="loc-label">Departure</label>
      <input class="loc-input" id="df-departure" type="date" value="${d.departure || ''}">
      <label class="loc-label">Transit (optional)</label>
      <input class="loc-input" id="df-transit" value="${_esc(d.transit || '')}" placeholder="✈️ Flight … → …">
      <div class="loc-actions">
        <button class="loc-btn loc-btn-secondary" onclick="closeDestForm()">Cancel</button>
        <button class="loc-btn loc-btn-primary" id="df-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  pushOverlay('dest-form', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) closeDestForm(); });
  document.getElementById('df-swatches').addEventListener('click', e => {
    const sw = e.target.closest('.df-swatch');
    if (!sw) return;
    modal.querySelectorAll('.df-swatch').forEach(b => b.classList.remove('df-swatch-sel'));
    sw.classList.add('df-swatch-sel');
    document.getElementById('df-color').value = sw.dataset.color;
  });
  document.getElementById('df-save').addEventListener('click', () => submitDestForm(item));
}
function closeDestForm() {
  if (!closeOverlay('dest-form')) document.getElementById('dest-form-modal')?.remove();
}

async function submitDestForm(existing) {
  const name      = document.getElementById('df-name').value.trim();
  const color     = document.getElementById('df-color').value;
  const emoji     = document.getElementById('df-emoji').value.trim();
  const arrival   = document.getElementById('df-arrival').value;
  const departure = document.getElementById('df-departure').value;
  const transit   = document.getElementById('df-transit').value.trim();
  if (!name)                { alert('Please enter a name.'); return; }
  if (!arrival || !departure) { alert('Please pick arrival and departure dates.'); return; }
  if (parseDate(departure) < parseDate(arrival)) { alert('Departure can’t be before arrival.'); return; }
  if (await applyDestEdit(existing, { name, color, emoji, arrival, departure, transit })) closeDestForm();
}

/* Load a city's stored doc (cloud → stub) so we can reconcile its days. */
async function loadCityData(id, name) {
  const data = (typeof Store !== 'undefined') ? await Store.loadCity(id) : null;
  return data || { id, name: name || id, center: [39.8283, -98.5795], zoom: 5, hotel: { name: 'TBD' }, days: [] };
}

function persistCityData(id, data) {
  Store.saveCity(id, data);
}

async function applyDestEdit(existing, form) {
  const id = existing ? existing.id : uniqueStopId(form.name);

  // Reconcile the city's day list to the new date range.
  const city     = await loadCityData(id, form.name);
  const newDates = datesInRange(form.arrival, form.departure);
  const oldDays  = Array.isArray(city.days) ? city.days : [];
  const dropped  = oldDays.slice(newDates.length).filter(dd => dd.activities?.length);
  if (dropped.length) {
    const proceed = await uiConfirm({
      title: 'Shorten dates?',
      message: 'Shortening the dates will delete activities on the removed days. Continue?',
      confirmText: 'Delete', danger: true,
    });
    if (!proceed) return false;
  }
  city.id   = id;
  city.name = form.name;
  city.days = newDates.map((date, i) => ({ date, activities: oldDays[i]?.activities || [] }));
  persistCityData(id, city);

  // Upsert the timeline entry (reuse the same object when editing).
  const entry = existing || {};
  entry.type = 'major';
  entry.id = id;
  entry.name = form.name;
  entry.arrival = form.arrival;
  entry.departure = form.departure;
  if (form.color) entry.color = form.color; else delete entry.color;
  if (form.emoji) entry.emoji = form.emoji; else delete entry.emoji;
  if (form.transit) entry.transit = form.transit; else delete entry.transit;
  if (!existing) window._tripData.timeline.push(entry);

  persistTrip();
  buildTimeline(window._tripData);
  return true;
}

async function deleteStop(item) {
  const ok = await uiConfirm({
    title: `Delete ${item.name}?`,
    message: 'This removes the destination from the timeline. Its saved days stay in the cloud and return if you re-add it.',
    confirmText: 'Delete', danger: true,
  });
  if (!ok) return;
  window._tripData.timeline = window._tripData.timeline.filter(t => t !== item);
  persistTrip();
  buildTimeline(window._tripData);
}

/* ── Flight form (edit-only: date / time / note) ── */
function openFlightForm(item) {
  const modal = document.createElement('div');
  modal.className = 'loc-modal';
  modal.id = 'flight-form-modal';
  modal.innerHTML = `
    <div class="loc-modal-box">
      <button class="loc-close" onclick="closeFlightForm()">✕</button>
      <div class="loc-modal-title">Edit ${_esc(item.label || 'flight')}</div>
      <label class="loc-label">Date</label>
      <input class="loc-input" id="ff-date" type="date" value="${item.date || ''}">
      <label class="loc-label">Time</label>
      <input class="loc-input" id="ff-time" type="time" value="${item.time || ''}">
      <label class="loc-label">Note</label>
      <input class="loc-input" id="ff-note" value="${_esc(item.note || '')}" placeholder="Flight from … to …">
      <div class="loc-actions">
        <button class="loc-btn loc-btn-secondary" onclick="closeFlightForm()">Cancel</button>
        <button class="loc-btn loc-btn-primary" id="ff-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  pushOverlay('flight-form', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) closeFlightForm(); });
  document.getElementById('ff-save').addEventListener('click', () => {
    item.date = document.getElementById('ff-date').value;
    item.time = document.getElementById('ff-time').value;
    item.note = document.getElementById('ff-note').value.trim();
    persistTrip();
    buildTimeline(window._tripData);
    closeFlightForm();
  });
}
function closeFlightForm() {
  if (!closeOverlay('flight-form')) document.getElementById('flight-form-modal')?.remove();
}

/* ── Tabs ───────────────────────────────────────────── */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`view-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'notes'    && typeof renderNotesTab    === 'function') renderNotesTab();
    });
  });
}

/* ── Service Worker ─────────────────────────────────── */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

/* ── In-app confirm dialog (replaces window.confirm) ── */
function uiConfirm(opts = {}) {
  const {
    title = 'Are you sure?',
    message = '',
    confirmText = 'OK',
    cancelText = 'Cancel',
    danger = true,
  } = opts;
  return new Promise(resolve => {
    const modal  = document.getElementById('confirm-modal');
    if (!modal) { resolve(window.confirm(message || title)); return; }
    const okBtn  = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    document.getElementById('confirm-title').textContent = title;
    const msgEl = document.getElementById('confirm-message');
    msgEl.textContent = message;
    msgEl.style.display = message ? '' : 'none';
    okBtn.textContent = confirmText;
    cancel.textContent = cancelText;
    okBtn.className = 'loc-btn ' + (danger ? 'loc-btn-danger-solid' : 'loc-btn-primary');
    modal.style.display = 'flex';

    function cleanup(result) {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      resolve(result);
    }
    const onOk       = () => cleanup(true);
    const onCancel   = () => cleanup(false);
    const onBackdrop = e => { if (e.target === modal) cleanup(false); };
    okBtn.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
  });
}

/* ── Init ───────────────────────────────────────────── */
async function init() {
  initTabs();
  registerSW();
  try {
    const data = await Store.loadTrip();
    if (!data) throw new Error('No trip document in Firestore');
    window._tripData = data;
    buildTimeline(data);
    if (typeof renderNotesTab === 'function') renderNotesTab();
  } catch (err) {
    document.getElementById('timeline').innerHTML =
      `<p style="color:#d94f7a;padding:20px;text-align:center">Couldn’t load the trip.<br>Check your connection and refresh.</p>`;
    console.error(err);
  }
}

/* Persist the whole trip timeline to Firestore. */
function persistTrip() {
  if (!window._tripData) return;
  Store.saveTrip(window._tripData);
}

document.addEventListener('DOMContentLoaded', init);
