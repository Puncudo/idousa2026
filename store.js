/* ═══════════════════════════════════════════════════════
   store.js — cloud persistence + auth for USA Trip 2026
   Wraps Firebase (compat SDK, global `firebase`) behind a small API.
   Degrades gracefully to read-only if Firebase isn't configured.
════════════════════════════════════════════════════════════ */

/* Step logging — visible in the browser console. */
function tlog(...a)  { console.log('%c[trip]', 'color:#0a3161;font-weight:700', ...a); }
function twarn(...a) { console.warn('%c[trip]', 'color:#b45309;font-weight:700', ...a); }
function terr(...a)  { console.error('%c[trip]', 'color:#ef4444;font-weight:700', ...a); }

const Store = (() => {
  let _ready = false;          // Firebase initialised & configured
  let _db = null, _auth = null, _storage = null;
  let _user = null;
  let _approved = false;        // is the signed-in email approved in Firestore?
  let _approvalError = null;    // why the last approval check failed (if any)
  const _authListeners = [];
  const _saveTimers = {};      // per-city debounce timers

  const _configured = typeof firebaseConfig !== 'undefined'
    && firebaseConfig.apiKey
    && !firebaseConfig.apiKey.startsWith('TODO');

  function init() {
    tlog('init: configured =', _configured, _configured ? `(project ${firebaseConfig.projectId})` : '');
    if (_ready) { tlog('init: already initialised'); return; }
    if (!_configured) { twarn('init: Firebase not configured — running in local/read-only mode'); return; }
    if (typeof firebase === 'undefined') { terr('init: Firebase SDK not loaded'); return; }
    try {
      firebase.initializeApp(firebaseConfig);
      _auth    = firebase.auth();
      _db      = firebase.firestore();
      _storage = firebase.storage();
      // Cached reads keep the app usable offline now that there is no bundled JSON.
      _db.enablePersistence({ synchronizeTabs: true })
        .then(() => tlog('init: offline persistence enabled'))
        .catch(e => twarn('init: offline persistence unavailable', e?.code || e?.message));
      tlog('init: Firebase app + auth + firestore + storage ready');
    } catch (e) {
      terr('init: Firebase initialisation failed', e);
      return;
    }
    _auth.onAuthStateChanged(async u => {
      _user = u;
      _approved = false;
      _approvalError = null;
      if (u) {
        tlog('auth: signed in as', u.email, '(verified:', u.emailVerified + ')');
        await _checkApproval(u, 'auth-change');
      } else {
        tlog('auth: signed out (no user)');
      }
      tlog('auth: notifying', _authListeners.length, 'listener(s) · canEdit =', canEdit());
      _authListeners.forEach(fn => { try { fn(u); } catch (e) { terr('auth listener error', e); } });
    });
    _ready = true;
  }

  /* Read the current user's editors/{email} doc and set approval. */
  async function _checkApproval(u, label) {
    const key = (u.email || '').toLowerCase();
    tlog(`approval[${label}]: reading editors/${key} …`);
    try {
      const snap = await _getDoc(_db.collection('editors').doc(key));
      const data = snap.exists ? snap.data() : null;
      const val = data ? data.approved : undefined;
      _approved = val === true || val === 'true';
      tlog(`approval[${label}]: exists=${snap.exists} data=%o → approved=%o (type ${typeof val}) → ${_approved}`, data, val);
      if (snap.exists && !_approved) {
        twarn(`approval[${label}]: doc found but not approved. Fields present: [${data ? Object.keys(data).join(', ') : ''}] — needs a boolean field named exactly "approved" = true`);
      }
    } catch (e) {
      _approvalError = e?.code || e?.message || String(e);
      twarn(`approval[${label}]: read FAILED →`, _approvalError, '(is Firestore reachable & are rules published?)');
    }
  }

  /* ── Auth ── */
  function signIn() {
    tlog('signIn: opening Google popup …');
    if (!_ready) { twarn('signIn: not configured'); return Promise.resolve({ ok: false, error: 'Cloud sync is not configured.' }); }
    const provider = new firebase.auth.GoogleAuthProvider();
    return _auth.signInWithPopup(provider)
      .then(res => { tlog('signIn: popup OK →', res?.user?.email); return { ok: true }; })
      .catch(err => { twarn('signIn: popup failed →', err?.code || err?.message); return { ok: false, error: err?.message || String(err), code: err?.code || '' }; });
  }
  function signOut() { tlog('signOut'); return _ready ? _auth.signOut() : Promise.resolve(); }
  function onAuthChange(fn) { _authListeners.push(fn); if (_user !== null) fn(_user); }
  function currentUser() { return _user; }
  function isSignedIn() { return !!_user; }

  /* Editing allowed only for signed-in, DB-approved accounts.
     (Also enforced server-side by Firestore/Storage security rules.) */
  function canEdit() { return _ready && !!_user && _approved; }
  function isApproved() { return _approved; }
  function approvalError() { return _approvalError; }

  /* Re-read the current user's approval doc (e.g. after the owner grants access). */
  async function recheckApproval() {
    tlog('recheckApproval: requested');
    if (!_ready || !_user) { twarn('recheckApproval: not signed in'); return; }
    await _checkApproval(_user, 'recheck');
    _authListeners.forEach(fn => { try { fn(_user); } catch (e) { terr(e); } });
  }

  /* Read a doc, falling back to the offline cache when the server is slow/unreachable.
     A plain get() waits on the network indefinitely when offline. */
  async function _getDoc(ref) {
    try {
      return await Promise.race([
        ref.get(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('server-timeout')), 3000)),
      ]);
    } catch (e) {
      tlog('read: server unavailable → trying offline cache');
      return ref.get({ source: 'cache' });
    }
  }

  /* ── City data (Firestore doc: cities/{id}) ── */
  async function loadCity(id) {
    if (!_ready) { tlog(`loadCity(${id}): cloud off → using bundled JSON`); return null; }
    tlog(`loadCity(${id}): reading cities/${id} …`);
    try {
      const snap = await _getDoc(_db.collection('cities').doc(id));
      tlog(`loadCity(${id}): ${snap.exists ? 'found cloud doc' : 'no cloud doc'}`);
      return snap.exists ? snap.data() : null;
    } catch (e) {
      twarn(`loadCity(${id}): read failed`, e?.code || e?.message);
      return null;
    }
  }

  /* Debounced whole-document save. */
  function saveCity(id, data) {
    if (!_ready || !canEdit()) { twarn(`saveCity(${id}): skipped (canEdit=${canEdit()})`); return; }
    tlog(`saveCity(${id}): queued (debounced) …`);
    clearTimeout(_saveTimers[id]);
    _saveTimers[id] = setTimeout(() => {
      tlog(`saveCity(${id}): writing to Firestore …`);
      _db.collection('cities').doc(id)
        .set(data, { merge: false })
        .then(() => tlog(`saveCity(${id}): saved ✓`))
        .catch(e => { terr(`saveCity(${id}): FAILED`, e); alert('Couldn\u2019t save your changes. Please try again.'); });
    }, 600);
  }

  /* Debounced partial (merge) save — updates only the given fields of cities/{id}. */
  function saveCityFields(id, fields) {
    if (!_ready || !canEdit()) { twarn(`saveCityFields(${id}): skipped (canEdit=${canEdit()})`); return; }
    const key = id + '__fields';
    tlog(`saveCityFields(${id}): queued (debounced) …`, fields);
    clearTimeout(_saveTimers[key]);
    _saveTimers[key] = setTimeout(() => {
      tlog(`saveCityFields(${id}): merging into Firestore …`);
      _db.collection('cities').doc(id)
        .set(fields, { merge: true })
        .then(() => tlog(`saveCityFields(${id}): saved ✓`))
        .catch(e => { terr(`saveCityFields(${id}): FAILED`, e); alert('Couldn\u2019t save your changes. Please try again.'); });
    }, 600);
  }

  /* ── Trip timeline (Firestore doc: trip/main) ── */
  async function loadTrip() {
    if (!_ready) { tlog('loadTrip: cloud off'); return null; }
    tlog('loadTrip: reading trip/main …');
    try {
      const snap = await _getDoc(_db.collection('trip').doc('main'));
      tlog(`loadTrip: ${snap.exists ? 'found cloud doc' : 'no cloud doc'}`);
      return snap.exists ? snap.data() : null;
    } catch (e) {
      twarn('loadTrip: read failed', e?.code || e?.message);
      return null;
    }
  }

  /* Debounced whole-document save of the trip timeline. */
  function saveTrip(data) {
    if (!_ready || !canEdit()) { twarn(`saveTrip: skipped (canEdit=${canEdit()})`); return; }
    tlog('saveTrip: queued (debounced) …');
    clearTimeout(_saveTimers['__trip']);
    _saveTimers['__trip'] = setTimeout(() => {
      tlog('saveTrip: writing to Firestore …');
      _db.collection('trip').doc('main')
        .set(data, { merge: false })
        .then(() => tlog('saveTrip: saved ✓'))
        .catch(e => { terr('saveTrip: FAILED', e); alert('Couldn\u2019t save your changes. Please try again.'); });
    }, 600);
  }

  /* ── Photos (Firebase Storage) ── */
  async function uploadPhoto(cityId, file) {
    if (!_ready) throw new Error('Cloud storage not configured');
    const safe = (file.name || 'photo').replace(/[^\w.\-]/g, '_');
    const path = `photos/${cityId}/${Date.now()}-${safe}`;
    tlog('uploadPhoto: uploading', path);
    const ref  = _storage.ref().child(path);
    await ref.put(file);
    const url = await ref.getDownloadURL();
    tlog('uploadPhoto: done →', url);
    return url;
  }

  async function deletePhoto(url) {
    if (!_ready || !url) return;
    tlog('deletePhoto:', url);
    try { await _storage.refFromURL(url).delete(); }
    catch (e) { twarn('deletePhoto failed (ignored)', e?.code || e?.message); }
  }

  return {
    init, isConfigured: () => _configured,
    signIn, signOut, onAuthChange, currentUser, isSignedIn, canEdit, isApproved, approvalError, recheckApproval,
    loadCity, saveCity, saveCityFields, loadTrip, saveTrip, uploadPhoto, deletePhoto,
  };
})();

Store.init();
