/* ═══════════════════════════════════════════════════════
   notes.js — Notes tab renderer
═══════════════════════════════════════════════════════ */

function renderNotesTab() {
  const view = document.getElementById('view-notes');
  if (!view) return;

  const data  = window._tripData;
  const stops = [];
  if (data) {
    data.timeline.forEach(item => {
      if (item.type === 'major') {
        stops.push({ id: item.id, name: item.name, image: item.image, defaultNote: item.defaultNote || '' });
      } else if (item.type === 'waypoints') {
        item.items.forEach(wp => stops.push({ id: wp.id, name: wp.name, image: wp.image, defaultNote: wp.defaultNote || '' }));
      }
    });
  }

  /* ── Build skeleton HTML (bodies populated below to avoid XSS) ── */
  let html = `<div class="notes-tab-content">
    <div class="note-card note-card-global">
      <div class="note-card-hdr">
        <span class="note-card-icon">🌐</span>
        <span class="note-card-title">General Notes</span>
      </div>
      <div class="note-card-body" id="gnote"
        data-placeholder="Packing list · Apps to download · Reminders · Links…"></div>
    </div>`;

  stops.forEach(s => {
    const p = (typeof PLACES !== 'undefined' ? PLACES[s.image] : null) || { emoji: '📍' };
    html += `<div class="note-card">
      <div class="note-card-hdr">
        <span class="note-card-icon">${s.emoji || p.emoji}</span>
        <span class="note-card-title">${s.name}</span>
      </div>
      <div class="note-card-body" id="cnote-${s.id}"
        data-placeholder="Notes for ${s.name}…"></div>
    </div>`;
  });

  html += `</div>`;
  view.innerHTML = html;

  const cloud = (typeof Store !== 'undefined' && Store.isConfigured());

  /* ── Wire up a note area ──
     opts: { kind:'general' }  or  { kind:'city', cityId, defaultContent }
     Cloud storage (Firestore) when configured:
       · general note → cities/_general.note
       · city note    → cities/{id}.cityNote
     Falls back to localStorage when not signed-in/approved. */
  async function wireNote(el, opts) {
    if (!el) return;
    const lsKey  = opts.kind === 'general' ? 'usa-global-note' : `usa-city-note-${opts.cityId}`;
    const docId  = opts.kind === 'general' ? '_general' : opts.cityId;
    const field  = opts.kind === 'general' ? 'note' : 'cityNote';
    const seed   = opts.defaultContent ? opts.defaultContent.replace(/\n/g, '<br>') : '';

    /* ── Load ── */
    let cloudVal = null;
    if (cloud) {
      try {
        const doc = await Store.loadCity(docId);
        if (doc && typeof doc[field] === 'string') cloudVal = doc[field];
      } catch { /* denied / offline → fall back below */ }
    }
    const raw = (cloudVal != null && cloudVal !== '')
      ? cloudVal
      : (localStorage.getItem(lsKey) || seed);
    el.innerHTML = raw.includes('<') ? raw : raw.replace(/\n/g, '<br>');

    /* View mode → read-only */
    const _editable = (typeof canEdit === 'function') ? canEdit() : true;
    el.contentEditable = _editable ? 'true' : 'false';

    /* ── Save on input ── */
    el.addEventListener('input', () => {
      if (typeof canEdit === 'function' && !canEdit()) return;
      const v = el.innerHTML.trim();
      const clean = (v && v !== '<br>') ? v : '';
      if (cloud && Store.canEdit()) {
        Store.saveCityFields(docId, { [field]: clean });
      } else if (clean) {
        localStorage.setItem(lsKey, clean);
      } else {
        localStorage.removeItem(lsKey);
      }
    });

    /* ── Plain-text paste only ── */
    el.addEventListener('paste', e => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
  }

  wireNote(document.getElementById('gnote'), { kind: 'general' });
  stops.forEach(s => wireNote(
    document.getElementById(`cnote-${s.id}`),
    { kind: 'city', cityId: s.id, defaultContent: s.defaultNote }
  ));
}
