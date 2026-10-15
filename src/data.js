import { supabase } from './supabase.js'

// Tabla en la nube -> columnas reales. Claves que no estén aquí se guardan en `extra`.
const TABLES = {
  brands: { table: 'brands', cols: ['id', 'name'] },
  products: { table: 'products', cols: ['id', 'brand_id', 'name', 'category', 'color', 'price', 'stock'] },
  customers: { table: 'customers', cols: ['id', 'name', 'cedula', 'rif', 'email', 'phone', 'total_spent'] },
  sellers: { table: 'sellers', cols: ['id', 'name', 'comm'] },
  payments: { table: 'payment_methods', cols: ['id', 'name'] },
  resale: { table: 'resale_items', cols: ['id', 'brand', 'name', 'color', 'serial', 'supplier', 'cost', 'price', 'stock', 'notes', 'acquired_at'] },
}
const SALE_COLS = ['id', 'date', 'customer_id', 'seller_id', 'rate', 'rate_type', 'doc_type', 'main_currency', 'payments', 'items', 'total', 'status', 'cancel_reason', 'cancel_date', 'channel', 'cost_total']
const TEXT_COLS = new Set(['brand_id', 'customer_id', 'seller_id', 'date', 'cancel_date', 'acquired_at'])
const META_COLS = new Set(['extra', 'updated_at', 'created_at', 'created_by', 'cancelled_by'])

const toSnake = (k) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
const toCamel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

// Evita inyección de HTML: la interfaz pinta datos con innerHTML
const UNSAFE = { '<': '‹', '>': '›', '"': '”' }
export function clean(v) {
  if (typeof v === 'string') return v.replace(/[<>"]/g, (c) => UNSAFE[c])
  if (Array.isArray(v)) return v.map(clean)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]))
  return v
}

function toRow(obj, cols) {
  const row = { extra: {} }
  for (const [k, v] of Object.entries(clean(obj))) {
    const sk = toSnake(k)
    if (cols.includes(sk)) row[sk] = TEXT_COLS.has(sk) && v != null ? String(v) : v
    else row.extra[k] = v
  }
  return row
}

function fromRow(row) {
  const obj = {}
  for (const [k, v] of Object.entries(row)) {
    if (META_COLS.has(k)) continue
    obj[toCamel(k)] = typeof v === 'string' && /^(price|stock|comm|rate|total|total_spent|cost|cost_total)$/.test(k) ? Number(v) : v
  }
  return clean({ ...(row.extra || {}), ...obj })
}

function check({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

let snapshot = {}

export async function fetchAll() {
  const [settings, ...rest] = await Promise.all([
    supabase.from('settings').select('*'),
    ...Object.values(TABLES).map((t) => supabase.from(t.table).select('*').order('id')),
    supabase.from('sales').select('*').order('created_at'),
  ])
  const out = { resaleReady: true }
  Object.keys(TABLES).forEach((name, i) => {
    // Si la tabla de reventa aún no existe en la nube, el resto del sistema sigue funcionando
    if (name === 'resale' && rest[i].error) {
      out.resaleReady = false
      out[name] = []
      snapshot[name] = new Map()
      return
    }
    out[name] = check(rest[i]).map(fromRow)
    snapshot[name] = new Map(out[name].map((o) => [String(o.id), JSON.stringify(o)]))
  })
  out.sales = check(rest[rest.length - 1]).map((row) => ({ channel: 'tienda', ...fromRow(row), createdAt: row.created_at }))
  const s = Object.fromEntries(check(settings).map((r) => [r.key, r.value]))
  out.appCurrency = s.currency || '$'
  out.globalRate = s.rate || '36.50'
  out.bcvRate = s.rate_bcv || out.globalRate
  out.binanceRate = s.rate_binance || out.globalRate
  out.rateDate = s.rate_date || ''
  out.brandColor = s.brand_color || ''
  out.brandLogo = s.brand_logo || ''
  resaleReady = out.resaleReady
  return out
}

// Compara los arreglos con la última versión de la nube y envía sólo los cambios
let resaleReady = true
export async function syncTables(state) {
  for (const [name, def] of Object.entries(TABLES)) {
    if (name === 'resale' && !resaleReady) continue
    const prev = snapshot[name] || new Map()
    const current = new Map((state[name] || []).map((o) => [String(o.id), o]))
    const upserts = []
    for (const [id, o] of current) if (prev.get(id) !== JSON.stringify(o)) upserts.push(toRow(o, def.cols))
    const deletes = [...prev.keys()].filter((id) => !current.has(id))
    if (upserts.length) check(await supabase.from(def.table).upsert(upserts))
    if (deletes.length) check(await supabase.from(def.table).delete().in('id', deletes))
    snapshot[name] = new Map([...current].map(([id, o]) => [id, JSON.stringify(o)]))
  }
}

export async function saveSetting(key, value) {
  check(await supabase.from('settings').upsert({ key, value: String(value) }))
}

export async function createSale(sale) {
  return fromRow(check(await supabase.rpc('create_sale', { p: clean(sale) })))
}
export async function cancelSale(id, reason) {
  return fromRow(check(await supabase.rpc('cancel_sale', { p_id: id, p_reason: reason })))
}
export async function deleteSaleRemote(id) {
  check(await supabase.rpc('delete_sale', { p_id: id }))
}

export async function importAll(data) {
  for (const [name, def] of Object.entries(TABLES)) {
    const rows = (data[name] || []).map((o) => toRow(o, def.cols))
    if (rows.length) check(await supabase.from(def.table).upsert(rows))
  }
  const sales = (data.sales || []).map((s) => {
    const { createdAt, ...sale } = s
    const r = toRow({ status: 'activa', channel: 'tienda', ...sale }, SALE_COLS)
    if (r.status !== 'cancelada') r.status = 'activa'
    return r
  })
  for (let i = 0; i < sales.length; i += 500) check(await supabase.from('sales').upsert(sales.slice(i, i + 500)))
  await saveSetting('currency', data.appCurrency || '$')
  await saveSetting('rate', data.globalRate || '36.50')
  await saveSetting('rate_bcv', data.bcvRate || data.globalRate || '36.50')
  await saveSetting('rate_binance', data.binanceRate || data.globalRate || '36.50')
  if (data.rateDate) await saveSetting('rate_date', data.rateDate)
}

export async function listProfiles() {
  return check(await supabase.from('profiles').select('*').order('created_at'))
}
export async function updateProfile(id, patch) {
  check(await supabase.from('profiles').update(patch).eq('id', id))
}
export async function listAudit(limit = 100) {
  return check(await supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(limit))
}

export function subscribeChanges(onChange) {
  let timer
  return supabase
    .channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, () => {
      clearTimeout(timer)
      timer = setTimeout(onChange, 600)
    })
    .subscribe()
}
