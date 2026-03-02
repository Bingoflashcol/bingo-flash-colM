// Admin + PIN guard for /api/admin/* requests
// - If ADMIN_TOKEN exists in localStorage, it will be used.
// - Otherwise, for event-scoped admin endpoints (/api/admin/events/:eventId/*)
//   we ask for the event PIN (once per device/browser) and store it in localStorage.
//
// NOTE: This file intentionally avoids redirect loops. Instead it prompts for PIN
// when an action requires it.

(function () {
  const ADMIN_TOKEN_KEY = 'ADMIN_TOKEN';
  // IMPORTANT: single source of truth for event PIN stored in browser.
  // event-admin.js (form) writes here, and the modal reads here.
  const PIN_KEY_PREFIX = 'EVENT_ADMIN_PIN__';
  // Backward-compat (older builds might have used EVENT_PIN__)
  const LEGACY_PIN_KEY_PREFIX = 'EVENT_PIN__';

  function getAdminToken() {
    try { return (localStorage.getItem(ADMIN_TOKEN_KEY) || '').trim(); } catch { return ''; }
  }

  function pinKey(eventId) { return `${PIN_KEY_PREFIX}${eventId}`; }
  function legacyPinKey(eventId) { return `${LEGACY_PIN_KEY_PREFIX}${eventId}`; }

  function getSavedPin(eventId) {
    if (!eventId) return '';
    try {
      const v = (localStorage.getItem(pinKey(eventId)) || '').trim();
      if (v) return v;
      // fallback to legacy key if present
      return (localStorage.getItem(legacyPinKey(eventId)) || '').trim();
    } catch { return ''; }
  }

  function savePin(eventId, pin) {
    if (!eventId) return;
    try {
      const v = (pin || '').trim();
      localStorage.setItem(pinKey(eventId), v);
      // also keep legacy key in sync so older modules still work
      localStorage.setItem(legacyPinKey(eventId), v);
    } catch {}
  }

  function hasBackend() {
    // If the app is served without the backend (e.g., Live Server), /api/* will 404.
    // We treat that as "no backend" and validate PIN purely in localStorage.
    return !!(window.BF_HAS_BACKEND === true);
  }

  function extractEventIdFromAdminUrl(url) {
    try {
      const u = new URL(url, window.location.origin);
      const p = u.pathname;
      const m = p.match(/\/api\/admin\/events\/([^\/]+)(\/|$)/i);
      if (!m) return null;
      return decodeURIComponent(m[1]);
    } catch {
      // Fallback (relative paths)
      const p = (url || '').toString();
      const m = p.match(/\/api\/admin\/events\/([^\/]+)(\/|$)/i);
      return m ? decodeURIComponent(m[1]) : null;
    }
  }

  // ---------- Modal UI ----------
  let modalPromise = null;

  function ensureModal() {
    if (document.getElementById('bf-pin-modal-root')) return;

    const root = document.createElement('div');
    root.id = 'bf-pin-modal-root';
    root.innerHTML = `
      <style>
        #bf-pin-modal-root{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;}
        #bf-pin-modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter: blur(4px);}
        #bf-pin-modal{position:relative;width:min(520px,92vw);background:#0b1220;border:1px solid rgba(255,255,255,.12);
          border-radius:16px;padding:18px 18px 14px 18px;box-shadow:0 18px 60px rgba(0,0,0,.45);color:#e5e7eb;
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;}
        #bf-pin-modal h3{margin:0 0 6px 0;font-size:18px;}
        #bf-pin-modal p{margin:0 0 12px 0;opacity:.85;font-size:13px;line-height:1.3}
        #bf-pin-modal .row{display:flex;gap:10px;align-items:center;margin-top:10px;}
        #bf-pin-input{flex:1;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.15);
          background:rgba(255,255,255,.06);color:#fff;outline:none;}
        #bf-pin-error{margin-top:8px;color:#fb7185;font-size:12px;min-height:16px;}
        #bf-pin-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:12px;}
        .bf-pin-btn{padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);
          color:#e5e7eb;cursor:pointer;}
        .bf-pin-btn.primary{background:#22c55e;border-color:#22c55e;color:#052e16;font-weight:700;}
        .bf-pin-btn.danger{background:#ef4444;border-color:#ef4444;color:#fff;font-weight:700;}
        .bf-pin-hint{opacity:.75;font-size:12px;margin-top:10px}
      </style>
      <div id="bf-pin-modal-backdrop"></div>
      <div id="bf-pin-modal" role="dialog" aria-modal="true">
        <h3 id="bf-pin-title">PIN del evento</h3>
        <p id="bf-pin-desc">Ingresa el PIN para continuar con acciones administrativas.</p>
        <div class="row">
          <input id="bf-pin-input" type="password" inputmode="numeric" autocomplete="one-time-code" placeholder="PIN (mín. 4 caracteres)" />
          <button id="bf-pin-show" class="bf-pin-btn" title="Mostrar/ocultar">👁</button>
        </div>
        <div id="bf-pin-error"></div>
        <div id="bf-pin-actions">
          <button id="bf-pin-cancel" class="bf-pin-btn">Cancelar</button>
          <button id="bf-pin-submit" class="bf-pin-btn primary">Continuar</button>
        </div>
        <div class="bf-pin-hint">Tip: el PIN se guarda solo en este navegador (localStorage).</div>
      </div>
    `;
    document.body.appendChild(root);

    const input = root.querySelector('#bf-pin-input');
    const btnShow = root.querySelector('#bf-pin-show');
    btnShow.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  }

  async function askForPin({ eventId, mode }) {
    // mode: 'verify' | 'create'
    ensureModal();
    const root = document.getElementById('bf-pin-modal-root');
    const title = root.querySelector('#bf-pin-title');
    const desc = root.querySelector('#bf-pin-desc');
    const input = root.querySelector('#bf-pin-input');
    const error = root.querySelector('#bf-pin-error');
    const btnCancel = root.querySelector('#bf-pin-cancel');
    const btnSubmit = root.querySelector('#bf-pin-submit');

    title.textContent = mode === 'create' ? `Crear PIN para “${eventId}”` : `PIN requerido para “${eventId}”`;
    desc.textContent = mode === 'create'
      ? 'Este evento no tiene PIN aún. Crea uno para proteger acciones administrativas.'
      : 'Ingresa el PIN para continuar con acciones administrativas.';
    btnSubmit.textContent = mode === 'create' ? 'Guardar PIN' : 'Continuar';
    error.textContent = '';
    input.value = '';
    input.type = 'password';

    root.style.display = 'flex';
    setTimeout(() => input.focus(), 50);

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        root.style.display = 'none';
        btnCancel.onclick = null;
        btnSubmit.onclick = null;
        input.onkeydown = null;
      };

      const onCancel = () => {
        cleanup();
        reject(new Error('PIN_CANCELLED'));
      };

      const onSubmit = () => {
        const pin = (input.value || '').trim();
        if (pin.length < 4) {
          error.textContent = 'El PIN debe tener mínimo 4 caracteres.';
          input.focus();
          return;
        }
        cleanup();
        resolve(pin);
      };

      btnCancel.onclick = onCancel;
      btnSubmit.onclick = onSubmit;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') onSubmit();
        if (e.key === 'Escape') onCancel();
      };
    });
  }

  async function verifyPin(eventId, pin) {
    // Local-only validation when backend is not available
    if (!hasBackend()) {
      const saved = getSavedPin(eventId);
      if (saved && saved === (pin || '').trim()) return true;
      throw new Error('PIN_INVALID');
    }

    let res;
    try {
      res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/pin/verify`, {
        method: 'GET',
        headers: { 'X-Event-Pin': pin }
      });
    } catch {
      // Network error: treat like no backend
      const saved = getSavedPin(eventId);
      if (saved && saved === (pin || '').trim()) return true;
      throw new Error('PIN_INVALID');
    }

    // If backend isn't mounted, we typically get 404
    if (res.status === 404) {
      const saved = getSavedPin(eventId);
      if (saved && saved === (pin || '').trim()) return true;
      throw new Error('PIN_INVALID');
    }

    if (res.ok) return true;
    let data = null;
    try { data = await res.json(); } catch {}
    const err = (data && data.error) ? data.error : 'PIN_INVALID';
    throw new Error(err);
  }

  async function createPin(eventId, pin) {
    // Local-only create when backend is not available
    if (!hasBackend()) {
      savePin(eventId, pin);
      return true;
    }
    const token = getAdminToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // backend expects { new_pin }
    const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/pin`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ new_pin: pin })
    });
    if (res.ok) return true;
    let data = null;
    try { data = await res.json(); } catch {}
    const err = (data && data.error) ? data.error : 'PIN_CREATE_FAILED';
    throw new Error(err);
  }

  // NOTE:
  // - ensurePinForEvent(): "smart" flow (may auto-reuse stored PIN without prompting)
  //   used mainly by the fetch() interceptor for 401 flows.
  // - ensurePinForEventPrompted(): ALWAYS prompts the user (what the UI needs for
  //   "acciones peligrosas"), and validates against stored PIN.
  async function ensurePinForEvent(eventId, serverHint) {
    // serialize to avoid multiple modals
    if (modalPromise) return modalPromise;
    modalPromise = (async () => {
      const saved = getSavedPin(eventId);
      if (saved) {
        try {
          await verifyPin(eventId, saved);
          return saved;
        } catch {
          // continue and ask again
        }
      }

      // If no backend, decide mode based on whether we have a saved pin.
      let mode;
      if (!hasBackend()) {
        mode = getSavedPin(eventId) ? 'verify' : 'create';
      } else {
        mode = (serverHint === 'PIN_NOT_SET') ? 'create' : 'verify';
      }

      while (true) {
        const pin = await askForPin({ eventId, mode });
        try {
          if (mode === 'create') {
            await createPin(eventId, pin);
            // after creating, verify it and store
          }
          await verifyPin(eventId, pin);
          savePin(eventId, pin);
          return pin;
        } catch (e) {
          const msg = (e && e.message) || 'PIN_INVALID';

          // If server says there is no PIN yet, switch to create mode.
          if (msg === 'PIN_NOT_SET') {
            mode = 'create';
          }

          // Basic UX feedback (keep it simple).
          if (msg === 'PIN_INVALID') alert('PIN incorrecto');
          else if (msg === 'PIN_REQUIRED') alert('Debes ingresar el PIN');
          else if (msg === 'PIN_NOT_SET') alert('Este evento no tiene PIN. Debes crear uno.');
          else if (/ADMIN_TOKEN/i.test(msg)) alert('Para crear el PIN por primera vez se requiere ADMIN_TOKEN (configúralo o ejecútalo en modo dev sin token).');
          else alert(msg || 'No se pudo validar/guardar el PIN');
        }
      }
    })().finally(() => { modalPromise = null; });

    return modalPromise;
  }

  // ALWAYS ask the user for the PIN (or to create it if missing).
  // This is the behavior requested for "acciones peligrosas".
  async function ensurePinForEventPrompted(eventId) {
    // serialize to avoid multiple modals
    if (modalPromise) return modalPromise;
    modalPromise = (async () => {
      eventId = (eventId || '').toString().trim();
      if (!eventId) throw new Error('EVENT_ID_REQUIRED');

      const saved = getSavedPin(eventId);
      let mode = saved ? 'verify' : 'create';

      while (true) {
        const pin = await askForPin({ eventId, mode });
        try {
          if (mode === 'create') {
            await createPin(eventId, pin);
          }
          // For verify mode without backend, we validate against stored PIN.
          await verifyPin(eventId, pin);
          // Store the PIN for future validations (also keeps legacy key in sync).
          savePin(eventId, pin);
          return pin;
        } catch (e) {
          const msg = (e && e.message) || 'PIN_INVALID';
          if (msg === 'PIN_NOT_SET') {
            mode = 'create';
          }
          if (msg === 'PIN_INVALID') alert('PIN incorrecto');
          else if (msg === 'PIN_REQUIRED') alert('Debes ingresar el PIN');
          else if (msg === 'PIN_NOT_SET') alert('Este evento no tiene PIN. Debes crear uno.');
          else alert(msg || 'No se pudo validar/guardar el PIN');
        }
      }
    })().finally(() => { modalPromise = null; });

    return modalPromise;
  }


  
// ---------- Public API (UI guards) ----------
// Exponemos helpers para pedir/validar PIN antes de acciones "peligrosas" en el frontend.
// Uso: await window.BFAdminAuth.requireEventPin(eventId)
window.BFAdminAuth = window.BFAdminAuth || {};
// For UI dangerous actions we ALWAYS prompt.
window.BFAdminAuth.requireEventPin = async function(eventId){
  eventId = (eventId || '').toString().trim();
  if(!eventId) throw new Error('EVENT_ID_REQUIRED');
  return ensurePinForEventPrompted(eventId);
};
window.BFAdminAuth.getStoredEventPin = function(eventId){
  try{ return (localStorage.getItem(PIN_KEY_PREFIX + eventId) || '').trim(); }catch{ return ''; }
};
window.BFAdminAuth.clearEventPin = function(eventId){
  try{ localStorage.removeItem(PIN_KEY_PREFIX + eventId); }catch(_){}
};


window.BFAdminAuth.setEventPinDev = async function(eventId, newPin){
  eventId = (eventId || '').toString().trim();
  newPin = (newPin || '').toString().trim();
  if(!eventId) throw new Error('EVENT_ID_REQUIRED');
  if(!newPin || newPin.length < 4) throw new Error('PIN_MIN_4');
  // Bypass guard: en producción esto fallará si ADMIN_TOKEN está configurado y/o si se requiere el PIN actual.
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/pin`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Bypass-Pin-Guard': '1' },
    body: JSON.stringify({ new_pin: newPin })
  });
  if(res.ok) return true;
  let data=null; try{ data=await res.json(); }catch(_){}
  throw new Error((data && data.error) || 'PIN_SET_FAILED');
};
// ---------- Fetch interceptor ----------
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    const isAdmin = url.includes('/api/admin/');
    if (!isAdmin) return originalFetch(input, init);

    const eventId = extractEventIdFromAdminUrl(url);
    const adminToken = getAdminToken();

    // clone headers
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || {});

    // Permite bypass explícito (usado para set/reset de PIN en modo dev).
    if (headers.get('X-Bypass-Pin-Guard')) {
      headers.delete('X-Bypass-Pin-Guard');
      init.headers = headers;
      return originalFetch(input, init);
    }

    if (adminToken) {
      headers.set('X-Admin-Token', adminToken);
    } else if (eventId) {
      const pin = getSavedPin(eventId);
      if (pin) headers.set('X-Event-Pin', pin);
    }

    const doFetch = (extraHeaders) => {
      const merged = new Headers(headers);
      if (extraHeaders) {
        Object.entries(extraHeaders).forEach(([k, v]) => merged.set(k, v));
      }
      const nextInit = Object.assign({}, init, { headers: merged });
      return originalFetch(input, nextInit);
    };

    let res = await doFetch();
    if (res.status !== 401 || !eventId || adminToken) return res;

    // Try PIN flow
    let data = null;
    try { data = await res.clone().json(); } catch {}
    const hint = data && data.error;
    try {
      const pin = await ensurePinForEvent(eventId, hint);
      res = await doFetch({ 'X-Event-Pin': pin });
      return res;
    } catch {
      return res;
    }
  };
})();
