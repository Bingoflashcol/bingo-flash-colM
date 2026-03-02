const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, withDB } = require('./db');
const { createNequiPayment, verifyNequiWebhook } = require('./nequi');
const { generateTicketsForOrder } = require('./tickets');
const { requireAdmin } = require('./auth');

const router = express.Router();

// Protege endpoints administrativos (órdenes manuales, marcar pagos, listados, etc.)
router.use('/admin', requireAdmin);


const ORDER_STATUS = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  TICKETS_ISSUED: 'TICKETS_ISSUED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED'
};

function nowISO(){ return new Date().toISOString(); }

function isApprovedStatus(s){
  return s === ORDER_STATUS.PAID || s === ORDER_STATUS.TICKETS_ISSUED;
}

function expirePendingOrders(db){
  const ttlMin = Number(process.env.ORDER_PENDING_TTL_MINUTES || 30);
  const nowMs = Date.now();
  let changed = false;

  if (!Array.isArray(db.orders)) return false;

  for (const o of db.orders){
    if (!o || o.status !== ORDER_STATUS.PENDING_PAYMENT) continue;

    // Si no hay expires_at, lo calculamos para no dejar órdenes zombie
    if (!o.expires_at) {
      const created = Date.parse(o.created_at) || nowMs;
      o.expires_at = new Date(created + ttlMin*60*1000).toISOString();
      changed = true;
      continue;
    }

    const expMs = Date.parse(o.expires_at);
    if (!Number.isFinite(expMs)) continue;

    if (expMs <= nowMs) {
      o.status = ORDER_STATUS.EXPIRED;
      o.expired_at = nowISO();
      changed = true;
    }
  }

  return changed;
}

function normStr(v){
  return (v == null ? '' : String(v)).trim();
}

function isValidEmail(email){
  if (!email) return true;
  const s = String(email).trim();
  // Simple, practical validation
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

function isValidPhone(phone){
  const s = normStr(phone);
  // Accept digits with optional spaces, +, -
  const digits = s.replace(/[^0-9]/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

function getIdempotencyKey(req){
  const k = req.get('Idempotency-Key') || req.get('X-Idempotency-Key');
  return normStr(k) || null;
}

function resolveVendorForEvent(db, eventId, vendorCode){
  if (!vendorCode) return null;
  const entry = db.event_states && db.event_states[eventId];
  const st = entry && entry.state;
  const vendors = st && st.vendors ? st.vendors : null;
  if (!vendors || typeof vendors !== 'object') return null;

  const code = String(vendorCode).trim();
  for (const [id, v] of Object.entries(vendors)) {
    if (!v) continue;
    if (code === id || code === String(v.linkToken || '').trim()) {
      return {
        id,
        name: (v.name || v.nombre || '').toString().trim() || id,
        commissionPct: Number(v.commissionPct || v.comisionPct || 0) || 0
      };
    }
  }
  return null;
}

function bumpVendorStats(db, eventId, vendorId, cards, amountCop){
  if (!vendorId) return;
  if (!db.event_states || !db.event_states[eventId] || !db.event_states[eventId].state) return;
  const st = db.event_states[eventId].state;
  if (!st.vendors || typeof st.vendors !== 'object') st.vendors = {};
  const v = st.vendors[vendorId];
  if (!v) return;

  if (!v.stats || typeof v.stats !== 'object') v.stats = {};
  v.stats.cartones = (v.stats.cartones|0) + (cards|0);

  const pct = Number(v.commissionPct || v.comisionPct || 0) || 0;
  const add = (Number(amountCop) || 0) * (pct/100);
  v.stats.comision = (Number(v.stats.comision) || 0) + add;
}


// Crea orden "normal" (cliente en portal, pago en línea)
router.post('/orders', async (req, res) => {
  const { eventId, offerId, buyerName, buyerPhone, buyerEmail, format, vendor } = req.body || {};

  if (!eventId || !offerId || !buyerName || !buyerPhone || !format) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  if (!isValidPhone(buyerPhone)) {
    return res.status(400).json({ error: 'Teléfono no válido' });
  }
  if (!isValidEmail(buyerEmail)) {
    return res.status(400).json({ error: 'Correo no válido' });
  }

  const idemKey = getIdempotencyKey(req);

  const result = await withDB((db) => {
    if (!Array.isArray(db.orders)) db.orders = [];
    if (!Array.isArray(db.offers)) db.offers = [];
    if (!Array.isArray(db.events)) db.events = [];
    if (!db.idempotency || typeof db.idempotency !== 'object') db.idempotency = {};

    // Expirar pendientes para no acumular basura
    expirePendingOrders(db);

    // Idempotencia: si el frontend repite la solicitud, devolvemos la misma orden.
    if (idemKey) {
      const existing = db.idempotency[idemKey];
      if (existing && existing.order_id) {
        const prev = db.orders.find(o => o.id === existing.order_id);
        if (prev) {
          return {
            status: 200,
            body: {
              orderId: prev.id,
              status: prev.status,
              amount: prev.amount_cop || 0,
              paymentUrl: prev.payment_url || null,
              idempotent: true
            }
          };
        }
      }
    }

    const offer = db.offers.find(o => o.id === offerId && o.event_id === eventId);
    if (!offer) {
      return { status: 404, body: { error: 'Oferta no encontrada' } };
    }

    const event = db.events.find(e => e.id === eventId);
    if (!event) {
      return { status: 404, body: { error: 'Evento no encontrado' } };
    }

    const comboSize = event.combo_size || 6;
    const amount = Number(offer.price_cop || 0);

    const orderId = uuidv4();
    const now = new Date().toISOString();

    const vendorInfo = resolveVendorForEvent(db, eventId, vendor);

    const pay = createNequiPayment({ orderId, amount, buyerPhone });
    const nequiRef = pay && pay.nequiRef ? pay.nequiRef : null;
    const paymentUrl = pay && pay.paymentUrl ? pay.paymentUrl : null;

    const orderRow = {
      id: orderId,
      event_id: eventId,
      offer_id: offerId,
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      buyer_email: buyerEmail || null,
      vendor_code: vendor || null,
      vendor_id: vendorInfo ? vendorInfo.id : null,
      vendor_name: vendorInfo ? vendorInfo.name : null,
      format,
      amount_cop: amount,
      nequi_ref: nequiRef,
      payment_url: paymentUrl,
      status: 'PENDING',
      created_at: now,
      paid_at: null,
      expires_at: new Date(Date.now() + (Number(process.env.ORDER_PENDING_TTL_MINUTES || 30) * 60 * 1000)).toISOString(),
      payment_method: 'NEQUI',
      combos_count: offer.combos_count || 1,
      combo_size: comboSize
    };

    db.orders.push(orderRow);

    if (idemKey) {
      db.idempotency[idemKey] = { order_id: orderId, created_at: now };
    }

    return {
      status: 200,
      body: {
        orderId,
        status: 'PENDING',
        amount,
        paymentUrl
      }
    };
  });

  return res.status(result.status).json(result.body);
});


// Crea orden manual (tú cobras por fuera y la marcas como pagada)
router.post('/admin/manual-order', async (req, res) => {
  const {
    eventId,
    buyerName,
    buyerPhone,
    buyerEmail,
    format,
    paymentMethod,
    vendor,
    combos,
    comboSize
  } = req.body || {};

  if (!eventId || !buyerName || !buyerPhone || !format) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  if (!isValidPhone(buyerPhone)) {
    return res.status(400).json({ error: 'Teléfono no válido' });
  }
  if (!isValidEmail(buyerEmail)) {
    return res.status(400).json({ error: 'Correo no válido' });
  }

  // 1) Creamos la orden en estado PAID (venta manual) de forma atómica
  const created = await withDB((db) => {
    if (!Array.isArray(db.orders)) db.orders = [];
    if (!Array.isArray(db.events)) db.events = [];
    if (!db.idempotency || typeof db.idempotency !== 'object') db.idempotency = {};

    const event = db.events.find(e => e.id === eventId);
    if (!event) {
      return { status: 404, body: { error: 'Evento no encontrado' } };
    }

    const amount = 0; // puedes manejar monto desde el front si lo necesitas
    const orderId = uuidv4();
    const now = new Date().toISOString();

    const vendorInfo = resolveVendorForEvent(db, eventId, vendor);

    const order = {
      id: orderId,
      event_id: eventId,
      offer_id: null,
      buyer_name: buyerName,
      buyer_phone: buyerPhone,
      buyer_email: buyerEmail || null,
      vendor_code: vendor || null,
      vendor_id: vendorInfo ? vendorInfo.id : null,
      vendor_name: vendorInfo ? vendorInfo.name : null,
      format,
      amount_cop: amount,
      nequi_ref: null,
      status: ORDER_STATUS.PAID,
      created_at: now,
      paid_at: now,
      expires_at: null,
      payment_method: paymentMethod || 'MANUAL',
      combos_count: Number(combos || 1),
      combo_size: Number(comboSize || event.combo_size || 6)
    };

    db.orders.push(order);
    return { status: 200, body: { order } };
  });

  if (created.status !== 200) {
    return res.status(created.status).json(created.body);
  }

  const order = created.body.order;

  // 2) Generamos cartones (idempotente)
  try {
    await generateTicketsForOrder(order);
  } catch (err) {
    console.error('Error generando tickets para orden manual', order.id, err);
  }

  // 3) Marcamos como emitida
  await withDB((db) => {
    const o2 = Array.isArray(db.orders) ? db.orders.find(o => o.id === order.id) : null;
    if (o2 && o2.status === ORDER_STATUS.PAID) {
      o2.status = ORDER_STATUS.TICKETS_ISSUED;
      o2.tickets_issued_at = nowISO();
    }
  });

  return res.json({ ok: true, orderId: order.id });
});


// Webhook de Nequi (simulado)
router.post('/payments/nequi-webhook', async (req, res) => {
  if (!verifyNequiWebhook(req)) {
    return res.status(401).json({ error: 'Webhook no autorizado' });
  }

  const { nequiRef, status } = req.body || {};
  if (!nequiRef || !status) {
    return res.status(400).json({ error: 'nequiRef y status requeridos' });
  }

  // 1) Actualizar estado de la orden
  const updated = await withDB((db) => {
    if (!Array.isArray(db.orders)) db.orders = [];
    expirePendingOrders(db);

    const order = db.orders.find(o => o.nequi_ref === nequiRef);
    if (!order) return { status: 404, body: { error: 'Orden no encontrada' } };

    if (status === 'APPROVED' || status === 'PAID') {
      if (isApprovedStatus(order.status)) {
        return { status: 200, body: { ok: true, idempotent: true, orderId: order.id } };
      }
      if (order.status === ORDER_STATUS.EXPIRED) {
        return { status: 409, body: { error: 'Orden expirada' } };
      }
      order.status = ORDER_STATUS.PAID;
      order.paid_at = nowISO();
      return { status: 200, body: { ok: true, orderId: order.id, paid: true } };
    }

    if (status === 'REJECTED' || status === 'FAILED') {
      order.status = ORDER_STATUS.FAILED;
      order.failed_at = nowISO();
      return { status: 200, body: { ok: true, orderId: order.id, failed: true } };
    }

    return { status: 200, body: { ok: true, orderId: order.id, ignored: true } };
  });

  if (updated.status !== 200) {
    return res.status(updated.status).json(updated.body);
  }

  const orderId = updated.body.orderId;
  if (updated.body.paid) {
    // 2) Emitir cartones
    const dbNow = await readDB();
    const order = dbNow.orders.find(o => o.id === orderId);
    if (order) {
      try {
        await generateTicketsForOrder(order);
      } catch (err) {
        console.error('Error generando tickets para orden', orderId, err);
      }
    }

    // 3) Marcar como emitida
    await withDB((db) => {
      const o2 = db.orders.find(o => o.id === orderId);
      if (o2) {
        o2.status = ORDER_STATUS.TICKETS_ISSUED;
        o2.tickets_issued_at = nowISO();
      }
    });
  }

  return res.json({ ok: true });
});


// Info de una orden + tickets
router.get('/orders/:id', async (req, res) => {
  const db = await readDB();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

  const tickets = db.tickets
    .filter(t => t.order_id === order.id)
    .sort((a, b) => a.card_index - b.card_index);

  res.json({ order, tickets });
});

// Buscar órdenes de un cliente por teléfono/correo
router.get('/orders', requireAdmin, async (req, res) => {
  const { phone, email, eventId } = req.query;
  if (!phone && !email) {
    return res.status(400).json({ error: 'Debe enviar phone o email' });
  }

  const db = await readDB();
  let rows = db.orders;

  if (phone) {
    rows = rows.filter(o => o.buyer_phone === phone);
  }
  if (email) {
    rows = rows.filter(o => o.buyer_email === email);
  }
  // Si viene eventId, filtrar también por evento para que cada landing
  // sólo muestre las compras/cartones del evento actual.
  if (eventId) {
    rows = rows.filter(o => o.event_id === eventId);
  }

  rows = rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  res.json(rows);
});

// Marcar una orden como pagada y generar cartones (admin)
router.post('/admin/mark-paid', async (req, res) => {
  const { orderId } = req.body || {};
  if (!orderId) {
    return res.status(400).json({ error: 'orderId requerido' });
  }

  // 1) Marcar pagada
  const updated = await withDB((db) => {
    if (!Array.isArray(db.orders)) db.orders = [];
    const order = db.orders.find(o => o.id === orderId);
    if (!order) return { status: 404, body: { error: 'Orden no encontrada' } };

    // Rellenar combos y tamaño de combo si hace falta
    let combosCount = order.combos_count || 1;
    let comboSize = order.combo_size || 6;

    if (order.offer_id && Array.isArray(db.offers)) {
      const offer = db.offers.find(o => o.id === order.offer_id && o.event_id === order.event_id);
      if (offer) combosCount = offer.combos_count || combosCount;
    }

    if (Array.isArray(db.events)) {
      const event = db.events.find(e => e.id === order.event_id);
      if (event && event.combo_size) comboSize = event.combo_size;
    }

    order.combos_count = combosCount;
    order.combo_size = comboSize;

    order.status = ORDER_STATUS.PAID;
    order.paid_at = nowISO();
    return { status: 200, body: { ok: true, order } };
  });

  if (updated.status !== 200) {
    return res.status(updated.status).json(updated.body);
  }

  const order = updated.body.order;

  // 2) Generar cartones
  try {
    await generateTicketsForOrder(order);
  } catch (err) {
    console.error('Error generando tickets para orden', order.id, err);
  }

  // 3) Marcar como emitida
  await withDB((db) => {
    const o2 = db.orders.find(o => o.id === order.id);
    if (o2) {
      o2.status = ORDER_STATUS.TICKETS_ISSUED;
      o2.tickets_issued_at = nowISO();
    }
  });

  const db2 = await readDB();
  const tickets = db2.tickets
    .filter(t => t.order_id === order.id)
    .sort((a, b) => a.card_index - b.card_index);

  res.json({ ok: true, order, tickets });
});


module.exports = router;
