/* ══════════════════════════════════════════════════════
   PAYMENTS TAB — payments.js
══════════════════════════════════════════════════════ */

const PAYMENTS_KEY  = 'usa-payments';
const ILS_PER_USD   = 3.7;   // 1 USD ≈ 3.7 ILS  (adjust in settings if needed)

const PAY_CATS = {
  flights:       { label: '✈️ Flights',       color: '#e879f9' },
  accommodation: { label: '🏨 Hotels',         color: '#60a5fa' },
  activities:    { label: '🎡 Activities',     color: '#34d399' },
  transport:     { label: '🚆 Transport',      color: '#fbbf24' },
  food:          { label: '🍜 Food',           color: '#f97316' },
  shopping:      { label: '🛍️ Shopping',      color: '#a78bfa' },
  other:         { label: '📌 Other',          color: '#9ca3af' },
};

let _pays        = null;
let _payView     = 'full';   // 'full' | 'person'
let _payChart    = null;
let _payEditId   = null;

/* ── helpers ── */
function ilsFromRaw(amount, currency) {
  return currency === 'ILS' ? amount : amount * ILS_PER_USD;
}
function usdFromRaw(amount, currency) {
  return currency === 'USD' ? amount : amount / ILS_PER_USD;
}
function fmtILS(n) { return '₪' + Math.round(n).toLocaleString(); }
function fmtUSD(n) { return '$' + Math.round(n).toLocaleString(); }

/* ── storage ── */
function _loadPays() {
  const s = localStorage.getItem(PAYMENTS_KEY);
  return s ? JSON.parse(s) : null;
}
function _savePays() {
  localStorage.setItem(PAYMENTS_KEY, JSON.stringify(_pays));
}

/* ══════════════════════════════════════════════════════
   MAIN RENDER
══════════════════════════════════════════════════════ */
async function renderPaymentsTab() {
  const view = document.getElementById('view-payments');
  if (!view) return;

  // Always fetch fresh JSON so edits to payments.json are reflected immediately.
  // Preserve any entries added via the modal (their IDs won't exist in the JSON file).
  try {
    const res   = await fetch(`data/payments.json?_=${Date.now()}`);
    const fresh = await res.json();
    const freshIds  = new Set(fresh.map(p => p.id));
    const stored    = _loadPays() || [];
    const userAdded = stored.filter(p => !freshIds.has(p.id));
    _pays = [...fresh, ...userAdded];
    _savePays();
  } catch {
    if (!_pays) _pays = _loadPays() || [];
  }
  _drawPayments(view);
}

function _drawPayments(view) {
  const div = _paymentsViewMode === 'person' ? 2 : 1;

  let totalILS = 0, otherILS = 0;
  _pays.forEach(p => {
    const ils = ilsFromRaw(p.amount, p.currency) / div;
    totalILS += ils;
    if (p.paidByOther) otherILS += ils;
  });

  view.innerHTML = `
    <div class="pay-wrap">

      <!-- top bar -->
      <div class="pay-topbar">
        <div class="pay-toggle">
          <button class="pay-tog ${_paymentsViewMode==='full'?'on':''}"   onclick="setPayView('full')">Full Trip</button>
          <button class="pay-tog ${_paymentsViewMode==='person'?'on':''}" onclick="setPayView('person')">Per Person</button>
        </div>
        <button class="pay-add" onclick="openPayModal()">＋ Add</button>
      </div>

      <!-- summary cards -->
      <div class="pay-summary">
        <div class="pay-card">
          <div class="pay-card-lbl">Total</div>
          <div class="pay-card-val">${fmtILS(totalILS)}</div>
          <div class="pay-card-sub">${fmtUSD(usdFromRaw(totalILS,'ILS'))}</div>
        </div>
        ${otherILS > 0 ? `<div class="pay-card pay-card-purple">
          <div class="pay-card-lbl">By other</div>
          <div class="pay-card-val">${fmtILS(otherILS)}</div>
        </div>` : ''}
      </div>

      <!-- chart -->
      <div class="pay-chart-wrap">
        <canvas id="pay-chart"></canvas>
      </div>

      <!-- list -->
      <div class="pay-list" id="pay-list"></div>

    </div>

    <!-- modal backdrop -->
    <div class="pay-backdrop" id="pay-backdrop" onclick="closePayModal()"></div>

    <!-- modal -->
    <div class="pay-modal" id="pay-modal">
      <div class="pay-modal-hdr">
        <span id="pay-modal-ttl">Add Payment</span>
        <button class="pay-modal-x" onclick="closePayModal()">✕</button>
      </div>
      <div class="pay-modal-body">
        <label class="pay-lbl">Name</label>
        <input  class="pay-inp" id="pm-name" type="text" placeholder="e.g. Hotel New York">

        <label class="pay-lbl">Category</label>
        <select class="pay-inp" id="pm-cat">
          ${Object.entries(PAY_CATS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}
        </select>

        <label class="pay-lbl">Amount</label>
        <div class="pay-amt-row">
          <input  class="pay-inp" id="pm-amount" type="number" min="0" placeholder="0">
          <select class="pay-inp pay-cur" id="pm-currency">
            <option value="ILS">₪ ILS</option>
            <option value="USD">$ USD</option>
          </select>
        </div>

        <div class="pay-checks">
          <label class="pay-chk"><input type="checkbox" id="pm-other"> Paid by other person</label>
        </div>
      </div>
      <div class="pay-modal-ftr">
        <button class="pay-modal-del" id="pm-del-btn" onclick="deletePayModal()" style="display:none">Delete</button>
        <button class="pay-modal-save" onclick="savePayModal()">Save</button>
      </div>
    </div>
  `;

  _renderPayList();
  _renderPayChart();
}

/* ── list ── */
function _renderPayList() {
  const list = document.getElementById('pay-list');
  if (!list) return;
  const div = _paymentsViewMode === 'person' ? 2 : 1;

  if (!_pays.length) {
    list.innerHTML = '<p class="pay-empty">No payments yet — tap ＋ Add</p>';
    return;
  }

  list.innerHTML = _pays.map(p => {
    const cat   = PAY_CATS[p.category] || PAY_CATS.other;
    const ils   = ilsFromRaw(p.amount, p.currency) / div;
    const usd   = usdFromRaw(ils, 'ILS');
    const mainFmt = p.currency === 'ILS' ? fmtILS(p.amount/div) : fmtUSD(p.amount/div);
    const convFmt = p.currency === 'ILS' ? fmtUSD(usd)          : fmtILS(ils);

    return `<div class="pay-item">
      <div class="pay-dot" style="background:${cat.color}"></div>
      <div class="pay-item-info">
        <div class="pay-item-name">${p.name||'—'}${p.paidByOther?' <span class="pay-badge">other</span>':''}</div>
        <div class="pay-item-cat">${cat.label}</div>
      </div>
      <div class="pay-item-nums">
        <div class="pay-item-main">${mainFmt}</div>
        <div class="pay-item-conv">${convFmt}</div>
      </div>
      <button class="pay-edit-btn" onclick="openPayModal('${p.id}')">✎</button>
    </div>`;
  }).join('');
}

/* ── chart ── */
function _renderPayChart() {
  const canvas = document.getElementById('pay-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  const div = _paymentsViewMode === 'person' ? 2 : 1;

  const byCat = {};
  _pays.forEach(p => {
    const c = p.category || 'other';
    byCat[c] = (byCat[c]||0) + ilsFromRaw(p.amount, p.currency)/div;
  });

  const keys   = Object.keys(byCat);
  const labels = keys.map(k => PAY_CATS[k]?.label || k);
  const data   = keys.map(k => Math.round(byCat[k]));
  const colors = keys.map(k => PAY_CATS[k]?.color || '#9ca3af');

  if (_payChart) _payChart.destroy();
  _payChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff8f8' }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position:'bottom', labels:{ color:'#5a3a3a', font:{size:11}, padding:10, boxWidth:11 } },
        tooltip: { callbacks: { label: ctx => ` ${fmtILS(ctx.parsed)}` } }
      },
      cutout: '62%'
    }
  });
}

/* ── view toggle ── */
function setPayView(mode) {
  _paymentsViewMode = mode;
  const v = document.getElementById('view-payments');
  if (v) _drawPayments(v);
}

// alias used by _drawPayments before variable is set
Object.defineProperty(window, '_paymentsViewMode', {
  get() { return _payView; },
  set(v){ _payView = v; }
});

/* ── modal ── */
function openPayModal(id) {
  _payEditId = id || null;
  const modal   = document.getElementById('pay-modal');
  const backdrop= document.getElementById('pay-backdrop');
  const title   = document.getElementById('pay-modal-ttl');
  const delBtn  = document.getElementById('pm-del-btn');
  if (!modal) return;

  if (id) {
    const p = _pays.find(x => x.id === id);
    if (!p) return;
    title.textContent = 'Edit Payment';
    document.getElementById('pm-name').value      = p.name || '';
    document.getElementById('pm-cat').value       = p.category;
    document.getElementById('pm-amount').value    = p.amount;
    document.getElementById('pm-currency').value  = p.currency;
    document.getElementById('pm-other').checked   = !!p.paidByOther;
    delBtn.style.display = '';
  } else {
    title.textContent = 'Add Payment';
    document.getElementById('pm-name').value      = '';
    document.getElementById('pm-cat').value       = 'accommodation';
    document.getElementById('pm-amount').value    = '';
    document.getElementById('pm-currency').value  = 'ILS';
    document.getElementById('pm-other').checked   = false;
    delBtn.style.display = 'none';
  }

  modal.classList.add('open');
  backdrop.classList.add('open');
}

function closePayModal() {
  document.getElementById('pay-modal')   ?.classList.remove('open');
  document.getElementById('pay-backdrop')?.classList.remove('open');
  _payEditId = null;
}

function savePayModal() {
  const name     = document.getElementById('pm-name').value.trim();
  const category = document.getElementById('pm-cat').value;
  const amount   = parseFloat(document.getElementById('pm-amount').value);
  const currency = document.getElementById('pm-currency').value;
  const paidByOther = document.getElementById('pm-other').checked;

  if (!amount || isNaN(amount)) return;

  if (_payEditId) {
    const i = _pays.findIndex(p => p.id === _payEditId);
    if (i !== -1) _pays[i] = { ..._pays[i], name, category, amount, currency, paidByOther };
  } else {
    _pays.push({ id: Date.now().toString(), name, category, amount, currency, paidByOther });
  }

  _savePays();
  closePayModal();
  const v = document.getElementById('view-payments');
  if (v) _drawPayments(v);
}

function deletePayModal() {
  if (!_payEditId) return;
  if (!confirm('Delete this payment?')) return;
  _pays = _pays.filter(p => p.id !== _payEditId);
  _savePays();
  closePayModal();
  const v = document.getElementById('view-payments');
  if (v) _drawPayments(v);
}
