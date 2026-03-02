# Deploy (sin Docker)

## Landing (Netlify)
Sube el contenido de `deploy/landing` a un sitio Netlify y asigna el dominio:
- https://www.bingoflashcol.com

Antes de subir, define la URL del backend usando UNA de estas opciones:
1) En cada HTML, antes de los scripts:
   <script>window.BF_API_BASE="https://api.bingoflashcol.com";</script>
2) O con querystring ?apiBase=...
3) O con localStorage.BF_API_BASE

## Admin (Netlify) - recomendado como subdominio NO obvio
Sube el contenido de `deploy/admin` a OTRO sitio Netlify y asigna el subdominio:
- https://gerente-7hf.bingoflashcol.com

## Backend (Render)
Sube la carpeta `backend` como Web Service Node.
Configura Persistent Disk montado en /data y env vars:
- NODE_ENV=production
- ADMIN_TOKEN=...
- ALLOWED_ORIGINS=https://www.bingoflashcol.com,https://gerente-7hf.bingoflashcol.com
- DB_PATH=/data/bingo-db.json
- FILES_PATH=/data/files
- PAYMENT_MODE=SIMULATED
