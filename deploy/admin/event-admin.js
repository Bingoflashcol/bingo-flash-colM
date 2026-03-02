
/* ===== Administrador de Eventos (con comboSize) ===== */
(() => {
  // BF: base dinámica del backend (producción: mismo dominio)
  const API_BASE_EVENT = (typeof window !== 'undefined' && window.BF_API_BASE) ? String(window.BF_API_BASE) : (location.origin || '');

  const $ = (s, c=document) => c.querySelector(s);
  const $$ = (s, c=document) => Array.from(c.querySelectorAll(s));
  const norm = (s)=>String(s||'').trim();

  function loadDB(){ try{return JSON.parse(localStorage.getItem('bingo_events')||'{}');}catch{ return {}; } }
  function saveDB(db){ localStorage.setItem('bingo_events', JSON.stringify(db)); }
  function ensureEvent(db, key){
    db[key] = db[key] || { cards:{}, ids:{}, generated:[], won:{}, seq:0, buyers:{}, combos_total:0, individuales_total:0, meta:{}, vendors:{} };
  }

  function ui(){
    if($('#ev-admin')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="ev-admin-backdrop" style="position:fixed;inset:0;display:none;background:rgba(0,0,0,.5);z-index:1000"></0iv>
      <div id="ev-admin" style="position:fixed;inset:10% 15%;display:none;background:#0b1220;color:#e5e7eb;border:1px solid rgba(255,255,255,.1);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.6);z-index:1001;overflow:auto">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.08)">
          <h3 style="margin:0;font-size:18px">Administrador de eventos</h3>
          <div>
            <button id="ev-admin-close" class="secondary" style="margin-right:6px">Cerrar ✖</button>
            <button id="ev-admin-new" class="primary">Nuevo evento ➕</button>
          </div>
        </div>
        <div style="padding:16px">
          <div id="ev-list" style="display:grid;gap:8px"></div>
          <hr style="border-color:rgba(255,255,255,.1);margin:12px 0">
          <div id="ev-form" style="display:none">
            <h4 style="margin:.25rem 0">Editar/Crear evento</h4>
            <div class="controls" style="display:flex;gap:8px;align-items:center;margin:.25rem 0">
              <label style="min-width:130px">ID (único):</label>
              <input id="ev-id" type="text" placeholder="ej. NocheFiesta2025" style="flex:1">
            </div>
            <div class="controls" style="display:flex;gap:8px;align-items:center;margin:.25rem 0">
              <label style="min-width:130px">Nombre:</label>
              <input id="ev-name" type="text" placeholder="Nombre visible (opcional)" style="flex:1">
            </div>
            <div class="controls" style="display:flex;gap:8px;align-items:center;margin:.25rem 0">
              <label style="min-width:130px">PIN admin:</label>
              <div style="flex:1;display:flex;gap:6px;align-items:center">
                <input id="ev-pin" name="bf_admin_pin" type="password" inputmode="numeric" autocomplete="new-password" placeholder="(opcional) mínimo 4" style="flex:1">
                <button id="ev-pin-toggle" type="button" class="secondary" title="Ver/ocultar PIN" style="width:44px;padding:6px 0">👁</button>
              </div>
            </div>
            <div class="controls" style="display:flex;gap:8px;align-items:center;margin:.25rem 0">
              <label style="min-width:130px">Confirmar PIN:</label>
              <div style="flex:1;display:flex;gap:6px;align-items:center">
                <input id="ev-pin2" name="bf_admin_pin_confirm" type="password" inputmode="numeric" autocomplete="new-password" placeholder="Repite el PIN" style="flex:1">
                <button id="ev-pin2-toggle" type="button" class="secondary" title="Ver/ocultar PIN" style="width:44px;padding:6px 0">👁</button>
              </div>
            </div>
            <div class="controls" style="display:flex;gap:8px;align-items:center;margin:.25rem 0">
              <label style="min-width:130px">Cartones/Combo:</label>
              <input id="ev-combo-size" type="number" min="1" max="30" value="6" style="width:120px">
              <small style="opacity:.75">Solo cálculos y reportes. También ajusta impresión.</small>
            </div>
            <div class="controls" style="display:flex;gap:8px;align-items:center;margin:.25rem 0">
              <label style="min-width:130px">Precio cartón (COP):</label>
              <input id="ev-price-carton" type="number" min="0" step="100" placeholder="Ej. 5000" style="width:120px">
              <small style="opacity:.75">Usado para calcular comisión por ventas físicas.</small>
            </div>
            <div class="controls" style="display:flex;gap:8px;align-items:center;margin:.25rem 0">
              <label style="min-width:130px">Precio combo (COP):</label>
              <input id="ev-price-combo" type="number" min="0" step="100" placeholder="Opcional" style="width:120px">
              <small style="opacity:.75">Si se deja en 0, se usa Cartones/Combo × precio cartón.</small>
            </div>
            <!-- BF: Barra de progreso automática por evento (cartones impresos) -->
            <div class="controls" style="display:flex;gap:8px;align-items:center;margin:.25rem 0;flex-direction:column;align-items:stretch">
              <div style="display:flex;align-items:center;gap:8px;width:100%">
                <label style="min-width:130px">Meta cartones:</label>
                <input id="ev-auto-target" type="number" min="0" step="1" placeholder="Ej. 600" style="width:130px">
                <small style="opacity:.75">Suma combos e individuales impresos.</small>
              </div>
              <div class="bf-progress" style="margin-top:4px">
                <div id="ev-auto-progress-bar" class="bf-progress-inner"></div>
              </div>
              <div id="ev-auto-progress-summary" style="font-size:.85em;opacity:.8;margin-top:4px">0 / 0 cartones (0%)</div>
            </div>
            <div class="controls" style="display:flex;gap:8px;align-items:center;margin:.25rem 0">
              <label style="min-width:130px">Color cartones:</label>
              <select id="ev-card-color" style="flex:1">
                <option value="default">Azul original</option>
                <option value="rojo">Rojo</option>
                <option value="verde">Verde</option>
                <option value="morado">Morado</option>
                <option value="naranja">Naranja</option>
              </select>
            </div>
            <div class="controls" style="display:flex;gap:8px;align-items:center;margin:.25rem 0">
              <label style="min-width:130px">Fecha de cantada:</label>
              <input id="ev-cantada-date" type="date" style="width:160px">
              <label style="min-width:80px">Hora:</label>
              <input id="ev-cantada-time" type="time" style="width:110px">
            </div>
            <div class="controls" style="display:flex;gap:8px;align-items:center;margin:.25rem 0">
              <button id="ev-close-sales" class="danger">Cerrar ventas</button>
              <button id="ev-open-sales" class="secondary">Reabrir ventas</button>
              <div id="ev-sales-state" style="margin-left:auto;font-size:.85em;opacity:.9;"></div>
            </div>
            <div class="controls" style="display:flex;gap:8px;align-items:center;margin:.25rem 0">
              <button id="ev-capture-figs" class="secondary">Tomar figuras de la selección actual</button>
              <button id="ev-apply-figs" class="secondary">Aplicar figuras guardadas a la selección</button>
            </div>
            <div class="controls" style="display:flex;gap:8px;justify-content:flex-end">
              <button id="ev-save" class="primary">Guardar</button>
              <button id="ev-cancel" class="secondary">Cancelar</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
  }

  function openModal(){
    document.getElementById('ev-admin-backdrop').style.display='block';
    document.getElementById('ev-admin').style.display='block';
    refreshList();
    document.getElementById('ev-form').style.display='none';
    // Al abrir, traemos conteo de ventas online para que el panel refleje lo vendido en la landing.
    try{
      const db = loadDB();
      const keys = Object.keys(db||{});
      syncOnlineSoldCards(keys);
    }catch(_){ }
  }

  // Sincroniza cartones vendidos por la landing (ventas online) desde el backend
  let __syncingOnline = false;
  async function syncOnlineSoldCards(eventIds){
    if(__syncingOnline) return;
    __syncingOnline = true;
    try{
      const db = loadDB();
      let changed = false;
      for(const evt of (eventIds||[])){
        try{
          const url = `${API_BASE_EVENT}/api/admin/events/${encodeURIComponent(evt)}`;
          const r = await fetch(url);
          if(!r.ok) continue;
          const data = await r.json();
          const sold = (data && data.event && data.event.sold_cards) ? (data.event.sold_cards|0) : 0;
          ensureEvent(db, evt);
          db[evt].meta = db[evt].meta || {};
          if((db[evt].meta.onlineSoldCards|0) !== (sold|0)){
            db[evt].meta.onlineSoldCards = (sold|0);
            changed = true;
          }
        }catch(_){ /* ignore */ }
      }
      if(changed){
        saveDB(db);
        // refrescar UI + barra de progreso
        refreshList();
        const cur = document.getElementById('eventId')?.value;
        if(window.__BF_UPDATE_AUTO_PROGRESS){ try{ window.__BF_UPDATE_AUTO_PROGRESS(cur); }catch(_){ } }
      }
    }finally{
      __syncingOnline = false;
    }
  }
  function closeModal(){ document.getElementById('ev-admin-backdrop').style.display='none'; document.getElementById('ev-admin').style.display='none'; }

  function refreshList(){
    const cont = document.getElementById('ev-list'); cont.innerHTML = '';
    const db = loadDB();
    const keys = Object.keys(db).sort((a,b)=>a.localeCompare(b));
    if(!keys.length){
      cont.innerHTML = `<div style="opacity:.75">Aún no hay eventos. Crea uno con “Nuevo evento”.</div>`;
      return;
    }
    keys.forEach(k=>{
      const meta = (db[k] && db[k].meta) || {};
      const comboSize = (parseInt(meta.comboSize,10) > 0 ? parseInt(meta.comboSize,10) : 6);
      const onlineCards = (meta.onlineSoldCards|0);
      const localCombos = (db[k].combos_total|0);
      const localIndiv  = (db[k].individuales_total|0);
      const totalCards  = localCombos * comboSize + localIndiv + onlineCards;
      const row = document.createElement('div');
      row.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:#0f172a";
      row.innerHTML = `
        <div style="flex:1">
          <div style="font-weight:700">${k}</div>
          <div style="opacity:.8;font-size:.9em">${meta.name||''}</div>
          <div style="opacity:.7;font-size:.85em">Combos: ${localCombos} · Individuales: ${localIndiv} · Online: ${onlineCards} cartones · Combo: ${comboSize} · Total: ${totalCards}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button data-k="${k}" class="ev-use primary">Usar</button>
          <button data-k="${k}" class="ev-open-landing">Landing</button>
          <button data-k="${k}" class="ev-edit">Editar</button>
          <button data-k="${k}" class="ev-del danger">Eliminar</button>
        </div>
      `;
      cont.appendChild(row);
    });

	        cont.querySelectorAll('.ev-open-landing').forEach(btn=>btn.addEventListener('click', async (e)=>{
	      const k = e.currentTarget.getAttribute('data-k');
	      try{ if(window.BFAdminAuth && window.BFAdminAuth.requireEventPin){ await window.BFAdminAuth.requireEventPin(k); } }catch(_e){ return; }
      const url = `portal.html?event=${encodeURIComponent(k)}`;
      try{
        window.open(url, '_blank');
      }catch(_){
        window.location.href = url;
      }
    }));

cont.querySelectorAll('.ev-use').forEach(btn=>btn.addEventListener('click', (e)=>{
      const k = e.currentTarget.getAttribute('data-k');
      const eventInput = document.querySelector('#eventId');
      if(eventInput){ eventInput.value = k; eventInput.dispatchEvent(new Event('input')); }
      try{
        const db=loadDB(); const cfg=db[k]?.meta?.figuras;
        if(cfg && window.BingoFigurasWidget?.setEventConfig){
          window.BingoFigurasWidget.setEventConfig(cfg);
        }
      }catch{}
      closeModal();
    }));

	    cont.querySelectorAll('.ev-edit').forEach(btn=>btn.addEventListener('click', async (e)=>{
	      const k = e.currentTarget.getAttribute('data-k');
	      try{ if(window.BFAdminAuth && window.BFAdminAuth.requireEventPin){ await window.BFAdminAuth.requireEventPin(k); } }catch(_e){ return; }
      const db=loadDB(); const meta=db[k]?.meta||{};
      document.getElementById('ev-form').style.display='block';
      document.getElementById('ev-id').value = k;
      document.getElementById('ev-id').dataset.original = k;
      document.getElementById('ev-name').value = meta.name || '';
      document.getElementById('ev-combo-size').value = meta.comboSize || 6;
      var priceCartonInput = document.getElementById('ev-price-carton');
      if(priceCartonInput){ priceCartonInput.value = (meta.priceCarton != null ? meta.priceCarton : ''); }
      var priceComboInput = document.getElementById('ev-price-combo');
      if(priceComboInput){ priceComboInput.value = (meta.priceCombo != null ? meta.priceCombo : ''); }
      const selColor = document.getElementById('ev-card-color');
      if(selColor){ selColor.value = meta.cardColor || 'default'; }

      // Fecha y hora de cantada
      const cantada = meta.cantadaFechaHora || '';
      const dInput = document.getElementById('ev-cantada-date');
      const tInput = document.getElementById('ev-cantada-time');
      if (cantada && dInput && tInput){
        const parts = cantada.split('T');
        dInput.value = parts[0] || '';
        tInput.value = (parts[1] || '').slice(0,5);
      }else{
        if(dInput) dInput.value = '';
        if(tInput) tInput.value = '';
      }

      // Estado de ventas
      const salesStateEl = document.getElementById('ev-sales-state');
      if (salesStateEl){
        const locked = !!meta.salesLocked;
        salesStateEl.textContent = locked ? 'Ventas BLOQUEADAS' : 'Ventas ABIERTAS';
        salesStateEl.style.color = locked ? '#fca5a5' : '#bbf7d0';
      }
    }));

	    
cont.querySelectorAll('.ev-del').forEach(btn=>btn.addEventListener('click', async (e)=>{
	      const k = e.currentTarget.getAttribute('data-k');
	      try{ if(window.BFAdminAuth && window.BFAdminAuth.requireEventPin){ await window.BFAdminAuth.requireEventPin(k); } }catch(_e){ return; }
      if(!confirm(`¿Eliminar evento "${k}"? Esta acción no se puede deshacer.`)) return;
      const db=loadDB(); delete db[k]; saveDB(db);
      const eventInput = document.querySelector('#eventId');
      if(eventInput && (eventInput.value||'').trim() === k){ eventInput.value = ''; eventInput.dispatchEvent(new Event('input')); }
      refreshList();
    }));
  }

  function wire(){
    const eventRow = document.querySelector('#eventId')?.closest('.controls');
    if(eventRow && !document.querySelector('#ev-admin-open')){
      const btn = document.createElement('button');
      btn.id = 'ev-admin-open';
      btn.textContent = 'Administrador de eventos';
      btn.className = 'secondary';
      btn.style.marginLeft = '8px';
      eventRow.appendChild(btn);
      btn.addEventListener('click', openModal);
    }

    document.addEventListener('click', (e)=>{
      if(e.target?.id==='ev-admin-close' || e.target?.id==='ev-admin-backdrop') closeModal();
    });

    document.addEventListener('click', (e)=>{
      // Ver/ocultar PIN en el formulario (ev-pin y ev-pin2)
      if(e.target?.id === 'ev-pin-toggle' || e.target?.id === 'ev-pin2-toggle'){
        const btnId = e.target.id;
        const inputId = (btnId === 'ev-pin-toggle') ? 'ev-pin' : 'ev-pin2';
        const input = document.getElementById(inputId);
        if(input){
          const show = (input.type === 'password');
          input.type = show ? 'text' : 'password';
          // Cambiar icono: ojo abierto / cerrado
          e.target.textContent = show ? '🙈' : '👁';
        }
        return;
      }
      if(e.target?.id==='ev-admin-new'){
        document.getElementById('ev-form').style.display='block';
        document.getElementById('ev-id').value=''; document.getElementById('ev-id').dataset.original=''; document.getElementById('ev-name').value=''; document.getElementById('ev-combo-size').value=6;
        var pc = document.getElementById('ev-price-carton'); if(pc){ pc.value=''; }
        var pco = document.getElementById('ev-price-combo'); if(pco){ pco.value=''; }
        var dCant = document.getElementById('ev-cantada-date'); if(dCant){ dCant.value=''; }
        var tCant = document.getElementById('ev-cantada-time'); if(tCant){ tCant.value=''; }
        var sState = document.getElementById('ev-sales-state'); if(sState){ sState.textContent=''; }
      }
      if(e.target?.id==='ev-cancel'){ document.getElementById('ev-form').style.display='none'; }
      if(e.target?.id==='ev-capture-figs'){
        try{
          if(window.BingoFigurasWidget?.getEventConfig){
            const cfg = window.BingoFigurasWidget.getEventConfig();
            document.getElementById('ev-capture-figs').dataset.figuras = JSON.stringify(cfg);
            alert('Figuras capturadas ✅');
          }else{
            alert('No se encontró el selector de figuras.');
          }
        }catch(err){ console.error(err); alert('No se pudo capturar.'); }
      }
      if(e.target?.id==='ev-apply-figs'){
        try{
          const raw = document.getElementById('ev-capture-figs').dataset.figuras || '[]';
          const cfg = JSON.parse(raw);
          if(window.BingoFigurasWidget?.setEventConfig){
            window.BingoFigurasWidget.setEventConfig(cfg);
            alert('Figuras aplicadas ✅');
          }
        }catch(err){ console.error(err); alert('No se pudo aplicar.'); }
      }
      
      if(e.target?.id==='ev-close-sales'){
        const evt = __bf_getCurrentEventId();
        if(!evt){
          alert('Primero selecciona un evento en el campo principal.');
        }else if(confirm('¿Cerrar ventas para este evento?\nNo se podrán agregar más cartones hasta que las reabras.')){
          __bf_setSalesLocked(evt, true);
        }
      }
      if(e.target?.id==='ev-open-sales'){
        const evt = __bf_getCurrentEventId();
        if(!evt){
          alert('Primero selecciona un evento en el campo principal.');
        }else if(confirm('¿Reabrir ventas para este evento?')){
          __bf_setSalesLocked(evt, false);
        }
      }
if(e.target?.id==='ev-save'){
        const id = norm(document.getElementById('ev-id').value);
        if(!id){ alert('Ingresa un ID para el evento.'); return; }
        const name = norm(document.getElementById('ev-name').value);
        const cs = parseInt(document.getElementById('ev-combo-size').value||'6',10) || 6;
        const priceCarton = parseFloat(document.getElementById('ev-price-carton')?.value || '0') || 0;
        const priceCombo  = parseFloat(document.getElementById('ev-price-combo')?.value || '0') || 0;
        const color = (document.getElementById('ev-card-color')?.value || 'default');
        const autoTarget = parseInt(document.getElementById('ev-auto-target')?.value||'0',10) || 0;

        // PIN admin del evento (opcional al guardar). Si se define aquí, se usará para todas las acciones peligrosas.
        const pin  = (document.getElementById('ev-pin')?.value || '').trim();
        const pin2 = (document.getElementById('ev-pin2')?.value || '').trim();
        if (pin || pin2) {
          if (pin.length < 4) { alert('El PIN debe tener mínimo 4 caracteres.'); return; }
          if (pin !== pin2) { alert('El PIN y la confirmación no coinciden.'); return; }
          try {
            const eid = String(id).toUpperCase();
            localStorage.setItem('EVENT_ADMIN_PIN__' + eid, pin);
            // mantener compatibilidad con builds viejos
            localStorage.setItem('EVENT_PIN__' + eid, pin);
          } catch(_){}
        }

        // Cantada: fecha y hora
        const cantadaDate = (document.getElementById('ev-cantada-date')?.value || '').trim();
        const cantadaTime = (document.getElementById('ev-cantada-time')?.value || '').trim();
        const hasCantada  = !!(cantadaDate && cantadaTime);
        const cantadaISO  = hasCantada ? (cantadaDate + 'T' + cantadaTime) : '';

        const db = loadDB();
        const original = document.getElementById('ev-id').dataset.original || id;

        if(original && original!==id && db[original]){
          if(db[id]){ alert('Ya existe un evento con ese ID.'); return; }
          db[id] = db[original];
          delete db[original];
        }
        ensureEvent(db, id);
        db[id].meta = db[id].meta || {};
        db[id].meta.name = name;
        db[id].meta.comboSize = Math.max(1, Math.min(30, cs));
        db[id].meta.priceCarton = Math.max(0, priceCarton);
        db[id].meta.priceCombo  = Math.max(0, priceCombo);
        db[id].meta.cardColor = color || 'default';
        db[id].meta.autoTargetCards = autoTarget;

        // Guardar configuración de cantada
        db[id].meta.cantadaFechaHora = cantadaISO;
        if (!cantadaISO){
          db[id].meta.salesAutoLockDone = false;
        }

        try{
          const raw = document.getElementById('ev-capture-figs').dataset.figuras;
          if(raw){ db[id].meta.figuras = JSON.parse(raw); }
        }catch{}

                // Publicar configuración básica al backend para la landing
        try{
          fetch(API_BASE_EVENT + '/api/admin/events/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              combo_size: Math.max(1, Math.min(30, cs)),
              price_carton: Math.max(0, priceCarton),
              price_combo: Math.max(0, priceCombo),
              auto_target_cards: autoTarget,
              cantada_at: cantadaISO
            })
          }).catch(()=>{});
        }catch(_){}
saveDB(db);
        if(window.__BF_SETUP_SALES_AUTOLOCK){ try{ window.__BF_SETUP_SALES_AUTOLOCK(); }catch(_){}}
        if(window.__BF_UPDATE_AUTO_PROGRESS){
          try{ window.__BF_UPDATE_AUTO_PROGRESS(id); }catch(_){}
        }
        const eventInput = document.querySelector('#eventId');
        if(eventInput){ eventInput.value = id; eventInput.dispatchEvent(new Event('input')); }
        refreshList();
        document.getElementById('ev-form').style.display='none';
      }
    });
  }


  // ===== Bloqueo de ventas por fecha/hora de cantada =====
  function __bf_getCurrentEventId(){
    const ev = document.querySelector('#eventId');
    return (ev && (ev.value||'').trim()) || '';
  }

  function __bf_updateSalesStateUI(){
    try{
      const evt = __bf_getCurrentEventId();
      if(!evt) return;
      const db = loadDB();
      const meta = (db && db[evt] && db[evt].meta) || {};
      const salesStateEl = document.getElementById('ev-sales-state');
      if (salesStateEl){
        const locked = !!meta.salesLocked;
        salesStateEl.textContent = locked ? 'Ventas BLOQUEADAS' : 'Ventas ABIERTAS';
        salesStateEl.style.color = locked ? '#fca5a5' : '#bbf7d0';
      }
    }catch(_){}
  }

  function __bf_setSalesLocked(evt, locked){
    const db = loadDB();
    ensureEvent(db, evt);
    db[evt].meta = db[evt].meta || {};
    db[evt].meta.salesLocked = !!locked;
    saveDB(db);
    if (window.BF_SYNC_NOW_TO_CLOUD){
      try{ window.BF_SYNC_NOW_TO_CLOUD(); }catch(_){}
    }
    __bf_updateSalesStateUI();
  
    // Sincronizar bloqueo de ventas con backend (landing)
    try {
      fetch(API_BASE_EVENT + '/api/admin/events/' + encodeURIComponent(evt), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales_locked: !!locked })
      }).catch(() => {});
    } catch(_){}
}

  let __bf_salesAutoLockTimer = null;
  function __bf_checkSalesAutoLock(){
    try{
      const evt = __bf_getCurrentEventId();
      if(!evt) return;
      const db = loadDB();
      const meta = (db && db[evt] && db[evt].meta) || {};
      const iso = meta.cantadaFechaHora;
      if(!iso) return;

      const t = Date.parse(iso);
      if(!t || isNaN(t)) return;

      const now = Date.now();
      const fifteen = 15 * 60 * 1000;
      if (now >= (t - fifteen) && !meta.salesAutoLockDone){
        meta.salesLocked = true;
        meta.salesAutoLockDone = true;
        db[evt].meta = meta;
        saveDB(db);
        if (window.BF_SYNC_NOW_TO_CLOUD){
          try{ window.BF_SYNC_NOW_TO_CLOUD(); }catch(_){}
        }
        __bf_updateSalesStateUI();
      }
    }catch(_){}
  }

  window.__BF_SETUP_SALES_AUTOLOCK = function(){
    if (__bf_salesAutoLockTimer){
      clearInterval(__bf_salesAutoLockTimer);
      __bf_salesAutoLockTimer = null;
    }
    __bf_checkSalesAutoLock();
    __bf_salesAutoLockTimer = setInterval(__bf_checkSalesAutoLock, 30000);
  };
  document.addEventListener('DOMContentLoaded', ()=>{ ui(); wire(); if(window.__BF_SETUP_SALES_AUTOLOCK){ try{ window.__BF_SETUP_SALES_AUTOLOCK(); }catch(_){}} __bf_updateSalesStateUI(); });
})();