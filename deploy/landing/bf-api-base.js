// Determina la URL base del backend.
// Producción: normalmente será el mismo dominio (location.origin) y rutas /api.
// Puedes sobre-escribirlo con:
//  - window.BF_API_BASE (antes de cargar scripts)
//  - ?apiBase=https://api.tudominio.com
//  - localStorage.BF_API_BASE
(function(){
  try{
    if (typeof window === 'undefined') return;
    if (window.BF_API_BASE) return;

    var qs = new URLSearchParams(window.location.search || '');
    var fromQS = qs.get('apiBase') || qs.get('api') || '';
    if (fromQS) {
      window.BF_API_BASE = String(fromQS).replace(/\/$/, '');
      try{ localStorage.setItem('BF_API_BASE', window.BF_API_BASE); }catch(_){ }
      return;
    }

    var fromLS = '';
    try{ fromLS = localStorage.getItem('BF_API_BASE') || ''; }catch(_){ }
    if (fromLS) {
      window.BF_API_BASE = String(fromLS).replace(/\/$/, '');
      return;
    }

    // Default: mismo origen.
    var origin = (window.location && window.location.origin) ? window.location.origin : '';

    // Dev-friendly: si el frontend se sirve en localhost/127.0.0.1 y el backend
    // corre en el puerto 4000 (setup típico del proyecto), usamos ese puerto.
    // Esto evita que el navegador intente llamar /api en el servidor estático
    // (que responde 404/501 y rompe el JSON).
    try{
      var hn = (window.location && window.location.hostname) ? window.location.hostname : '';
      var isLocal = (hn === 'localhost' || hn === '127.0.0.1');
      if (isLocal) {
        var proto = (window.location && window.location.protocol) ? window.location.protocol : 'http:';
        var desired = proto + '//' + hn + ':4000';
        // Si NO estás ya en :4000, apunta al backend.
        if (origin && origin.indexOf(':4000') === -1) {
          window.BF_API_BASE = desired;
          return;
        }
      }
    }catch(_){ }

    window.BF_API_BASE = origin;
  }catch(e){
    // Silencioso
  }
})();
