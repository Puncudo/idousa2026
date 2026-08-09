/* ═══════════════════════════════════════════════════════
   Firebase config — USA Trip 2026
   ───────────────────────────────────────────────────────
   HOW TO FILL THIS IN:
   1. Firebase Console → your project (IdoUSA2026) → ⚙ Project settings
   2. Under "Your apps", click the </> (Web) icon to register a web app
      (call it e.g. "usa-trip"). Do NOT enable Firebase Hosting.
   3. Copy the values from the shown `firebaseConfig` object into the
      two TODO fields below (apiKey and appId).
   4. Confirm storageBucket matches what the console shows.
════════════════════════════════════════════════════════════ */
const firebaseConfig = {
  apiKey:            "AIzaSyC274HbF9b83qSroUAgg8lliZ8Nd-Rkf9U",
  authDomain:        "idousa2026.firebaseapp.com",
  projectId:         "idousa2026",
  storageBucket:     "idousa2026.firebasestorage.app",
  messagingSenderId: "380672334809",
  appId:             "1:380672334809:web:dcf41e687c5670a93317c8",
  measurementId:     "G-VPR3NLVCFM",
};

/* Editor approvals are managed in Firestore, NOT here.
   To approve someone: Firestore → collection "editors" → add a document whose
   ID is their Google email, with a field  approved (boolean) = true.
   Approve your OWN email first so you can sign in. */
