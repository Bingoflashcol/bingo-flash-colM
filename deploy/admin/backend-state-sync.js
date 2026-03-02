// Sincronización PRO: backend como fuente de verdad + polling sin recargar.
// - Guarda el estado del evento (bingo_events[eventId]) en el backend.
// - Trae el estado más reciente del backend y lo aplica a localStorage.
//
// Requiere que exista:
//   GET /api/admin/events/:eventId/state
//   PUT /api/admin/events/:eventId/state
(function(){
  if (typeof window === 'undefined') return;
  const LS_KEY = 'bingo_events';
  const BF_API_BASE = window.BF_API_BASE || '';

  function curEvent(){
    // Ya no forzamos "default". Si no hay evento, no sincronizamos para evitar crear eventos fantasmas.
    return (document.querySelector('#eventId')?.value || '').trim() || window.__EVENTO_BINGO__ || '';
  }

  function loadDB(){ try{ return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; }catch(_){ return {}; } }
  function saveDB(db){ localStorage.setItem(LS_KEY, JSON.stringify(db || {})); }

  function stateKey(evt){ return `bf_state_updated_at__${evt}`; }
  function getLocalUpdatedAt(evt){ try{ return localStorage.getItem(stateKey(evt)) || ''; }catch(_){ return ''; } }
  function setLocalUpdatedAt(evt, iso){ try{ localStorage.setItem(stateKey(evt), iso || ''); }catch(_){ } }

  function isoToTs(iso){ const t = Date.parse(iso || ''); return Number.isNaN(t) ? 0 : t; }

  let pollTimer = null;
  let pushTimer = null;
  let syncingFromRemote = false;

  async function fetchRemoteState(evt){
    const url = `${BF_API_BASE}/api/admin/events/${encodeURIComponent(evt)}/state`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('No se pudo leer state');
    return await resp.json();
  }

  async function pushLocalState(evt){
    const db = loadDB();
    const st = db[evt] || null;
    const url = `${BF_API_BASE}/api/admin/events/${encodeURIComponent(evt)}/state`;
    const resp = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: st })
    });
    if (!resp.ok) throw new Error('No se pudo guardar state');
    const data = await resp.json();
    if (data && data.updated_at) setLocalUpdatedAt(evt, data.updated_at);
  }

  async function pullIfNewer(evt){
    try{
      const remote = await fetchRemoteState(evt);
      const remoteTs = isoToTs(remote.updated_at);
      const localTs = isoToTs(getLocalUpdatedAt(evt));

      // Si remoto es más nuevo, aplicar.
      if (remoteTs > localTs && remote.state) {
        syncingFromRemote = true;
        const db = loadDB();
        db[evt] = remote.state;
        saveDB(db);
        setLocalUpdatedAt(evt, remote.updated_at);
        // Notificar a UI que hay cambios.
        document.dispatchEvent(new CustomEvent('bf:stateSynced', { detail: { eventId: evt, updated_at: remote.updated_at } }));
      }
    }catch(e){
      // silencioso (si backend no está disponible no rompemos el juego)
    }finally{
      syncingFromRemote = false;
    }
  }

  function schedulePush(evt){
    if(!evt) return;
    if (syncingFromRemote) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushLocalState(evt).catch(()=>{});
    }, 800);
  }

  function hookLocalStorage(){
    try{
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = function(k, v){
        originalSetItem.call(localStorage, k, v);
        if (syncingFromRemote) return;
        if (k === LS_KEY) {
          const evt = curEvent();
          if(!evt) return;
          schedulePush(evt);
        }
      };
    }catch(_){ }
  }

  function startPolling(){
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      const evt = curEvent();
      if(!evt) return;
      pullIfNewer(evt);
    }, 3500);
  }

  async function bootstrap(){
    const evt = curEvent();
    if(!evt){ startPolling(); return; }
    // Primer pull
    await pullIfNewer(evt);
    // Si no hay remote, subir lo local una vez para inicializar.
    const localTs = isoToTs(getLocalUpdatedAt(evt));
    if (!localTs) {
      try{ await pushLocalState(evt); }catch(_){ }
    }
    startPolling();
  }

  document.addEventListener('DOMContentLoaded', () => {
    hookLocalStorage();
    // Cuando cambie el evento, hacemos pull y reiniciamos polling.
    document.addEventListener('bfw:eventChanged', (e) => {
      const evt = (e && e.detail) ? String(e.detail) : curEvent();
      if(!evt){ startPolling(); return; }
      pullIfNewer(evt);
      startPolling();
    });
    bootstrap();
  });
})();
