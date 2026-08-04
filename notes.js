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
      <div class="note-card-body" id="gnote" contenteditable="true"
        data-placeholder="Packing list · Apps to download · Reminders · Links…"></div>
    </div>`;

  stops.forEach(s => {
    const p = (typeof PLACES !== 'undefined' ? PLACES[s.image] : null) || { emoji: '📍' };
    html += `<div class="note-card">
      <div class="note-card-hdr">
        <span class="note-card-icon">${p.emoji}</span>
        <span class="note-card-title">${s.name}</span>
      </div>
      <div class="note-card-body" id="cnote-${s.id}" contenteditable="true"
        data-placeholder="Notes for ${s.name}…"></div>
    </div>`;
  });

  html += `</div>`;
  view.innerHTML = html;

  /* ── Wire up each note area ── */
  function wireNote(el, storageKey, defaultContent = '') {
    if (!el) return;
    /* Load saved content, fall back to defaultContent from trip data */
    const seed = defaultContent ? defaultContent.replace(/\n/g, '<br>') : '';
    el.innerHTML = localStorage.getItem(storageKey) || seed;
    /* Save on input */
    el.addEventListener('input', () => {
      const v = el.innerHTML.trim();
      if (v && v !== '<br>') localStorage.setItem(storageKey, v);
      else localStorage.removeItem(storageKey);
    });
    /* Plain-text paste only */
    el.addEventListener('paste', e => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
  }

  wireNote(document.getElementById('gnote'), 'global-note');
  stops.forEach(s => wireNote(document.getElementById(`cnote-${s.id}`), `city-note-${s.id}`, s.defaultNote));
}
