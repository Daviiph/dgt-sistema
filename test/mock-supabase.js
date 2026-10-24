// SOLO PRUEBAS: imita la API de Supabase en memoria para revisar la interfaz sin base de datos real.
// Se activa únicamente al compilar con VITE_MOCK=1 (ver vite.config.js). No se usa en producción.
const day = 864e5
const now = Date.now()
const iso = (msAgo) => new Date(now - msAgo).toISOString()
const db = {
  profiles: [{ id: 'u1', email: 'david@dgt.com', full_name: 'David Admin', role: 'admin', active: true, created_at: iso(9 * day) }],
  settings: [{ key: 'currency', value: '$' }, { key: 'rate_bcv', value: '879.12' }, { key: 'rate', value: '879.12' }, { key: 'rate_binance', value: '1007.5' }, { key: 'rate_date', value: new Date().toLocaleDateString('es-VE') }],
  brands: [{ id: 1, name: 'Samsung', extra: {} }, { id: 2, name: 'Xiaomi', extra: {} }, { id: 3, name: 'Apple', extra: {} }],
  products: [
    { id: 11, brand_id: '1', name: 'Galaxy A15', category: 'Teléfono', color: '#000000', price: 165, stock: 12, extra: {} },
    { id: 12, brand_id: '1', name: 'Galaxy A15', category: 'Teléfono', color: '#0000FF', price: 165, stock: 3, extra: {} },
    { id: 13, brand_id: '2', name: 'Redmi Note 13', category: 'Teléfono', color: '#808080', price: 210, stock: 8, extra: {} },
    { id: 14, brand_id: '2', name: 'Redmi 13C', category: 'Teléfono', color: '#008000', price: 120, stock: 2, extra: {} },
    { id: 15, brand_id: '3', name: 'AirPods 3', category: 'Audio', color: '#ffffff', price: 140, stock: 6, extra: {} },
    { id: 16, brand_id: '1', name: 'Galaxy S24', category: 'Teléfono', color: '#C0C0C0', price: 780, stock: 4, extra: {} },
  ],
  customers: [
    { id: 21, name: 'María González', cedula: 'V-20.111.222', email: 'maria@mail.com', phone: '0414-1112233', extra: {} },
    { id: 22, name: 'Carlos Pérez', cedula: 'V-18.333.444', email: 'carlos@mail.com', phone: '0424-5556677', extra: {} },
    { id: 23, name: 'Inversiones Lara C.A.', cedula: 'J-40123456-7', rif: 'J-40123456-7', email: 'lara@mail.com', phone: '0212-9998877', extra: {} },
  ],
  sellers: [{ id: 31, name: 'Ana Rivas', comm: 0.01, extra: {} }, { id: 32, name: 'Luis Mora', comm: 0.008, extra: {} }],
  payment_methods: [{ id: 41, name: 'Efectivo $', extra: {} }, { id: 42, name: 'Zelle', extra: {} }, { id: 43, name: 'Pago Móvil', extra: {} }],
  resale_items: [
    { id: 51, brand: 'Apple', name: 'iPhone 13 128GB', color: 'Azul · usado A+', serial: '35609', supplier: 'Jorge (Sabana Grande)', cost: 330, price: 410, stock: 1, acquired_at: '12/10/2026', extra: {} },
    { id: 52, brand: 'Samsung', name: 'Galaxy S23 Ultra', color: 'Negro · nuevo', supplier: 'Importadora Caracas', cost: 820, price: 960, stock: 1, acquired_at: '14/10/2026', extra: {} },
    { id: 53, brand: 'Apple', name: 'iPhone 12', color: 'Blanco', supplier: 'Jorge (Sabana Grande)', cost: 250, price: 310, stock: 0, acquired_at: '05/10/2026', extra: {} },
  ],
  sales: [],
  audit_log: [],
}
const pick = (arr, id) => arr.find((p) => String(p.id) === String(id))
const mkSale = (i, msAgo, cust, seller, items, channel = 'tienda') => {
  const src = channel === 'reventa' ? db.resale_items : db.products
  const its = items.map(([id, qty]) => { const p = pick(src, id); return { ...p, brandId: p.brand_id, qty, source: channel } })
  const total = its.reduce((a, x) => a + x.price * x.qty, 0)
  const cost = channel === 'reventa' ? its.reduce((a, x) => a + x.cost * x.qty, 0) : null
  db.sales.push({ id: (channel === 'reventa' ? 'REV-' : 'INV-') + (10000000 + i), date: new Date(now - msAgo).toLocaleString('es-VE'), customer_id: String(cust), seller_id: String(seller), rate: 879.12, rate_type: 'BCV', doc_type: channel === 'reventa' ? 'Nota de Entrega' : 'Factura No Fiscal', main_currency: 'USD', payments: [{ methodId: '42', amount: total, currency: 'USD' }], items: its, total, status: 'activa', channel, cost_total: cost, extra: {}, created_at: iso(msAgo) })
}
;[[13, 21, 31, [[11, 1]]], [12, 22, 32, [[13, 2]]], [11, 23, 31, [[16, 1], [15, 2]]], [10, 21, 31, [[14, 1]]], [9, 22, 32, [[11, 2]]], [7, 23, 31, [[13, 1], [15, 1]]], [6, 21, 32, [[16, 1]]], [5, 22, 31, [[12, 1]]], [4, 23, 31, [[13, 3]]], [3, 21, 32, [[15, 1]]], [2, 22, 31, [[16, 1], [11, 1]]], [1, 23, 32, [[13, 1]]], [0.2, 21, 31, [[11, 1], [15, 1]]]]
  .forEach(([d, c, s, it], i) => mkSale(i, d * day, c, s, it))
// Ventas de meses anteriores (para probar rangos de varios meses)
;[[18, 22, 31, [[12, 1]]], [24, 21, 32, [[13, 1]]], [33, 23, 31, [[16, 2]]], [41, 21, 31, [[11, 1]]], [47, 22, 32, [[15, 3]]], [55, 23, 31, [[14, 1]]], [63, 21, 32, [[13, 2]]], [72, 22, 31, [[16, 1]]], [86, 23, 32, [[11, 1], [12, 1]]]]
  .forEach(([d, c, s, it], i) => mkSale(40 + i, d * day + 3.5 * 3600e3, c, s, it))
mkSale(90, 4 * day, 22, 31, [[53, 1]], 'reventa')
db.resale_items.find((r) => r.id === 53).stock = 0

const session = new URLSearchParams(location.search).has('mocklogin') ? null : { user: { id: 'u1', email: 'david@dgt.com' } }
let authCb = () => {}

class Query {
  constructor(t) { this.t = t; this.rows = () => db[t] || []; this.filters = []; this.op = 'select' }
  select() { return this }
  order(col, o = {}) { this.ord = [col, o.ascending !== false]; return this }
  limit(n) { this.lim = n; return this }
  eq(col, v) { this.filters.push((r) => String(r[col]) === String(v)); return this }
  neq(col, v) { this.filters.push((r) => String(r[col]) !== String(v)); return this }
  maybeSingle() { this.one = true; return this }
  in(col, vs) { this.filters.push((r) => vs.map(String).includes(String(r[col]))); return this }
  single() { this.one = true; return this }
  upsert(rows) { this.op = 'upsert'; this.payload = [].concat(rows); return this }
  update(p) { this.op = 'update'; this.payload = p; return this }
  delete() { this.op = 'delete'; return this }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej) }
  run() {
    if (!navigator.onLine) return { data: null, error: { message: 'TypeError: Failed to fetch' } }
    const all = db[this.t] = db[this.t] || []
    const key = this.t === 'settings' ? 'key' : 'id'
    const match = (r) => this.filters.every((f) => f(r))
    if (this.op === 'upsert') {
      for (const row of this.payload) {
        const i = all.findIndex((r) => String(r[key]) === String(row[key]))
        if (i >= 0) all[i] = { ...all[i], ...row }; else all.push({ created_at: new Date().toISOString(), ...row })
      }
      return { data: null, error: null }
    }
    if (this.op === 'update') { all.filter(match).forEach((r) => Object.assign(r, this.payload)); return { data: null, error: null } }
    if (this.op === 'delete') { db[this.t] = all.filter((r) => !match(r)); return { data: null, error: null } }
    if (this.t === 'resale_items' && new URLSearchParams(location.search).has('noresale')) return { data: null, error: { message: 'relation "resale_items" does not exist' } }
    let out = all.filter(match).map((r) => JSON.parse(JSON.stringify(r)))
    if (this.ord) { const [c, asc] = this.ord; out.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)) }
    if (this.lim) out = out.slice(0, this.lim)
    return { data: this.one ? out[0] || null : out, error: null }
  }
}

function rpc(name, args) {
  if (!navigator.onLine) return { data: null, error: { message: 'TypeError: Failed to fetch' } }
  if (name === 'create_sale') {
    const p = args.p, ch = p.channel || 'tienda'
    const src = ch === 'reventa' ? db.resale_items : db.products
    let total = 0, cost = 0
    for (const it of p.items) {
      const r = pick(src, it.id)
      if (!r || r.stock < it.qty) return { data: null, error: { message: 'Stock insuficiente para ' + it.name } }
      r.stock -= it.qty; total += r.price * it.qty; cost += (r.cost || 0) * it.qty
    }
    const fee = Number(p.delivery && p.delivery.fee) || 0
    total += fee
    const row = { id: p.id, date: p.date, customer_id: p.customerId, seller_id: p.sellerId, rate: p.rate, rate_type: p.rateType, doc_type: p.docType, main_currency: p.mainCurrency, payments: p.payments, items: p.items, total, status: 'activa', channel: ch, cost_total: ch === 'reventa' ? cost : null, delivery: fee > 0 ? p.delivery : null, extra: {}, created_at: new Date().toISOString() }
    db.sales.push(row)
    return { data: row, error: null }
  }
  if (name === 'cancel_sale') {
    const s = pick(db.sales, args.p_id)
    const src = s.channel === 'reventa' ? db.resale_items : db.products
    s.items.forEach((it) => { const r = pick(src, it.id); if (r) r.stock += it.qty })
    Object.assign(s, { status: 'cancelada', cancel_reason: args.p_reason, cancel_date: new Date().toLocaleString('es-VE') })
    return { data: s, error: null }
  }
  if (name === 'delete_sale') { db.sales = db.sales.filter((s) => s.id !== args.p_id); return { data: null, error: null } }
  return { data: null, error: { message: 'rpc ' + name } }
}

export const isConfigured = true
export const supabase = {
  from: (t) => new Query(t),
  rpc: async (n, a) => rpc(n, a),
  functions: { invoke: async (name, { body }) => { if (!navigator.onLine) return { data: null, error: { message: 'Failed to send a request to the Edge Function' } }; if (name === 'asistente-precios') return { data: { precio: Math.round(body.cost * 1.18), minimo: Math.round(body.cost * 1.1), maximo: Math.round(body.cost * 1.3), margen_pct: 15, explicacion: 'En MercadoLibre Venezuela este equipo se publica entre esos precios (simulación de prueba).', fuentes: [{ title: 'MercadoLibre Venezuela', url: 'https://listado.mercadolibre.com.ve/' }] }, error: null }; await new Promise(r => setTimeout(r, 400)); const s = pick(db.sales, body.saleId); const c = pick(db.customers, s.customer_id); s.extra = { ...(s.extra || {}), emailedAt: new Date().toISOString(), emailedTo: c.email }; window.__lastEmail = { name, saleId: body.saleId, bytes: body.pdfBase64.length, to: c.email }; return { data: { ok: true, to: c.email }, error: null } } },
  channel: () => ({ on() { return this }, subscribe() { return this } }),
  auth: {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange: (cb) => { authCb = cb; return { data: { subscription: { unsubscribe() {} } } } },
    signInWithPassword: async ({ email }) => ({ data: { user: { id: 'u1', email } }, error: null }),
    signOut: async () => authCb('SIGNED_OUT'),
    signUp: async () => ({ data: {}, error: null }),
    resetPasswordForEmail: async () => ({ error: null }),
    updateUser: async () => ({ data: { user: { id: 'u1' } }, error: null }),
  },
}
window.__mockdb = db
