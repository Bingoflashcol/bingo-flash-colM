const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
const ordersRouter = require('./orders');
const eventsRouter = require('./events');
require('dotenv').config();

const app = express();

// In proxied hosting (Render/Railway/Nginx), needed for correct IP / rate-limit.
app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Basic request logging (disable by setting LOG_HTTP=0)
if (process.env.LOG_HTTP !== '0') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// CORS: allow configured origins in production.
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Hard safety checks for production
if (process.env.NODE_ENV === 'production') {
  if (!(process.env.ADMIN_TOKEN || '').trim()) {
    throw new Error('ADMIN_TOKEN es obligatorio en producción');
  }
  if (!allowed.length) {
    console.warn('ALLOWED_ORIGINS no está definido: se permitirá cualquier origen (recomendado configurar en producción)');
  }
}

app.use(cors({
  origin: function (origin, cb) {
    // allow tools like curl/postman and same-origin
    if (!origin) return cb(null, true);
    if (!allowed.length) return cb(null, true); // default: allow all
    return cb(null, allowed.includes(origin));
  },
  credentials: true,
}));

// Limit JSON bodies to avoid abuse (can increase if you store big base64 configs)
app.use(express.json({ limit: process.env.JSON_LIMIT || '2mb' }));

// Very basic rate limit for public endpoints
app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PER_MIN || 180),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
}));

const filesDir = (process.env.FILES_PATH && process.env.FILES_PATH.trim())
  ? process.env.FILES_PATH.trim()
  : path.join(__dirname, '..', 'files');
app.use('/files', express.static(filesDir));




// --- Frontend estático (opcional) ---
// Si despliegas todo junto (recomendado), el backend sirve el frontend desde /deploy
try {
 const publicRoot = path.join(__dirname, '..', '..', 'desplegar');
  // landing en /
  app.use('/', express.static(path.join(publicRoot, 'landing')));
  // admin en /admin
  app.use('/admin', express.static(path.join(publicRoot, 'admin')));
} catch (e) {
  // Ignorar si no existe deploy en el entorno
}
app.get('/api', (req, res) => {
  res.send('API Bingo funcionando');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use('/api', eventsRouter);
app.use('/api', ordersRouter);

// Error handler (last)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log('Servidor escuchando en el puerto ' + PORT);
});
