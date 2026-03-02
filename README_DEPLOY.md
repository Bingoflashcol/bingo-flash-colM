# Despliegue en la nube (multi-dispositivo, estable por días/semanas)

Este proyecto ya trae un backend Node/Express que guarda ventas/cartones/estado del evento.
Para que funcione **desde varios dispositivos** (PC/celular) y no se borre nada, lo importante es:

1) Tener **UN solo backend público** (API) al que apunten todos los dispositivos.
2) Que el archivo de base de datos `bingo-db.json` esté en **disco persistente** (VPS / VM).

> Nota: se agregó un guardado atómico + una cola (mutex) para evitar pérdidas por escrituras concurrentes.

---


---

## Opción GRATIS para probar: Render (backend) + Supabase (PostgreSQL)

Si estás en etapa de prueba y NO quieres pagar VPS aún, esta es la forma más segura de tener **multi-dispositivo** sin perder ventas.

**Idea clave:** Render gratis puede “dormirse” por inactividad, pero **NO importa** si los datos están en Supabase (Postgres). Cuando alguien entra al panel, el backend “despierta”, se conecta a Supabase y sigue con toda la información intacta.

### 1) Configura Supabase (PostgreSQL)
1. Entra a tu proyecto de Supabase.
2. Ve a **Project Settings → Database → Connection string**.
3. Copia el **URI** (Connection string). Se ve similar a:
   `postgresql://USER:PASSWORD@HOST:5432/postgres`
4. Guarda ese valor; lo pondremos en `DATABASE_URL` en Render.

### 2) Sube el proyecto a GitHub (rápido)
Render normalmente despliega desde un repositorio.
1. Crea un repo en GitHub (privado o público).
2. Sube TODO el contenido del proyecto (incluye carpeta `backend/` y `deploy/`).

### 3) Crea el Web Service en Render
1. En Render → **New → Web Service** → conecta tu repo.
2. Configura:
   - **Environment:** Node
   - **Build Command:** `cd backend && npm install`
   - **Start Command:** `cd backend && npm start`
3. Variables de entorno (Environment → Add Environment Variable):
   - `NODE_ENV=production`
   - `PORT=10000` (Render suele usar el puerto de su variable interna; igual se puede definir)
   - `ADMIN_TOKEN=pon_un_token_largo`  (IMPORTANTE)
   - `DATABASE_URL=<tu_connection_string_de_supabase>`  (IMPORTANTE)
   - `PUBLIC_BASE_URL=<la_url_que_te_da_render>` (ej: `https://tu-app.onrender.com`)
   - (Opcional) `LOG_HTTP=0`

> Nota: si defines `DATABASE_URL`, el backend automáticamente usa Postgres y **ignora** `DB_PATH`.

### 4) Abre el panel desde cualquier dispositivo
Cuando Render termine el deploy, abre:
- **Panel admin:** `https://tu-app.onrender.com/admin`

Entra con tu `ADMIN_TOKEN` desde el login del panel.

### 5) Prueba rápida multi-dispositivo
- Abre `/admin` en PC y celular
- Vende/imprime cartones desde ambos
- Verifica que el estado/ventas aparecen en ambos (porque comparten la misma DB)

### Si el servicio “se duerme”
La primera vez que entras después de un rato, puede tardar unos segundos (cold start).
Después vuelve a ir normal.

---

## Opción recomendada: VPS/VM (Siempre encendida)

Una VM “Always Free” (o un VPS económico) te da:
- Disco persistente (no se borra cada reinicio)
- No hay “sleep” por inactividad
- Sirve perfecto para eventos de días/semanas

### A) Oracle Cloud (Always Free)
Oracle describe recursos **Always Free** (VM + almacenamiento + red) en su documentación oficial.
1) Crea tu cuenta (Free Tier)
2) Crea una **Compute Instance** (Ubuntu recomendado)
3) Abre puertos:
   - 80 (HTTP)
   - 443 (HTTPS)
   - 22 (SSH)

### B) Un VPS económico (cualquier proveedor)
DigitalOcean / Hetzner / Vultr / etc. (Ubuntu 22.04 o 24.04).

---

## Instalación en el servidor (Ubuntu)

### 1) Conectar por SSH
```bash
ssh ubuntu@TU_IP
```

### 2) Instalar Node.js + herramientas
Recomendado Node 18+.

```bash
sudo apt update
sudo apt install -y git unzip
# Node 20 LTS (ejemplo con NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### 3) Subir el proyecto
Opción 1: subir el ZIP y descomprimir.
Opción 2: clonar desde Git (si lo subes a GitHub).

Ejemplo con ZIP:
```bash
mkdir -p ~/bingo && cd ~/bingo
# sube el zip con scp desde tu PC:
# scp "BINGO FLASH TRADICIONAL para venta manual.zip" ubuntu@TU_IP:~/bingo/
unzip "BINGO FLASH TRADICIONAL para venta manual.zip"
cd "BINGO FLASH TRADICIONAL/backend"
npm install
```

### 4) Configurar variables de entorno
Copia el ejemplo y edítalo:

```bash
cp .env.example .env
nano .env
```

Configura mínimo:
- `NODE_ENV=production`
- `PORT=4000`
- `ADMIN_TOKEN=un_token_largo_y_secreto`
- `ALLOWED_ORIGINS=https://TU_DOMINIO` (o déjalo vacío si vas a servir todo desde el mismo dominio)

Persistencia (MUY importante):
- `DB_PATH=/var/lib/bingo/bingo-db.json`
- `FILES_PATH=/var/lib/bingo/files`

Crea la carpeta persistente:
```bash
sudo mkdir -p /var/lib/bingo/files
sudo chown -R $USER:$USER /var/lib/bingo
```

### 5) Probar localmente en el servidor
```bash
cd ~/bingo/"BINGO FLASH TRADICIONAL"/backend
node src/server.js
```

Prueba:
- `http://TU_IP:4000/health`
- `http://TU_IP:4000/admin` (si estás sirviendo el frontend desde el backend)

Ctrl+C para parar.

---

## Ponerlo 24/7 con PM2 (recomendado)

```bash
sudo npm i -g pm2
cd ~/bingo/"BINGO FLASH TRADICIONAL"/backend
pm2 start src/server.js --name bingo
pm2 save
pm2 startup
# ejecuta el comando que te imprime pm2 startup
```

Ver logs:
```bash
pm2 logs bingo
```

---

## (Opcional) Nginx + HTTPS con dominio

### 1) Instalar Nginx
```bash
sudo apt install -y nginx
```

### 2) Proxy a Node (4000)
Crea config:
```bash
sudo nano /etc/nginx/sites-available/bingo
```

Contenido (cambia TU_DOMINIO):
```nginx
server {
  server_name TU_DOMINIO;

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Activar:
```bash
sudo ln -s /etc/nginx/sites-available/bingo /etc/nginx/sites-enabled/bingo
sudo nginx -t
sudo systemctl restart nginx
```

### 3) SSL (Let's Encrypt)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d TU_DOMINIO
```

---

## Uso desde diferentes dispositivos

- Abres en PC o celular: `https://TU_DOMINIO/admin`
- Todos los cartones/ventas se guardan en `DB_PATH` en el servidor.
- El detector (integrado en el panel) ve lo mismo, porque todos consumen el mismo backend.

---

## Notas importantes

- **No uses “export/import” como sistema principal** si vendes en paralelo desde varios dispositivos.
  Para multi-dispositivo, lo correcto es estado centralizado en el backend (esto).
- Se agregó guardado **atómico** (tmp + rename) para evitar archivos corruptos si se apaga el servidor.
- Se agregó una **cola** para serializar escrituras y evitar “lost updates” cuando varios dispositivos venden al mismo tiempo.
