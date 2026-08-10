/* ═══════════════════════════════════════════════════════
   USA Trip 2026 — app.js
════════════════════════════════════════════════════════════ */

/* ── Place colors & emoji ─────────────────── */
const PLACES = {
  newyork:       { emoji: '🗽', color: '#e8eefc', accent: '#1d4ed8' },
  washington:    { emoji: '🏛️', color: '#f0e8fc', accent: '#6d28d9' },
  sanfrancisco:  { emoji: '🌉', color: '#fce8ee', accent: '#e8002d' },
  losangeles:    { emoji: '🎬', color: '#fdeede', accent: '#f57c00' },
  tampa:         { emoji: '🌴', color: '#e8f5e9', accent: '#2e7d32' },
};

function placeCircle(key) {
  const p = PLACES[key] || { emoji: '📍', color: '#f0ebe4', accent: '#d94f7a' };
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" fill="${p.color}"/>
    <circle cx="50" cy="50" r="38" fill="${p.accent}" opacity="0.15"/>
    <text x="50" y="64" font-size="38" text-anchor="middle">${p.emoji}</text>
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
      <div class="tl-flight-date">${fmtDate(item.date)} · ${item.time}</div>
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
        <div class="tl-circle-inner">${placeCircle(item.image)}</div>
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
  wrap.addEventListener('click', () => openStop(item));
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
      <div class="tl-wp-ring"><div class="tl-wp-inner">${placeCircle(wp.image)}</div></div>
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

  data.timeline.forEach(item => {
    let itemEl;
    if      (item.type === 'flight')    itemEl = renderFlight(item);
    else if (item.type === 'major')     itemEl = renderMajor(item);
    else if (item.type === 'waypoints') itemEl = renderWaypoints(item);
    else return;
    tl.appendChild(itemEl);
  });
}

/* ── Detail views ───────────────────────────────────── */
function openStop(item)   { openCity(item); }
function openWaypoint(wp) { openCity(wp);   }

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
    const res  = await fetch(`./data/trip.json?_=${Date.now()}`);
    const data = await res.json();
    window._tripData = data;
    buildTimeline(data);
    if (typeof renderNotesTab === 'function') renderNotesTab();
  } catch (err) {
    document.getElementById('timeline').innerHTML =
      `<p style="color:#d94f7a;padding:20px;text-align:center">Failed to load trip data</p>`;
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', init);
