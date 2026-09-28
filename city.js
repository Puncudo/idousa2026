/* ═══════════════════════════════════════════════════════
   city.js — City detail view with map + daily activities
═══════════════════════════════════════════════════════ */

/* Editing is enabled only for signed-in, allowlisted Google accounts (via Store).
   When Firebase isn't configured, fall back to editable on the local python server. */
function canEdit() {
  if (!isEditMode()) return false;                 // view mode → read-only even for editors
  if (typeof Store !== 'undefined' && Store.isConfigured()) return Store.canEdit();
  return !location.hostname.endsWith('.github.io');
}

/* ── Edit / View mode toggle (default: edit) ──
   Only an approved editor can actually edit; this just toggles the UI.
   Defaults to edit mode unless the user explicitly switched to view. */
let _editMode = localStorage.getItem('usa-edit-mode') !== '0';
function isEditMode() { return _editMode; }
function toggleEditMode() { setEditMode(!_editMode); }
function setEditMode(on) {
  _editMode = !!on;
  localStorage.setItem('usa-edit-mode', _editMode ? '1' : '0');
  applyEditMode();
}
function updateEditModeBtn() {
  const b = document.getElementById('editmode-btn');
  if (!b) return;
  // The toggle is only meaningful for accounts that are allowed to edit.
  const capable = (typeof Store !== 'undefined' && Store.isConfigured())
    ? Store.canEdit() : !location.hostname.endsWith('.github.io');
  b.style.display = capable ? '' : 'none';
  b.textContent = _editMode ? 'Editing' : 'View';
  b.classList.toggle('editmode-on', _editMode);
}
function applyEditMode() {
  updateEditModeBtn();
  // Timeline: re-render so add/edit affordances appear/disappear.
  if (window._tripData && typeof buildTimeline === 'function') buildTimeline(window._tripData);
  // Activities: re-render the open day so edit controls appear/disappear.
  if (currentCityId && _currentDayDate) selectDay(_currentDayDate);
  // City note (overlay) editability.
  const cn = document.getElementById('city-note-el');
  if (cn) cn.contentEditable = canEdit() ? 'true' : 'false';
  // Notes tab editability.
  document.querySelectorAll('#view-notes .note-card-body').forEach(el => {
    el.contentEditable = canEdit() ? 'true' : 'false';
  });
}

/* Persist the whole current city document to Firestore. */
function persistCity() {
  if (!currentCityId || !currentCity) return;
  tlog(`persistCity: ${currentCityId} → cloud`);
  Store.saveCity(currentCityId, currentCity);
}

let cityMap      = null;
let cityMarkers  = [];   // array of { marker, act, color, num }
let _previewMarker  = null;
let _activeCard     = null;
let _activeMarker   = null;  // currently highlighted marker entry
let currentCity  = null;
let currentCityId = null;
let currentStopItem = null;
let pickMode     = null; // { act, resolve } when user is tapping map to pick

/* Geocode cache — localStorage */
let geoCache = JSON.parse(localStorage.getItem('usa-geocache') || '{}');
function saveGeoCache() { localStorage.setItem('usa-geocache', JSON.stringify(geoCache)); }

const TYPE = {
  work:        { color: '#7c3aed', icon: '💼' },
  sightseeing: { color: '#2f6fed', icon: '🏛️' },
  food:        { color: '#0ea5e9', icon: '🍽️' },
  transport:   { color: '#9ca3af', icon: '🚇' },
  hotel:       { color: '#1e40af', icon: '🏨' },
};

/* ── Adjacent stop finder ───────────────────────────── */
function getAdjacentStops(currentId) {
  const tl = window._tripData?.timeline;
  if (!tl) return { prev: null, next: null };
  const stops = [];
  tl.forEach(item => {
    if (item.type === 'major') stops.push(item);
    else if (item.type === 'waypoints') item.items.forEach(wp => stops.push(wp));
  });
  const idx = stops.findIndex(s => s.id === currentId);
  if (idx === -1) return { prev: null, next: null };
  return { prev: stops[idx - 1] || null, next: stops[idx + 1] || null };
}

/* ── Day theme — rich text, stored per-day inside the city doc ── */
function dayNoteKey(date) { return `usa-daynote-${currentCityId}-${date}`; }

/* Strip HTML down to safe inline tags only */
function _sanitizeNoteHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  // Remove tables, scripts, styles, and all block-level tags
  tmp.querySelectorAll('table,thead,tbody,tr,td,th,script,style,img,br+br').forEach(el => {
    // Replace with space or newline
    el.replaceWith(document.createTextNode(el.tagName === 'TR' ? '\n' : ' '));
  });
  // Unwrap unknown elements, keep safe inline/block tags
  const allowed = new Set(['B','I','U','STRONG','EM','UL','OL','LI','SPAN','BR','DIV','P']);
  tmp.querySelectorAll('*').forEach(el => {
    if (!allowed.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
    } else {
      // Strip all attributes from allowed tags (remove styles, classes, dir, etc.)
      [...el.attributes].forEach(a => el.removeAttribute(a.name));
    }
  });
  // Collapse multiple spaces
  return tmp.innerHTML.replace(/\s{3,}/g, ' ').trim();
}

function saveDayNote(date) {
  if (!date) return;
  const html  = document.getElementById('day-note-content')?.innerHTML || '';
  const clean = _sanitizeNoteHtml(html);
  const day   = currentCity?.days?.find(d => d.date === date);
  if (!day) return;
  if (clean) day.theme = clean; else delete day.theme;
  persistCity();
}

function toggleDayNote() {
  const wrap  = document.getElementById('day-note-wrap');
  const arrow = document.getElementById('day-note-arrow');
  if (!wrap) return;
  const collapsed = wrap.classList.toggle('day-note-collapsed');
  if (arrow) arrow.textContent = collapsed ? '▶' : '▼';
}

function toggleNoteEdit() {
  const content = document.getElementById('day-note-content');
  const toolbar = document.getElementById('day-note-toolbar');
  const btn     = document.getElementById('day-note-edit-btn');
  if (!content) return;
  const editing = content.contentEditable !== 'true';
  content.contentEditable = editing ? 'true' : 'false';
  toolbar.style.display   = editing ? '' : 'none';
  btn.textContent         = editing ? 'Done' : 'Edit';
  btn.classList.toggle('day-note-edit-btn-active', editing);
  if (editing) {
    // Intercept paste — strip to plain text only
    content._pasteHandler = content._pasteHandler || ((e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    content.addEventListener('paste', content._pasteHandler);
    content.focus();
  } else {
    content.removeEventListener('paste', content._pasteHandler);
    saveDayNote(_currentDayDate);
  }
}

function execRteCmd(cmd) {
  document.execCommand(cmd, false, null);
  document.getElementById('day-note-content')?.focus();
  saveDayNote(_currentDayDate);
}

/* ── Open city ──────────────────────────────────────── */
async function openCity(stopItem) {
  currentStopItem = stopItem;
  const filename = stopItem.id;
  // No cloud doc yet (freshly added stop) — open a stub so the user can still navigate.
  const data = await Store.loadCity(filename) || {
    id: filename,
    name: stopItem.name,
    center: [39.8283, -98.5795],
    zoom: 5,
    hotel: { name: 'No plan yet' },
    days: []
  };

  currentCity   = data;
  currentCityId = filename;

  const overlay   = document.getElementById('city-overlay');
  const wasOpen   = overlay.classList.contains('open');

  buildCityDOM(data);
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  // Only the first open adds a history entry; city-to-city navigation reuses it.
  if (!wasOpen) pushOverlay('city', _closeCityNow);

  /* Block taps on activity links for 600ms after opening — prevents ghost-clicks
     from the timeline tap landing on a 🗺️ link inside the freshly-rendered overlay */
  overlay.classList.add('city-opening');
  setTimeout(() => overlay.classList.remove('city-opening'), 600);

  const initAndSelect = () => {
    initMap(data);
    const first = data.days.find(d => d.activities?.length);
    if (first) selectDay(first.date);
  };

  if (wasOpen) {
    /* Navigating between cities — overlay already visible, no transition fires.
       Small rAF delay lets buildCityDOM paint before Leaflet measures the container. */
    requestAnimationFrame(() => setTimeout(initAndSelect, 30));
  } else {
    /* Fresh open — wait for the slide-up transition (350ms) to finish so Leaflet
       measures correct dimensions, especially on mobile. */
    const onTransitionEnd = e => {
      if (e.propertyName !== 'transform') return;
      overlay.removeEventListener('transitionend', onTransitionEnd);
      initAndSelect();
    };
    overlay.addEventListener('transitionend', onTransitionEnd);
  }
}

/* ── Close city ─────────────────────────────────────── */
function closeCity() {
  if (!closeOverlay('city')) _closeCityNow();
}

function _closeCityNow() {
  document.getElementById('city-overlay').classList.remove('open');
  document.body.style.overflow = '';
  if (cityMap) { cityMap.remove(); cityMap = null; }
  cityMarkers  = [];
  currentCity  = null;
  currentCityId = null;
  pickMode     = null;
}

/* ── Build overlay DOM ──────────────────────────────── */
function buildCityDOM(data) {
  const overlay = document.getElementById('city-overlay');
  const { prev, next } = getAdjacentStops(currentStopItem?.id);

  const arrStr = currentStopItem?.arrival ? fmtDateShort(currentStopItem.arrival) : '';
  const depStr = currentStopItem?.departure ? fmtDateShort(currentStopItem.departure) : '';

  const tabsHTML = data.days.map(day => {
    const d   = parseDate(day.date);
    const has = day.activities?.length > 0;
    return `<button class="cdt${has ? '' : ' cdt-empty'}" data-date="${day.date}" onclick="selectDay('${day.date}')">
      <span class="cdt-dow">${DAYS[d.getDay()]}</span>
      <span class="cdt-num">${d.getDate()}</span>
    </button>`;
  }).join('');

  overlay.innerHTML = `
    <div class="city-header">
      <button class="city-back" onclick="closeCity()">‹</button>
      <div class="city-title-block">
        <span class="city-hname">${(currentStopItem?.emoji || PLACES[currentStopItem?.image]?.emoji || '') + ' ' + data.name}</span>
        ${arrStr && depStr ? `<span class="city-hdates">${arrStr} – ${depStr}</span>` : ''}
      </div>
      <div class="city-header-nav">
        ${prev ? `<button class="dest-nav-btn" onclick="openCity(${JSON.stringify(prev).replace(/"/g,'&quot;')})">‹ <span class="city-nav-label">${prev.name}</span></button>` : ''}
        ${next ? `<button class="dest-nav-btn" onclick="openCity(${JSON.stringify(next).replace(/"/g,'&quot;')})"><span class="city-nav-label">${next.name}</span> ›</button>` : ''}
      </div>
      ${data.hotel
        ? `<button class="city-hotel" onclick="openHotelPanel()" title="${data.hotel.name}">🏨</button>`
        : '<span class="city-daytrip" title="Day trip">📍</span>'}
    </div>

    <div class="city-map-wrap">
      <!-- Left sidebar: vertical tabs | content -->
      <div class="act-panel" id="act-panel">
        <div class="sheet-handle" onclick="toggleMobileSheet()"></div>
        <!-- Vertical day-tab strip -->
        <div class="city-day-tabs">${tabsHTML}</div>

        <!-- Right content -->
        <div class="act-panel-content">
          <!-- City-level note (stored on the city doc: cities/{id}.cityNote) -->
          <div class="city-note-wrap" id="city-note-wrap">
            <div class="city-note-hdr" onclick="toggleCityNoteWrap()">
              <span>📝 City Notes</span>
              <span class="day-note-arrow" id="city-note-arrow">▶</span>
            </div>
            <div class="city-note-body collapsed" id="city-note-body">
              <div class="city-note-el" id="city-note-el"
                data-placeholder="Tips, reminders, things to buy…"></div>
            </div>
          </div>

          <!-- Collapsible day theme -->
          <div class="day-note-wrap day-note-collapsed" id="day-note-wrap">
            <div class="day-note-header">
              <span class="day-note-label" onclick="toggleDayNote()" style="cursor:pointer;flex:1">Day theme <span class="day-note-arrow" id="day-note-arrow">▶</span></span>
              <div class="day-note-header-right">
                <div class="day-note-toolbar" id="day-note-toolbar" style="display:none">
                  <button class="rte-btn" onclick="execRteCmd('bold')" title="Bold"><b>B</b></button>
                  <button class="rte-btn" onclick="execRteCmd('italic')" title="Italic"><i>I</i></button>
                  <button class="rte-btn" onclick="execRteCmd('insertUnorderedList')" title="Bullets">•</button>
                </div>
                ${canEdit() ? '<button class="day-note-edit-btn" id="day-note-edit-btn" onclick="toggleNoteEdit()">Edit</button>' : ''}
              </div>
            </div>
            <div class="day-note-body">
              <div class="day-note-content" id="day-note-content" contenteditable="false"
                oninput="saveDayNote(_currentDayDate)"
                data-placeholder="Click Edit to add a theme…"></div>
            </div>
          </div>

          <div class="act-panel-title" id="act-panel-title">
            <span id="act-panel-date">— select a day —</span>
            <div class="act-title-actions">
              <button class="act-add-btn" id="act-add-btn" onclick="openActEditor(-1)" title="Add activity" style="display:none">＋</button>
              <button class="act-compact-btn" id="act-compact-btn" onclick="toggleCompact()" title="Compact view">⊟</button>
            </div>
          </div>
          <div id="day-saved-links"></div>
          <div class="act-list" id="act-list"></div>
        </div>
      </div>

      <!-- Right: map -->
      <div class="city-map-area">
        <div id="city-map"></div>
        <!-- pick-mode banner -->
        <div class="pick-banner" id="pick-banner" style="display:none">
          📍 Tap on the map to set the location
          <button onclick="cancelPick()">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Hotel edit modal -->
    <div class="loc-modal" id="hotel-modal" style="display:none">
      <div class="loc-modal-box">
        <div class="loc-modal-title">🏨 Hotel</div>
        <label class="loc-label">Hotel name</label>
        <input class="loc-input" id="hotel-name-input" type="text" placeholder="Hotel name"/>
        <label class="loc-label" style="margin-top:8px">Booking link <span style="font-weight:400;color:#9ca3af">(optional)</span></label>
        <input class="loc-input" id="hotel-booking-input" type="url" placeholder="https://booking.com/…"/>
        <a class="loc-gmaps-link" id="hotel-gmaps-link" href="#" target="_blank">🌐 Search on Google Maps</a>
        <label class="loc-label">Paste Google Maps link</label>
        <input class="loc-input" id="hotel-paste-input" type="url" placeholder="Paste a Google Maps URL here…"
          oninput="parseHotelGmapsUrl(this.value)"/>
        <label class="loc-label" style="margin-top:4px">Or search by name</label>
        <input class="loc-input" id="hotel-place-input" type="text" placeholder="e.g. The Standard, New York, USA"
          oninput="const v=this.value.trim();document.getElementById('hotel-gmaps-link').href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(v?v+', USA':'USA')"/>
        <div class="loc-coords" id="hotel-coords-display"></div>
        <div class="loc-actions">
          <button class="loc-btn loc-btn-secondary" onclick="hotelPickOnMap()">📍 Tap on map</button>
          <button class="loc-btn loc-btn-secondary" onclick="hotelLocSearch()">🔍 Search</button>
          <button class="loc-btn loc-btn-primary" onclick="saveHotel()">Save</button>
        </div>
        <button class="loc-close" onclick="closeHotelPanel()">✕</button>
      </div>
    </div>

    <!-- Photo paste modal -->
    <div class="loc-modal" id="photo-modal" style="display:none">
      <div class="loc-modal-box">
        <div class="loc-modal-title">📷 Add Photo</div>
        <div class="photo-paste-zone" id="photo-paste-zone" tabindex="0">
          <div class="photo-paste-hint" id="photo-paste-hint">
            <div style="font-size:28px">📋</div>
            <div style="font-weight:600;margin-top:6px">Paste image here</div>
            <div style="font-size:11px;margin-top:3px;opacity:0.6">Ctrl+V &nbsp;·&nbsp; drag & drop</div>
          </div>
          <img id="photo-preview-img" style="display:none;max-width:100%;max-height:180px;object-fit:contain;border-radius:8px;">
        </div>
        <label class="photo-file-label">
          📁 or select a file
          <input type="file" accept="image/*" id="photo-file-input-modal" style="display:none">
        </label>
        <div class="loc-actions" style="margin-top:12px">
          <button class="loc-btn loc-btn-secondary" onclick="closePhotoModal()">Cancel</button>
          <button class="loc-btn loc-btn-primary" id="photo-save-btn" onclick="confirmPhotoUpload()" disabled>Use Photo</button>
        </div>
        <button class="loc-close" onclick="closePhotoModal()">✕</button>
      </div>
    </div>

    <!-- Location edit modal -->
    <div class="loc-modal" id="loc-modal" style="display:none">
      <div class="loc-modal-box">
        <div class="loc-modal-title" id="loc-modal-title">Set Location</div>
        <a class="loc-gmaps-link" id="loc-gmaps-link" href="#" target="_blank">🌐 Search on Google Maps</a>
        <label class="loc-label">Paste Google Maps link</label>
        <input class="loc-input" id="loc-paste-input" type="url" placeholder="Paste a Google Maps URL here…"
          oninput="parseGmapsUrl(this.value)"/>
        <label class="loc-label" style="margin-top:4px">Or search by name</label>
        <input class="loc-input" id="loc-place-input" type="text" placeholder="e.g. Times Square, New York, USA"
          oninput="const v=this.value.trim();document.getElementById('loc-gmaps-link').href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(v?v+', USA':'USA')"/>
        <div class="loc-coords" id="loc-coords-display"></div>
        <div class="loc-actions">
          <button class="loc-btn loc-btn-secondary" onclick="locPickOnMap()">📍 Tap on map</button>
          <button class="loc-btn loc-btn-secondary" onclick="locSearch()">🔍 Search</button>
          <button class="loc-btn loc-btn-primary" id="loc-save-btn" onclick="locSave()" disabled>Save</button>
        </div>
        <button class="loc-close" onclick="closeLocModal()">✕</button>
      </div>
    </div>

    <!-- Activity editor modal -->
    <div class="loc-modal" id="actedit-modal" style="display:none">
      <div class="loc-modal-box">
        <div class="loc-modal-title" id="actedit-title">Edit activity</div>
        <label class="loc-label">Name</label>
        <input class="loc-input" id="actedit-name" type="text" placeholder="Activity name"/>
        <label class="loc-label" style="margin-top:8px">Type</label>
        <select class="loc-input" id="actedit-type">
          <option value="work">💼 Work</option>
          <option value="sightseeing">🏛️ Sightseeing</option>
          <option value="food">🍽️ Food</option>
          <option value="transport">🚇 Transport</option>
          <option value="hotel">🏨 Hotel</option>
        </select>
        <div style="display:flex;gap:8px">
          <div style="flex:1">
            <label class="loc-label" style="margin-top:8px">Start</label>
            <div class="time-field" style="position:relative">
              <input class="loc-input time-input" id="actedit-time" type="text" placeholder="--:--" readonly autocomplete="off" style="cursor:pointer" onclick="_toggleTimeDropdown('actedit-time')"/>
              <div class="time-dropdown" id="actedit-time-dd" style="display:none;position:absolute;top:calc(100% - 6px);left:0;right:0;max-height:min(180px,38vh);overflow-y:auto;background:var(--surface,#fff);border:1.5px solid var(--border,#d1d5db);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,0.22);z-index:50;padding:4px 0"></div>
            </div>
          </div>
          <div style="flex:1">
            <label class="loc-label" style="margin-top:8px">End</label>
            <div class="time-field" style="position:relative">
              <input class="loc-input time-input" id="actedit-timeend" type="text" placeholder="--:--" readonly autocomplete="off" style="cursor:pointer" onclick="_toggleTimeDropdown('actedit-timeend')"/>
              <div class="time-dropdown" id="actedit-timeend-dd" style="display:none;position:absolute;top:calc(100% - 6px);left:0;right:0;max-height:min(180px,38vh);overflow-y:auto;background:var(--surface,#fff);border:1.5px solid var(--border,#d1d5db);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,0.22);z-index:50;padding:4px 0"></div>
            </div>
          </div>
        </div>
        <label class="loc-label" style="margin-top:8px">Notes <span style="font-weight:400;color:#9ca3af">(optional)</span></label>
        <textarea class="loc-input" id="actedit-notes" rows="2" placeholder="Notes…"></textarea>
        <div class="loc-actions">
          <button class="loc-btn loc-btn-secondary loc-btn-danger" id="actedit-delete" style="flex:1" onclick="deleteActEditor()">Delete</button>
          <button class="loc-btn loc-btn-primary" style="flex:2" onclick="saveActEditor()">Save</button>
        </div>
        <button class="loc-close" onclick="closeActEditor()">✕</button>
      </div>
    </div>
  `;

  /* ── Populate city note (after innerHTML set, to avoid XSS) ── */
  const _cnEl = document.getElementById('city-note-el');
  if (_cnEl) {
    _cnEl.contentEditable = canEdit() ? 'true' : 'false';
    const _cnCloud = (typeof data.cityNote === 'string') ? data.cityNote : '';
    const _cnLocal = localStorage.getItem(`usa-city-note-${currentCityId}`);
    /* Prefer the value stored on the city doc; fall back to any legacy local value */
    const _seed = _cnCloud || _cnLocal || '';
    _cnEl.innerHTML = _seed.includes('<') ? _seed : _seed.replace(/\n/g, '<br>');
    _cnEl.addEventListener('input', () => {
      if (!canEdit()) return;
      const v = _cnEl.innerHTML.trim();
      const clean = (v && v !== '<br>') ? v : '';
      if (clean) currentCity.cityNote = clean; else delete currentCity.cityNote;
      persistCity();
    });
    _cnEl.addEventListener('paste', e => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
  }
}

function toggleCityNoteWrap() {
  const body  = document.getElementById('city-note-body');
  const arrow = document.getElementById('city-note-arrow');
  if (!body) return;
  const collapsed = body.classList.toggle('collapsed');
  if (arrow) arrow.textContent = collapsed ? '▶' : '▼';
}

/* ══════════════════════════════════════════════════════
   MAP
══════════════════════════════════════════════════════ */
function initMap(data) {
  if (cityMap) { cityMap.remove(); cityMap = null; }

  cityMap = L.map('city-map', { zoomControl: false });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(cityMap);

  L.control.zoom({ position: 'bottomright' }).addTo(cityMap);

  /* Map click — only active in pick mode */
  cityMap.on('click', e => {
    if (!pickMode) return;
    const { lat, lng } = e.latlng;
    const coords = [+lat.toFixed(6), +lng.toFixed(6)];
    pickMode.resolve(coords);
    pickMode = null;
    exitPickMode();
  });

  if (data.hotel?.coords) addHotelPin(data.hotel);
  cityMap.setView(data.center || [35.6762, 139.6503], data.zoom || 13);

}

function addHotelPin(hotel) {
  const icon = L.divIcon({
    className: '',
    html: `<div class="map-pin-wrap hotel-pin-wrap"><div class="map-pin map-pin-hotel">🏨</div></div>`,
    iconSize: [32, 32], iconAnchor: [16, 32],
  });
  const m = L.marker(hotel.coords, { icon }).addTo(cityMap);
  m._isHotelMarker = true;
  m.bindTooltip(hotel.name, { permanent: false, direction: 'top', offset: [0, -34] });
  m.on('click', () => openHotelPanel());
}

/* ══════════════════════════════════════════════════════
   DAY SELECTION
══════════════════════════════════════════════════════ */
let _selectDayGen = 0;
let _currentDayDate = null;

async function selectDay(dateStr) {
  const gen = ++_selectDayGen;   // each call gets a unique token
  _currentDayDate = dateStr;

  document.querySelectorAll('.cdt').forEach(b =>
    b.classList.toggle('cdt-active', b.dataset.date === dateStr));

  // Scroll active tab into view (important on mobile with many days)
  const activeTab = document.querySelector('.cdt-active');
  if (activeTab) activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

  // Load saved theme for this day (from the city doc; fall back to any legacy localStorage value)
  const noteContent = document.getElementById('day-note-content');
  if (noteContent) {
    const dayRec = currentCity.days.find(d => d.date === dateStr);
    const raw = (dayRec && dayRec.theme) || localStorage.getItem(dayNoteKey(dateStr)) || '';
    noteContent.innerHTML = _sanitizeNoteHtml(raw);
  }

  const day     = currentCity.days.find(d => d.date === dateStr);
  const listEl  = document.getElementById('act-list');

  const dateSpan = document.getElementById('act-panel-date');
  if (dateSpan) dateSpan.textContent = fmtDate(dateStr);

  const addBtn = document.getElementById('act-add-btn');
  if (addBtn) addBtn.style.display = canEdit() ? '' : 'none';

  // Saved links bar
  const savedEl = document.getElementById('day-saved-links');
  if (savedEl) {
    if (day?.saved?.length) {
      savedEl.innerHTML = day.saved.map(l =>
        `<a class="saved-link" href="${l.url}" target="_blank" rel="noopener">${l.text}</a>`
      ).join('');
      savedEl.style.display = '';
    } else {
      savedEl.innerHTML = '';
      savedEl.style.display = 'none';
    }
  }

  if (!day?.activities?.length) {
    listEl.innerHTML = `<p class="act-empty">${day?.note || 'No activities planned for this day yet.'}</p>`;
    clearMarkers();
    return;
  }

  listEl.innerHTML = `<p class="act-empty">📍 Loading pins…</p>`;

  await geocodeActivities(day.activities);

  if (gen !== _selectDayGen) return;   // a newer selectDay call took over — discard

  renderActivityList(day.activities, listEl);
  renderMapMarkers(day.activities);
}

/* ══════════════════════════════════════════════════════
   GEOCODING
══════════════════════════════════════════════════════ */
async function geocodeOne(place) {
  if (!place) return null;
  if (geoCache[place]) return geoCache[place];

  const queries = [place, place.split(',')[0] + ', USA'];
  for (const q of queries) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=en&countrycodes=us`;
      const res = await (await fetch(url)).json();
      if (res[0]) {
        const coords = [+res[0].lat, +res[0].lon];
        geoCache[place] = coords;
        saveGeoCache();
        return coords;
      }
    } catch { break; }
    await sleep(400);
  }
  return null;
}

async function geocodeActivities(activities) {
  for (const act of activities) {
    if (act.coords || act.type === 'transport') continue;
    if (act.place) {
      const coords = await geocodeOne(act.place);
      if (coords) act.coords = coords;
      await sleep(400);
    }
  }
}

/* ══════════════════════════════════════════════════════
   ACTIVITY LIST
══════════════════════════════════════════════════════ */
function renderActivityList(activities, container) {
  container.innerHTML = '';
  let pinNum = 1;

  activities.forEach((act, i) => {
    const isWalk = act.type === 'transport' && /walk/i.test(act.name || '');
    const t      = isWalk ? { color: '#9ca3af', icon: '🚶' } : (TYPE[act.type] || TYPE.sightseeing);
    const hasPin = act.coords && act.type !== 'transport';
    const isLast = i === activities.length - 1;
    const time   = act.timeEnd ? `${act.time}–${act.timeEnd}` : (act.time || '');
    const mapsUrl = act.mapsUrl
      || (act.coords ? `https://www.google.com/maps?q=${act.coords[0]},${act.coords[1]}` : null)
      || (act.place  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(act.place)}` : null);
    const currentPin = hasPin ? pinNum : null;
    if (hasPin) pinNum++;

    const card = document.createElement('div');
    card.className = 'act-card';
    card.id = `act-card-${i}`;
    card.dataset.idx = i;

    /* ── Left col: badge + connector line ── */
    const leftDiv = document.createElement('div');
    leftDiv.className = 'act-left';

    const badge = document.createElement('div');
    if (hasPin) {
      badge.className = 'act-badge';
      badge.style.background = t.color;
      badge.textContent = currentPin;
    } else {
      badge.className = 'act-badge act-badge-icon';
      badge.textContent = t.icon;
    }
    leftDiv.appendChild(badge);
    if (!isLast) {
      const line = document.createElement('div');
      line.className = 'act-line';
      leftDiv.appendChild(line);
    }

    /* ── Photo thumbnail (if set) ── */
    const photoCol = document.createElement('div');
    photoCol.className = 'act-photo-col';
    if (act.photo) {
      const img = document.createElement('img');
      img.className = 'act-photo-thumb';
      img.src = act.photo;
      photoCol.appendChild(img);
    }

    /* ── Right col: text + footer ── */
    const rightDiv = document.createElement('div');
    rightDiv.className = 'act-right';

    if (time) {
      const timeEl = document.createElement('div');
      timeEl.className = 'act-time';
      timeEl.textContent = time;
      rightDiv.appendChild(timeEl);
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'act-name';
    nameEl.textContent = act.name;
    rightDiv.appendChild(nameEl);

    if (act.notes) {
      const notesEl = document.createElement('div');
      notesEl.className = 'act-notes';
      notesEl.textContent = act.notes;
      rightDiv.appendChild(notesEl);
    }

    const foot = document.createElement('div');
    foot.className = 'act-foot';

    /* ── Icon action buttons ── */
    if (mapsUrl) {
      const link = document.createElement('a');
      link.className = 'act-icon-btn';
      link.href = mapsUrl;
      link.target = '_blank';
      link.title = 'Open in Maps';
      link.textContent = '🗺️';
      link.addEventListener('click', e => e.stopPropagation());
      foot.appendChild(link);
    }

    if (act.type !== 'transport' && canEdit()) {
      const locBtn = document.createElement('button');
      locBtn.className = `act-icon-btn ${act.coords ? '' : 'act-icon-btn-missing'}`;
      locBtn.title = act.coords ? 'Edit location' : 'Set location';
      locBtn.textContent = act.coords ? '📌' : '📍';
      locBtn.addEventListener('click', e => { e.stopPropagation(); openLocModal(act.name); });
      foot.appendChild(locBtn);

      if (act.photo) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'act-icon-btn act-icon-btn-danger';
        removeBtn.title = 'Remove photo';
        removeBtn.textContent = '🗑️';
        removeBtn.addEventListener('click', e => { e.stopPropagation(); removePhoto(act); });
        foot.appendChild(removeBtn);
      } else {
        const photoBtn = document.createElement('button');
        photoBtn.className = 'act-icon-btn';
        photoBtn.title = 'Add photo (paste or select file)';
        photoBtn.textContent = '📷';
        photoBtn.addEventListener('click', e => { e.stopPropagation(); openPhotoModal(act); });
        foot.appendChild(photoBtn);
      }
    }

    /* ── Editor controls (all activity types) ── */
    if (canEdit()) {
      const editBtn = document.createElement('button');
      editBtn.className = 'act-icon-btn';
      editBtn.title = 'Edit activity';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', e => { e.stopPropagation(); openActEditor(i); });
      foot.appendChild(editBtn);

      // Whole card reorders by drag: long-press on touch, click-drag on mouse.
      card.classList.add('act-draggable');
      card.addEventListener('pointerdown', e => onCardPointerDown(e, card));
    }

    rightDiv.appendChild(foot);

    /* ── Links row ── */
    if (act.links?.length) {
      const linksRow = document.createElement('div');
      linksRow.className = 'act-links';
      act.links.forEach(lnk => {
        const a = document.createElement('a');
        a.className = 'act-link-chip';
        a.href = lnk.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = lnk.text;
        a.addEventListener('click', e => e.stopPropagation());
        linksRow.appendChild(a);
      });
      rightDiv.appendChild(linksRow);
    }

    card.appendChild(leftDiv);
    card.appendChild(photoCol);
    card.appendChild(rightDiv);

    /* click card → center pin on map */
    if (currentPin) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', e => {
        if (_suppressNextClick) { _suppressNextClick = false; return; }
        if (e.target.closest('button') || e.target.closest('a') || e.target.closest('label')) return;
        focusPin(currentPin);
      });
    }

    container.appendChild(card);
  });
}

/* ══════════════════════════════════════════════════════
   MAP MARKERS — fixed pins
══════════════════════════════════════════════════════ */
function clearMarkers() {
  cityMarkers.forEach(e => e.marker ? e.marker.remove() : e.remove());
  cityMarkers = [];
  _activeMarker = null;
}

function makePin(color, label) {
  return L.divIcon({
    className: '',
    html: `<div class="map-pin-wrap">
             <div class="map-pin" style="background:${color};border-color:${color}">${label}</div>
             <div class="map-pin-tail" style="border-top-color:${color}"></div>
           </div>`,
    iconSize: [28, 38],
    iconAnchor: [14, 38],
    popupAnchor: [0, -38],
  });
}

function setActiveMarker(entry) {
  clearActiveMarker();
  if (!entry) return;
  _activeMarker = entry;
  entry.marker.getElement()?.querySelector('.map-pin-wrap')?.classList.add('pin-active');
  entry.marker.setZIndexOffset(1000);
  cityMap.getContainer().classList.add('has-active-pin');
}

function clearActiveMarker() {
  if (!_activeMarker) return;
  _activeMarker.marker.getElement()?.querySelector('.map-pin-wrap')?.classList.remove('pin-active');
  _activeMarker.marker.setZIndexOffset(0);
  _activeMarker = null;
  cityMap?.getContainer().classList.remove('has-active-pin');
}

const _popupActsMap = {};

function makePopupContent(act) {
  const key = '_a' + Math.random().toString(36).slice(2);
  _popupActsMap[key] = act;
  const time = act.timeEnd ? `${act.time}–${act.timeEnd}` : (act.time || '');
  let html = `<div class="mpc">`;
  if (act.photo) html += `<img class="mpc-photo" src="${act.photo}" onclick="openActDetailCard('${key}')" style="cursor:zoom-in">`;
  html += `<div class="mpc-body">`;
  html += `<div class="mpc-name mpc-name-tap" onclick="openActDetailCard('${key}')" title="View details">${act.name} <span class="mpc-expand-hint">↗</span></div>`;
  if (time) html += `<div class="mpc-time">${time}</div>`;
  if (act.notes) html += `<div class="mpc-notes">${act.notes}</div>`;
  html += `</div></div>`;
  return html;
}

function setActiveCard(actName) {
  clearActiveCard();
  document.querySelectorAll('.act-card').forEach(card => {
    if (card.querySelector('.act-name')?.textContent === actName) {
      card.classList.add('act-card-active');
      _activeCard = card;
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

function clearActiveCard() {
  if (_activeCard) { _activeCard.classList.remove('act-card-active'); _activeCard = null; }
}

function renderMapMarkers(activities) {
  clearMarkers();
  clearActiveCard();
  clearActiveMarker();
  const bounds = [];
  let num = 1;

  activities.forEach(act => {
    if (!act.coords || act.type === 'transport') return;
    const t = TYPE[act.type] || TYPE.sightseeing;
    const entry = { act, color: t.color, num };
    const m = L.marker(act.coords, { icon: makePin(t.color, num) })
      .addTo(cityMap)
      .bindPopup(makePopupContent(act), { maxWidth: 360 });
    entry.marker = m;
    m.on('popupopen',  () => { setActiveCard(act.name); setActiveMarker(entry); });
    m.on('popupclose', () => { clearActiveCard(); clearActiveMarker(); });
    cityMarkers.push(entry);
    bounds.push(act.coords);
    num++;
  });

  if (bounds.length > 1)      cityMap.fitBounds(bounds, { paddingTopLeft: [80, 60], paddingBottomRight: [80, 60], maxZoom: 14 });
  else if (bounds.length === 1) panToVisible(bounds[0], 14);
}

/* Focus a numbered pin on the map */
function focusPin(pinNum) {
  const entry = cityMarkers[pinNum - 1];
  if (!entry) return;
  panToVisible(entry.marker.getLatLng(), null);
  setTimeout(() => entry.marker.openPopup(), 280);
}

/* ══════════════════════════════════════════════════════
   LOCATION MODAL
══════════════════════════════════════════════════════ */
let _locAct = null;
let _locCoords = null;
let _locMapsUrl = null;

/* Hotel edit state */
let _hotelCoords = null;
let _hotelMapsUrl = null;

function _extractCoordsFromUrl(url) {
  let m;
  // !3dlat!4dlng — actual place/pin coords (highest priority)
  m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return [+m[1], +m[2]];
  // q=lat,lng or ll=lat,lng
  m = url.match(/[?&](?:q|ll)=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return [+m[1], +m[2]];
  // @lat,lng — viewport center only, last resort
  m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return [+m[1], +m[2]];
  return null;
}

/* Pan coords into view — map now occupies full height on the right */
function panToVisible(coords, zoom) {
  if (zoom) cityMap.setZoom(zoom, { animate: false });
  cityMap.panTo(coords, { animate: true });
}

/* Orange preview marker shown while the modal is open */
function showPreviewPin(coords) {
  clearPreviewPin();
  _previewMarker = L.marker(coords, {
    icon: L.divIcon({
      className: '',
      html: `<div style="width:22px;height:22px;border-radius:50%;background:#2f6fed;border:3px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.45);animation:pulse-pin .8s infinite alternate"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    }),
    zIndexOffset: 1000,
  }).addTo(cityMap);
}

function clearPreviewPin() {
  if (_previewMarker) { cityMap.removeLayer(_previewMarker); _previewMarker = null; }
}

function _stripDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function _geocodeWithFallbacks(rawName) {
  const stripped = _stripDiacritics(rawName);
  const attempts = [
    rawName + ', USA',
    stripped + ', USA',
    stripped,
    rawName,
    stripped.split(/[-,]/)[0].trim() + ', USA',
  ];
  // Progressively drop trailing words (handles "The Ritz-Carlton New York Central Park" → "The Ritz-Carlton New York")
  const words = stripped.split(' ');
  for (let i = words.length - 1; i >= 2; i--) {
    const shorter = words.slice(0, i).join(' ') + ', USA';
    if (!attempts.includes(shorter)) attempts.push(shorter);
  }
  for (const q of attempts) {
    if (!q.trim()) continue;
    try {
      const res = await (await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=en&countrycodes=us`
      )).json();
      if (res[0]) return [+res[0].lat, +res[0].lon];
    } catch { /* continue */ }
    await sleep(300);
  }
  return null;
}

function _setLocStatus(msg, color) {
  const el = document.getElementById('loc-coords-display');
  if (el) el.textContent = msg;
  const inp = document.getElementById('loc-paste-input');
  if (inp) inp.style.borderColor = color || '';
  document.getElementById('loc-save-btn').disabled = color !== '#22c55e';
}

async function parseGmapsUrl(url) {
  url = url.trim();
  if (!url) return;

  let resolvedUrl = url;

  // Short / share links — resolve server-side (browser can't follow cross-origin redirects)
  if (/share\.google|goo\.gl|maps\.app\.goo\.gl/.test(url)) {
    _setLocStatus('🔄 Resolving link…', '#f59e0b');
    try {
      const res = await fetch('/api/resolve-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.ok) resolvedUrl = (await res.json()).url;
    } catch { /* fall through */ }
  }

  // Try to extract coords directly (full Maps URLs like /maps/place/...@lat,lng)
  const coords = _extractCoordsFromUrl(resolvedUrl);
  if (coords) {
    _locCoords = coords;
    _locMapsUrl = resolvedUrl;
    updateCoordsDisplay();
    showPreviewPin(coords);
    panToVisible(coords, 16);
    document.getElementById('loc-paste-input').style.borderColor = '#22c55e';
    document.getElementById('loc-save-btn').disabled = false;
    return;
  }

  // share.google resolves to a Google Search URL — extract place name from q=
  const qMatch = resolvedUrl.match(/[?&]q=([^&]+)/);
  if (qMatch) {
    const placeName = decodeURIComponent(qMatch[1].replace(/\+/g, ' '));
    document.getElementById('loc-place-input').value = placeName;
    document.getElementById('loc-gmaps-link').href =
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeName)}`;

    _setLocStatus(`🔄 Looking up "${_stripDiacritics(placeName)}"…`, '#f59e0b');

    const geocoded = await _geocodeWithFallbacks(placeName);

    if (geocoded) {
      _locCoords = geocoded;
      _locMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeName)}`;
      updateCoordsDisplay();
      showPreviewPin(geocoded);
      panToVisible(geocoded, 16);
      document.getElementById('loc-paste-input').style.borderColor = '#22c55e';
      document.getElementById('loc-save-btn').disabled = false;
    } else {
      _setLocStatus('❌ Not found — try the search field below', '#ef4444');
    }
    return;
  }

  _setLocStatus('❌ Unrecognised link format', '#ef4444');
}

function openLocModal(actName) {
  /* find activity in current day */
  const allActs = currentCity.days.flatMap(d => d.activities || []);
  _locAct    = allActs.find(a => a.name === actName);
  _locCoords = _locAct?.coords ? [..._locAct.coords] : null;

  _locMapsUrl = _locAct.mapsUrl || null;
  document.getElementById('loc-modal-title').textContent = _locAct.name;
  document.getElementById('loc-paste-input').value = _locAct.mapsUrl || '';
  document.getElementById('loc-paste-input').style.borderColor = _locAct.mapsUrl ? '#22c55e' : '';
  document.getElementById('loc-save-btn').disabled = !_locCoords;
  document.getElementById('loc-place-input').value = _locAct.place || '';
  document.getElementById('loc-gmaps-link').href =
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((_locAct.place || _locAct.name) + ', USA')}`;
  updateCoordsDisplay();

  document.getElementById('loc-modal').style.display = 'flex';
}

function closeLocModal() {
  document.getElementById('loc-modal').style.display = 'none';
  clearPreviewPin();
  _locAct = null; _locCoords = null; _locMapsUrl = null;
}

function updateCoordsDisplay() {
  const el = document.getElementById('loc-coords-display');
  const btn = document.getElementById('loc-save-btn');
  if (_locCoords) {
    el.textContent = `📌 ${_locCoords[0].toFixed(5)}, ${_locCoords[1].toFixed(5)}`;
    el.style.color = '#2e7d32';
    btn.disabled = false;
  } else {
    el.textContent = 'No coordinates set';
    el.style.color = '#9ca3af';
    btn.disabled = true;
  }
}

async function locSearch() {
  const place = document.getElementById('loc-place-input').value.trim();
  if (!place) return;

  /* clear cache for this place so we re-fetch */
  delete geoCache[place];
  saveGeoCache();

  const coords = await geocodeOne(place);
  if (coords) {
    _locCoords = coords;
    updateCoordsDisplay();
    showPreviewPin(coords);
    panToVisible(coords, 16);
  } else {
    alert('Location not found. Try a more specific name or use "Tap on map".');
  }
}

function locPickOnMap() {
  /* close modal, enter pick mode */
  document.getElementById('loc-modal').style.display = 'none';
  enterPickMode();

  /* wait for user to click map */
  new Promise(resolve => { pickMode = { act: _locAct, resolve }; })
    .then(coords => {
      _locCoords = coords;
      document.getElementById('loc-modal').style.display = 'flex';
      updateCoordsDisplay();
    });
}

function enterPickMode() {
  document.getElementById('pick-banner').style.display = 'flex';
  document.getElementById('act-panel').style.pointerEvents = 'none';
  document.getElementById('city-map').style.cursor = 'crosshair';
}

function exitPickMode() {
  document.getElementById('pick-banner').style.display = 'none';
  document.getElementById('act-panel').style.pointerEvents = '';
  document.getElementById('city-map').style.cursor = '';
}

function cancelPick() {
  const wasHotel = pickMode?.isHotel;
  pickMode = null;
  exitPickMode();
  clearPreviewPin();
  if (wasHotel) document.getElementById('hotel-modal').style.display = 'flex';
  else if (_locAct) document.getElementById('loc-modal').style.display = 'flex';
}

async function locSave() {
  if (!_locCoords || !_locAct) return;

  const place = document.getElementById('loc-place-input').value.trim();

  /* update in-memory */
  _locAct.coords = _locCoords;
  if (place) _locAct.place = place;
  if (_locMapsUrl) _locAct.mapsUrl = _locMapsUrl;

  /* update geocache */
  if (place) { geoCache[place] = _locCoords; saveGeoCache(); }

  persistCity();

  clearPreviewPin();
  closeLocModal();

  /* re-render current day */
  const activeDate = document.querySelector('.cdt-active')?.dataset?.date;
  if (activeDate) selectDay(activeDate);
}

/* ══════════════════════════════════════════════════════
   PHOTO UPLOAD / REMOVE
══════════════════════════════════════════════════════ */
async function uploadPhoto(act, file) {
  try {
    act.photo = await Store.uploadPhoto(currentCityId, file);
  } catch (e) {
    console.error('[photo] upload failed', e);
    alert('Couldn\u2019t upload the photo. Please try again.');
    return;
  }
  persistCity();
  const activeDate = document.querySelector('.cdt-active')?.dataset?.date;
  if (activeDate) selectDay(activeDate);
}

async function removePhoto(act) {
  try {
    await Store.deletePhoto(act.photo);
    delete act.photo;
  } catch {
    alert('Couldn\u2019t remove the photo. Please try again.');
    return;
  }
  persistCity();
  const activeDate = document.querySelector('.cdt-active')?.dataset?.date;
  if (activeDate) selectDay(activeDate);
}

/* ══════════════════════════════════════════════════════
   HOTEL PANEL
══════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════
   ACTIVITY EDITOR
══════════════════════════════════════════════════════ */
let _editActArr = null, _editActIdx = -1;

function _currentDayActivities() {
  const day = currentCity?.days.find(d => d.date === _currentDayDate);
  if (!day) return null;
  if (!day.activities) day.activities = [];
  return day.activities;
}

/* ── Time dropdown (Google-Calendar style list, 24h, 15-min steps) ── */
let _timeOptsCache = null;
function _timeOptions() {
  if (_timeOptsCache) return _timeOptsCache;
  const arr = [];
  for (let h = 0; h < 24; h++)
    for (let m = 0; m < 60; m += 15)
      arr.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  _timeOptsCache = arr;
  return arr;
}
function _closeTimeDropdowns() {
  document.querySelectorAll('.time-dropdown').forEach(d => { d.style.display = 'none'; });
}
function _toggleTimeDropdown(inputId) {
  const dd = document.getElementById(inputId + '-dd');
  if (!dd) return;
  const wasOpen = dd.style.display === 'block';
  _closeTimeDropdowns();
  if (wasOpen) return;
  const cur = (document.getElementById(inputId).value || '').trim();
  dd.innerHTML = _timeOptions().map(t =>
    `<div class="time-opt${t === cur ? ' time-opt-sel' : ''}" style="padding:6px 14px;font-size:13px;line-height:1.1;cursor:pointer${t === cur ? ';font-weight:700' : ''}" onclick="_pickTime('${inputId}','${t}')">${t}</div>`
  ).join('');
  dd.style.display = 'block';
  const sel = dd.querySelector('.time-opt-sel');
  if (sel) sel.scrollIntoView({ block: 'center' }); else dd.scrollTop = 0;
}
function _pickTime(inputId, val) {
  document.getElementById(inputId).value = val;
  _closeTimeDropdowns();
}
if (!window._timeDdBound) {
  window._timeDdBound = true;
  document.addEventListener('click', e => {
    if (!e.target.closest('.time-field')) _closeTimeDropdowns();
  });
}

function openActEditor(idx) {
  if (!canEdit()) return;
  const arr = _currentDayActivities();
  if (!arr) { alert('Select a day first.'); return; }
  _editActArr = arr;
  _editActIdx = idx;
  const act = idx >= 0 ? arr[idx] : { name: '', type: 'sightseeing', time: '', timeEnd: '', notes: '' };
  document.getElementById('actedit-title').textContent = idx >= 0 ? 'Edit activity' : 'Add activity';
  document.getElementById('actedit-name').value = act.name || '';
  document.getElementById('actedit-type').value = act.type || 'sightseeing';
  document.getElementById('actedit-time').value = act.time || '';
  document.getElementById('actedit-timeend').value = act.timeEnd || '';
  document.getElementById('actedit-notes').value = act.notes || '';
  document.getElementById('actedit-delete').style.display = idx >= 0 ? '' : 'none';
  document.getElementById('actedit-modal').style.display = 'flex';
  pushOverlay('act-edit', _closeActEditorNow);
}

function closeActEditor() {
  if (!closeOverlay('act-edit')) _closeActEditorNow();
}

function _closeActEditorNow() {
  _closeTimeDropdowns();
  document.getElementById('actedit-modal').style.display = 'none';
  _editActArr = null; _editActIdx = -1;
}

function saveActEditor() {
  if (!_editActArr) return;
  const name = document.getElementById('actedit-name').value.trim();
  if (!name) { alert('Name is required.'); return; }
  const rec = _editActIdx >= 0 ? _editActArr[_editActIdx] : {};
  rec.name    = name;
  rec.type    = document.getElementById('actedit-type').value;
  rec.time    = document.getElementById('actedit-time').value.trim();
  rec.timeEnd = document.getElementById('actedit-timeend').value.trim();
  const notes = document.getElementById('actedit-notes').value.trim();
  if (notes) rec.notes = notes; else delete rec.notes;
  if (_editActIdx < 0) _editActArr.push(rec);
  persistCity();
  closeActEditor();
  if (_currentDayDate) selectDay(_currentDayDate);
}

async function deleteActEditor() {
  if (!_editActArr || _editActIdx < 0) return;
  const ok = await uiConfirm({
    title: 'Delete activity?',
    message: 'This activity will be permanently removed.',
    confirmText: 'Delete',
  });
  if (!ok) return;
  const act = _editActArr[_editActIdx];
  if (act?.photo && typeof Store !== 'undefined' && Store.isConfigured()) Store.deletePhoto(act.photo);
  _editActArr.splice(_editActIdx, 1);
  persistCity();
  closeActEditor();
  if (_currentDayDate) selectDay(_currentDayDate);
}

/* ── Drag-to-reorder: whole card (long-press on touch, click-drag on mouse) ── */
let _drag = null;        // active drag { card, container }
let _dragArm = null;     // pending arm before drag begins
let _suppressNextClick = false;
const _DRAG_THRESHOLD = 8;
const _LONGPRESS_MS = 260;

function onCardPointerDown(e, card) {
  if (!canEdit()) return;
  // Let taps on buttons/links/inputs behave normally.
  if (e.target.closest('button, a, input, select, label, textarea')) return;
  const container = document.getElementById('act-list');
  if (!container) return;
  const isTouch = e.pointerType !== 'mouse';
  _dragArm = { card, container, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, isTouch, armed: false, timer: null };
  if (isTouch) _dragArm.timer = setTimeout(beginDrag, _LONGPRESS_MS);
  document.addEventListener('pointermove', onArmMove);
  document.addEventListener('pointerup', onArmUp);
  document.addEventListener('pointercancel', onArmUp);
}

function beginDrag() {
  if (!_dragArm) return;
  const { card, pointerId } = _dragArm;
  card.classList.add('act-dragging');
  try { card.setPointerCapture(pointerId); } catch {}
  _drag = { card, container: _dragArm.container };
  _dragArm.armed = true;
}

function onArmMove(e) {
  if (!_dragArm) return;
  if (!_dragArm.armed) {
    const dx = Math.abs(e.clientX - _dragArm.startX);
    const dy = Math.abs(e.clientY - _dragArm.startY);
    if (_dragArm.isTouch) {
      // Movement before the long-press = the user is scrolling → let them.
      if (dx > _DRAG_THRESHOLD || dy > _DRAG_THRESHOLD) cancelArm();
      return;
    }
    if (dx > _DRAG_THRESHOLD || dy > _DRAG_THRESHOLD) beginDrag();
    else return;
  }
  e.preventDefault();
  const { card, container } = _drag;
  const y = e.clientY;
  const others = [...container.querySelectorAll('.act-card:not(.act-dragging)')];
  let ref = null;
  for (const c of others) {
    const r = c.getBoundingClientRect();
    if (y < r.top + r.height / 2) { ref = c; break; }
  }
  if (ref) container.insertBefore(card, ref);
  else container.appendChild(card);
}

function cancelArm() {
  if (_dragArm?.timer) clearTimeout(_dragArm.timer);
  _removeArmListeners();
  _dragArm = null;
}

function onArmUp() {
  const dragging = !!(_dragArm && _dragArm.armed && _drag);
  if (_dragArm?.timer) clearTimeout(_dragArm.timer);
  _removeArmListeners();
  _dragArm = null;
  if (dragging) commitDrag();
}

function _removeArmListeners() {
  document.removeEventListener('pointermove', onArmMove);
  document.removeEventListener('pointerup', onArmUp);
  document.removeEventListener('pointercancel', onArmUp);
}

function commitDrag() {
  const { card, container } = _drag;
  card.classList.remove('act-dragging');
  _suppressNextClick = true;
  setTimeout(() => { _suppressNextClick = false; }, 350);
  const arr = _currentDayActivities();
  if (arr) {
    const order = [...container.querySelectorAll('.act-card')].map(c => +c.dataset.idx);
    const reordered = order.map(i => arr[i]).filter(Boolean);
    if (reordered.length === arr.length) {
      arr.length = 0;
      reordered.forEach(a => arr.push(a));
      persistCity();
      tlog('reorder →', order.join(','));
    }
  }
  _drag = null;
  if (_currentDayDate) selectDay(_currentDayDate);
}

/* ══════════════════════════════════════════════════════
   AUTH UI
══════════════════════════════════════════════════════ */
function showAuthScreen() {
  const s = document.getElementById('auth-screen');
  if (s) s.style.display = 'flex';
}
function hideAuthScreen() {
  const s = document.getElementById('auth-screen');
  if (s) s.style.display = 'none';
}

function handleAuthClick() {
  if (typeof Store === 'undefined') return;
  if (Store.isSignedIn()) Store.signOut();
  else showAuthScreen();
}

async function signInWithGoogle() {
  const status = document.getElementById('auth-status');
  const btn = document.getElementById('auth-google-btn');
  if (status) { status.style.color = '#6b7280'; status.textContent = 'Opening Google…'; }
  if (btn) btn.disabled = true;
  const res = await Store.signIn();
  if (btn) btn.disabled = false;
  if (!res || !res.ok) {
    console.error('[auth] sign-in failed:', res && (res.code || res.error));
    if (status) { status.style.color = '#ef4444'; status.textContent = _friendlyAuthError(res); }
  } else if (status) {
    status.textContent = '';
  }
  // Success/approval handling happens in _updateAuthUI (fired by onAuthChange).
}

function _friendlyAuthError(res) {
  const code = (res && res.code) || '';
  if (code.includes('popup-blocked')) return 'Please allow pop-ups and try again.';
  if (code.includes('popup-closed') || code.includes('cancelled-popup') || code.includes('canceled'))
    return 'Sign-in was canceled.';
  return 'Couldn\u2019t sign in. Please try again.';
}

async function refreshApproval() {
  const status = document.getElementById('auth-status');
  if (status) { status.style.color = '#6b7280'; status.textContent = 'Checking…'; }
  await Store.recheckApproval();
}

function _updateAuthUI(user) {
  const btn     = document.getElementById('auth-btn');
  const gbtn    = document.getElementById('auth-google-btn');
  const sub     = document.getElementById('auth-sub');
  const status  = document.getElementById('auth-status');
  const signout = document.getElementById('auth-signout-btn');
  const recheck = document.getElementById('auth-recheck-btn');

  // Auth has now resolved → drop the loading splash so real state can show.
  document.getElementById('auth-screen')?.classList.remove('auth-loading');

  // No cloud configured → don't gate (local dev fallback).
  if (!Store.isConfigured()) {
    if (btn) btn.style.display = 'none';
    updateEditModeBtn();
    hideAuthScreen();
    return;
  }

  if (btn) {
    btn.style.display = '';
    btn.textContent = user ? 'Sign out' : 'Sign in';
    btn.title = user ? (user.email || '') : 'Sign in';
  }

  if (!user) {
    // Locked — must sign in to enter the app.
    tlog('gate: locked (not signed in)');
    if (sub) sub.textContent = 'Sign in to continue';
    if (gbtn) gbtn.style.display = '';
    if (signout) signout.style.display = 'none';
    if (recheck) recheck.style.display = 'none';
    if (status) status.textContent = '';
    showAuthScreen();
  } else if (!Store.isApproved()) {
    // Signed in but not yet approved. Keep the UI friendly; log the real reason.
    tlog('gate: pending approval for', user.email);
    const err = (Store.approvalError && Store.approvalError()) || '';
    if (err) console.warn('[auth] approval not readable:', err, '— verify Firestore rules are published.');
    if (sub) sub.textContent = 'Waiting for approval';
    if (gbtn) gbtn.style.display = 'none';
    if (signout) signout.style.display = '';
    if (recheck) recheck.style.display = '';
    if (status) {
      status.style.color = '#b45309';
      status.textContent = 'Your account isn\u2019t approved yet. Ask the trip owner for access.';
    }
    showAuthScreen();
  } else {
    // Approved — unlock the app.
    tlog('gate: approved — unlocking app for', user.email);
    if (recheck) recheck.style.display = 'none';
    hideAuthScreen();
  }

  // Show/hide the edit-mode toggle based on whether this account can edit.
  updateEditModeBtn();

  // Timeline may gain/lose edit affordances once approval resolves.
  if (window._tripData && typeof buildTimeline === 'function') buildTimeline(window._tripData);

  // Re-render the open day so edit controls appear/disappear.
  if (currentCityId && _currentDayDate) selectDay(_currentDayDate);
}

if (typeof Store !== 'undefined') {
  Store.onAuthChange(_updateAuthUI);
  // Gate immediately on load until auth resolves (only when cloud is configured).
  if (Store.isConfigured()) showAuthScreen(); else hideAuthScreen();
}

/* ══════════════════════════════════════════════════════
   HOTEL PANEL
══════════════════════════════════════════════════════ */
function openHotelPanel() {
  const hotel = currentCity.hotel;
  _hotelCoords = hotel.coords ? [...hotel.coords] : null;
  _hotelMapsUrl = hotel.mapsUrl || null;

  document.getElementById('hotel-name-input').value = hotel.name || '';
  document.getElementById('hotel-booking-input').value = hotel.bookingUrl || '';
  document.getElementById('hotel-paste-input').value = '';
  document.getElementById('hotel-paste-input').style.borderColor = '';
  document.getElementById('hotel-place-input').value = hotel.place || '';
  const q = hotel.place || hotel.name || '';
  document.getElementById('hotel-gmaps-link').href =
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q + ', USA')}`;
  updateHotelCoordsDisplay();

  document.getElementById('hotel-modal').style.display = 'flex';
  pushOverlay('hotel', _closeHotelPanelNow);

  if (_hotelCoords && cityMap) {
    panToVisible(_hotelCoords, 15);
    showPreviewPin(_hotelCoords);
  }
}

function closeHotelPanel() {
  if (!closeOverlay('hotel')) _closeHotelPanelNow();
}

function _closeHotelPanelNow() {
  document.getElementById('hotel-modal').style.display = 'none';
  if (pickMode?.isHotel) { pickMode = null; exitPickMode(); }
  clearPreviewPin();
  _hotelCoords = null;
  _hotelMapsUrl = null;
}

function updateHotelCoordsDisplay() {
  const el  = document.getElementById('hotel-coords-display');
  if (_hotelCoords) {
    el.textContent = `📌 ${_hotelCoords[0].toFixed(5)}, ${_hotelCoords[1].toFixed(5)}`;
    el.style.color = '#2e7d32';
  } else {
    el.textContent = 'No coordinates set';
    el.style.color = '#9ca3af';
  }
}

async function parseHotelGmapsUrl(url) {
  url = url.trim();
  if (!url) return;

  const pasteInput = document.getElementById('hotel-paste-input');

  let resolvedUrl = url;
  if (/share\.google|goo\.gl|maps\.app\.goo\.gl/.test(url)) {
    pasteInput.style.borderColor = '#f59e0b';
    try {
      const res = await fetch('/api/resolve-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.ok) resolvedUrl = (await res.json()).url;
    } catch { /* fallthrough */ }
  }

  // Try direct coord extraction (full Maps URLs like /maps/place/...@lat,lng)
  const coords = _extractCoordsFromUrl(resolvedUrl);
  if (coords) {
    _hotelCoords = coords;
    _hotelMapsUrl = resolvedUrl;
    updateHotelCoordsDisplay();
    showPreviewPin(coords);
    panToVisible(coords, 16);
    pasteInput.style.borderColor = '#22c55e';
    return;
  }

  // share.google often resolves to a Google Search URL — extract place name from q=
  const qMatch = resolvedUrl.match(/[?&]q=([^&]+)/);
  if (qMatch) {
    const placeName = decodeURIComponent(qMatch[1].replace(/\+/g, ' '));
    document.getElementById('hotel-place-input').value = placeName;
    document.getElementById('hotel-gmaps-link').href =
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeName)}`;

    const geocoded = await _geocodeWithFallbacks(placeName);
    if (geocoded) {
      _hotelCoords = geocoded;
      _hotelMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeName)}`;
      updateHotelCoordsDisplay();
      showPreviewPin(geocoded);
      panToVisible(geocoded, 16);
      pasteInput.style.borderColor = '#22c55e';
    } else {
      pasteInput.style.borderColor = '#ef4444';
    }
    return;
  }

  pasteInput.style.borderColor = '#ef4444';
}

async function hotelLocSearch() {
  const place = document.getElementById('hotel-place-input').value.trim();
  if (!place) return;
  const coords = await _geocodeWithFallbacks(place);
  if (coords) {
    _hotelCoords = coords;
    updateHotelCoordsDisplay();
    showPreviewPin(coords);
    panToVisible(coords, 16);
  } else {
    alert('Location not found. Try a more specific name or use "Tap on map".');
  }
}

function hotelPickOnMap() {
  document.getElementById('hotel-modal').style.display = 'none';
  enterPickMode();
  new Promise(resolve => { pickMode = { isHotel: true, resolve }; })
    .then(coords => {
      _hotelCoords = coords;
      document.getElementById('hotel-modal').style.display = 'flex';
      updateHotelCoordsDisplay();
      showPreviewPin(coords);
    });
}

async function saveHotel() {
  const hotel = currentCity.hotel;
  const name       = document.getElementById('hotel-name-input').value.trim();
  const bookingUrl = document.getElementById('hotel-booking-input').value.trim();
  const place      = document.getElementById('hotel-place-input').value.trim();

  if (name)       hotel.name       = name;
  if (bookingUrl) hotel.bookingUrl = bookingUrl;
  if (place)      hotel.place      = place;
  if (_hotelCoords)  hotel.coords  = _hotelCoords;
  if (_hotelMapsUrl) hotel.mapsUrl = _hotelMapsUrl;

  /* Update header button tooltip */
  const hotelBtn = document.querySelector('.city-hotel');
  if (hotelBtn) hotelBtn.title = hotel.name;

  persistCity();

  clearPreviewPin();
  closeHotelPanel();

  /* Refresh hotel pin on map */
  if (cityMap) {
    cityMap.eachLayer(layer => { if (layer._isHotelMarker) cityMap.removeLayer(layer); });
    if (hotel.coords) addHotelPin(hotel);
  }
}

/* ══════════════════════════════════════════════════════
   PHOTO PASTE MODAL
══════════════════════════════════════════════════════ */
let _photoAct        = null;
let _photoPendingBlob = null;

function openPhotoModal(act) {
  _photoAct         = act;
  _photoPendingBlob = null;

  const modal = document.getElementById('photo-modal');
  document.getElementById('photo-paste-hint').style.display = 'flex';
  document.getElementById('photo-preview-img').style.display = 'none';
  document.getElementById('photo-save-btn').disabled = true;
  modal.style.display = 'flex';
  pushOverlay('photo-modal', () => { modal.style.display = 'none'; _photoAct = null; _photoPendingBlob = null; });

  // Wire file input
  const fileInput = document.getElementById('photo-file-input-modal');
  fileInput.value = '';
  fileInput.onchange = () => { if (fileInput.files[0]) _setPhotoBlob(fileInput.files[0]); };

  // Wire drag & drop on paste zone
  const zone = document.getElementById('photo-paste-zone');
  zone.ondragover = e => { e.preventDefault(); zone.classList.add('photo-paste-drag'); };
  zone.ondragleave = () => zone.classList.remove('photo-paste-drag');
  zone.ondrop = e => {
    e.preventDefault();
    zone.classList.remove('photo-paste-drag');
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith('image/')) _setPhotoBlob(f);
  };

  zone.focus();
}

function closePhotoModal() {
  if (closeOverlay('photo-modal')) return;
  const modal = document.getElementById('photo-modal');
  if (modal) modal.style.display = 'none';
  _photoAct         = null;
  _photoPendingBlob = null;
}

function _setPhotoBlob(blob) {
  _photoPendingBlob = blob;
  const img = document.getElementById('photo-preview-img');
  img.src = URL.createObjectURL(blob);
  img.style.display = 'block';
  document.getElementById('photo-paste-hint').style.display = 'none';
  document.getElementById('photo-save-btn').disabled = false;
}

async function confirmPhotoUpload() {
  if (!_photoAct || !_photoPendingBlob) return;
  const act  = _photoAct;
  const blob = _photoPendingBlob;
  closePhotoModal();
  await uploadPhoto(act, blob);
}

// Global paste listener — only fires when photo modal is open
document.addEventListener('paste', e => {
  const modal = document.getElementById('photo-modal');
  if (!modal || modal.style.display === 'none') return;
  const imgItem = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
  if (imgItem) { e.preventDefault(); _setPhotoBlob(imgItem.getAsFile()); }
});

/* ══════════════════════════════════════════════════════
   COMPACT / EXPAND TOGGLE
══════════════════════════════════════════════════════ */
function toggleCompact() {
  const list = document.getElementById('act-list');
  const btn  = document.getElementById('act-compact-btn');
  if (!list) return;
  const isCompact = list.classList.toggle('acts-compact');
  if (btn) {
    btn.textContent = isCompact ? '⊞' : '⊟';
    btn.title       = isCompact ? 'Full view' : 'Compact view';
  }
}

/* ══════════════════════════════════════════════════════
   MOBILE BOTTOM SHEET
══════════════════════════════════════════════════════ */
function toggleMobileSheet() {
  const wrap = document.querySelector('.city-map-wrap');
  if (!wrap) return;
  wrap.classList.toggle('sheet-expanded');
  // Let map redraw after CSS transition finishes
  if (cityMap) setTimeout(() => cityMap.invalidateSize(), 320);
}

/* ══════════════════════════════════════════════════════
   ACT DETAIL CARD  (full-screen card from map pin popup)
══════════════════════════════════════════════════════ */
function openActDetailCard(key) {
  const act = _popupActsMap[key];
  if (!act) return;

  const time = act.timeEnd ? `${act.time}–${act.timeEnd}` : (act.time || '');

  const linksHtml = act.links?.length
    ? `<div class="adc-links">${act.links.map(l =>
        `<a class="adc-link" href="${l.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${l.text}</a>`
      ).join('')}</div>`
    : '';

  const mapsHtml = act.mapsUrl
    ? `<a class="adc-link adc-link-maps" href="${act.mapsUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🗺️ Open in Maps</a>`
    : '';

  const html = `
    <div class="adc-card" onclick="event.stopPropagation()">
      ${act.photo ? `<div class="adc-photo-wrap"><img class="adc-photo" src="${act.photo}" alt="${act.name}"></div>` : ''}
      <div class="adc-body">
        <div class="adc-name">${act.name}</div>
        ${time   ? `<div class="adc-time">${time}</div>` : ''}
        ${act.notes ? `<div class="adc-notes">${act.notes}</div>` : ''}
        ${linksHtml}
        ${mapsHtml ? `<div class="adc-links">${mapsHtml}</div>` : ''}
      </div>
    </div>
    <button class="adc-close" onclick="closeActDetailCard()">✕</button>
  `;

  let overlay = document.getElementById('act-detail-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'act-detail-overlay';
    overlay.addEventListener('click', closeActDetailCard);
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = html;
  overlay.classList.add('open');
  pushOverlay('act-card', () => overlay.classList.remove('open'));
}

function closeActDetailCard() {
  if (!closeOverlay('act-card')) document.getElementById('act-detail-overlay')?.classList.remove('open');
}

/* ══════════════════════════════════════════════════════
   PHOTO LIGHTBOX
══════════════════════════════════════════════════════ */
function openPhotoLightbox(src, caption) {
  let lb = document.getElementById('photo-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'photo-lightbox';
    lb.innerHTML = `
      <button class="photo-lb-close">✕</button>
      <img id="photo-lb-img" src="" alt="">
      <div id="photo-lb-caption"></div>
    `;
    lb.addEventListener('click', e => {
      if (e.target === lb || e.target.classList.contains('photo-lb-close')) closePhotoLightbox();
    });
    document.body.appendChild(lb);
  }
  document.getElementById('photo-lb-img').src = src;
  const cap = document.getElementById('photo-lb-caption');
  cap.textContent = caption || '';
  cap.style.display = caption ? '' : 'none';
  lb.classList.add('open');
  pushOverlay('lightbox', () => lb.classList.remove('open'));
}

function closePhotoLightbox() {
  if (!closeOverlay('lightbox')) document.getElementById('photo-lightbox')?.classList.remove('open');
}

/* ══════════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════════ */
const sleep = ms => new Promise(r => setTimeout(r, ms));
