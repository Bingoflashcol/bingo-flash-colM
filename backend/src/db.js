const fs = require('fs');
const path = require('path');

const USE_PG = !!(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());

const DB_PATH = (process.env.DB_PATH && process.env.DB_PATH.trim())
  ? process.env.DB_PATH.trim()
  : path.join(__dirname, '..', 'bingo-db.json');

// --- Seed (estructura por defecto) ---
function makeSeed(){
  return {
    events: [
      {
        id: 'VIERNES',
        name: 'Bingo Flash Tradicional',
        date_time: null,
        combo_size: 6,
        price_carton: 0,
        admin_pin: null
      }
    ],
    offers: [
      { id: 'c1', event_id: 'VIERNES', label: '1 combo',  combos_count: 1,  price_cop: 6000 },
      { id: 'c2', event_id: 'VIERNES', label: '2 combos', combos_count: 2,  price_cop: 12000 },
      { id: 'c5', event_id: 'VIERNES', label: '5 combos', combos_count: 5,  price_cop: 28000 },
      { id: 'c10',event_id: 'VIERNES', label: '10 combos', combos_count: 10, price_cop: 50000 }
    ],
    orders: [],
    tickets: [],
    // Map para idempotencia (pagos/órdenes): { [key]: { order_id, created_at } }
    idempotency: {},
    // Estado persistente por evento (fuente de verdad del panel).
    // event_states: { [eventId]: { state: <obj>, updated_at: <iso> } }
    event_states: {},
    // Consecutivo persistente por evento (serial impreso)
    event_ticket_seq: {}
  };
}

// ──────────────────────────────────────────────────────────────
// Modo 1: Archivo JSON (para VPS / disco persistente)
// ──────────────────────────────────────────────────────────────
function ensureParentDir(filePath){
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureDBFile() {
  ensureParentDir(DB_PATH);
  if (!fs.existsSync(DB_PATH)) {
    const seed = makeSeed();
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(seed, null, 2), 'utf8');
    fs.renameSync(tmp, DB_PATH);
  }
}

function loadDBFile() {
  ensureDBFile();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveDBFile(db) {
  ensureParentDir(DB_PATH);
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

let _queue = Promise.resolve();
function withDBFile(fn){
  _queue = _queue.then(async () => {
    const db = loadDBFile();
    const result = await fn(db);
    saveDBFile(db);
    return result;
  });
  return _queue;
}

// ──────────────────────────────────────────────────────────────
// Modo 2: PostgreSQL (Supabase / Neon) — recomendado para multi-dispositivo
// ──────────────────────────────────────────────────────────────
let _pool = null;

function getPool(){
  if (_pool) return _pool;
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL.trim();

  // Supabase/Neon suelen requerir SSL. En Node (pg) debes setear ssl manual.
  // Si ya traes "?sslmode=require" igualmente esto ayuda en hosting.
  const ssl = (process.env.PGSSLMODE === 'disable')
    ? false
    : { rejectUnauthorized: false };

  _pool = new Pool({ connectionString: url, ssl });
  return _pool;
}

async function ensurePGSchema(client){
  await client.query(`
    CREATE TABLE IF NOT EXISTS bingo_kv (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function loadDBPG(client){
  await ensurePGSchema(client);
  const r = await client.query(`SELECT value FROM bingo_kv WHERE key='db'`);
  if (r.rowCount === 0) {
    const seed = makeSeed();
    await client.query(
      `INSERT INTO bingo_kv(key, value) VALUES ('db', $1::jsonb)`,
      [seed]
    );
    return seed;
  }
  return r.rows[0].value;
}

async function saveDBPG(client, db){
  await ensurePGSchema(client);
  await client.query(
    `UPDATE bingo_kv SET value=$1::jsonb, updated_at=now() WHERE key='db'`,
    [db]
  );
}

async function withDBPG(fn){
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock fila "db" para serializar cambios y evitar lost-updates.
    await ensurePGSchema(client);
    const r = await client.query(`SELECT value FROM bingo_kv WHERE key='db' FOR UPDATE`);
    let db;
    if (r.rowCount === 0) {
      db = makeSeed();
      await client.query(`INSERT INTO bingo_kv(key, value) VALUES ('db', $1::jsonb)`, [db]);
    } else {
      db = r.rows[0].value;
    }

    const result = await fn(db);

    await client.query(`UPDATE bingo_kv SET value=$1::jsonb, updated_at=now() WHERE key='db'`, [db]);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch(_) {}
    throw e;
  } finally {
    client.release();
  }
}

// ──────────────────────────────────────────────────────────────
// API pública del módulo
// ──────────────────────────────────────────────────────────────

// Lectura "read-only" (NO escribe).
// Útil para endpoints públicos (landing/config) donde no queremos generar escrituras por cada consulta.
async function readDB(){
  if (USE_PG) {
    const pool = getPool();
    const client = await pool.connect();
    try{
      await ensurePGSchema(client);
      const r = await client.query(`SELECT value FROM bingo_kv WHERE key='db'`);
      if (r.rowCount === 0) {
        const seed = makeSeed();
        await client.query(`INSERT INTO bingo_kv(key, value) VALUES ('db', $1::jsonb)`, [seed]);
        return seed;
      }
      return r.rows[0].value;
    } finally {
      client.release();
    }
  }
  // archivo
  return loadDBFile();
}

// loadDB/saveDB síncronos solo para modo archivo.
// En modo PostgreSQL, usa readDB()/withDB().
function loadDB(){
  if (USE_PG) {
    throw new Error('loadDB() no soportado en modo PostgreSQL. Usa readDB() o withDB().');
  }
  return loadDBFile();
}

function saveDB(db){
  if (USE_PG) {
    throw new Error('saveDB() no soportado en modo PostgreSQL. Usa withDB().');
  }
  return saveDBFile(db);
}

function withDB(fn){
  if (USE_PG) return withDBPG(fn);
  return withDBFile(fn);
}

module.exports = {
  readDB,
  loadDB,
  saveDB,
  withDB,
  DB_PATH,
  USE_PG
};
