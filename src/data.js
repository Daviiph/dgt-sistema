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

// Interpreta la fecha de texto de una venta ("13/10/2026, 10:32:34 p. m." o "10/15/2026, 7:06:38 PM")
export function parseSaleDate(text) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s*(m)?)?/i.exec(String(text || ''))
  if (!m) return null
  let [, a, b, y, hh = '0', mm = '0', ss = '0', ap] = m
  const english = /\b[AP]M\b/.test(text)
  let day = +a, month = +b
  if (english || (+a <= 12 && +b > 12)) { day = +b; month = +a }
  let h = +hh
  if (ap) { const pm = ap.toLowerCase() === 'p'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0 }
  const d = new Date(+y, month - 1, day, h, +mm, +ss)
  return isNaN(d) || month > 12 ? null : d
}

function check({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

let snapshot = {}

// ===== MODO SIN CONEXIÓN =====
// Copia local de los datos + cola de cambios pendientes que se envían solos al volver internet.
const LS = { server: 'ns_off_server', local: 'ns_off_local', snap: 'ns_off_snap', outbox: 'ns_off_outbox', dirty: 'ns_off_dirty' }
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true } catch (e) { console.warn('No se pudo guardar copia local', e); return false } },
  del(k) { try { localStorage.removeItem(k) } catch { /* sin almacenamiento */ } },
}
export const isNetError = (e) => !navigator.onLine || /Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed|ERR_INTERNET|ERR_NETWORK|timed? ?out/i.test(String((e && e.message) || e))

const net = { offline: typeof navigator !== 'undefined' && !navigator.onLine, syncing: false }
const listeners = new Set()
const outbox = () => store.get(LS.outbox, [])
const saveOutbox = (box) => store.set(LS.outbox, box)
export function pendingCount() { return outbox().length + (store.get(LS.dirty, false) ? 1 : 0) }
export function netState() { return { offline: net.offline, syncing: net.syncing, pending: pendingCount() } }
function emit() { const st = netState(); listeners.forEach((cb) => { try { cb(st) } catch (e) { console.error(e) } }) }
export function onNetChange(cb) { listeners.add(cb); cb(netState()); return () => listeners.delete(cb) }
function setOffline(v) { if (net.offline !== v) { net.offline = v; emit() } }
const isOffline = () => net.offline || !navigator.onLine

// Unidades vendidas sin conexión que la nube todavía no ha descontado
function pendingStock() {
  const out = {}
  for (const op of outbox()) if (op.kind === 'sale') {
    const table = op.sale.channel === 'reventa' ? 'resale' : 'products'
    for (const it of op.sale.items || []) out[`${table}:${it.id}`] = (out[`${table}:${it.id}`] || 0) + (Number(it.qty) || 0)
  }
  return out
}

const snapToObj = () => Object.fromEntries(Object.entries(snapshot).map(([k, m]) => [k, [...m]]))
const snapFromObj = (o) => { snapshot = Object.fromEntries(Object.entries(o || {}).map(([k, a]) => [k, new Map(a)])) }
const ARRAYS = ['brands', 'products', 'customers', 'sellers', 'payments', 'resale', 'sales']

// Guarda en el equipo el estado actual (sólo si hay algo sin enviar o no hay conexión)
export function persistLocal(state, force = false) {
  if (!force && !isOffline() && !pendingCount()) return
  store.set(LS.local, Object.fromEntries(ARRAYS.map((k) => [k, state[k] || []])))
}

function loadCached() {
  const server = store.get(LS.server, null)
  if (!server) throw new Error('No hay conexión a internet y este equipo aún no tiene una copia de los datos. Conéctese una vez para descargarlos.')
  snapFromObj(store.get(LS.snap, {}))
  const local = store.get(LS.local, null)
  let logo = ''
  try { logo = localStorage.getItem('ns_brand_logo') || '' } catch { /* sin almacenamiento */ }
  return { ...server, ...(local || {}), brandLogo: logo, offline: true }
}

export async function fetchAll() {
  if (navigator.onLine && pendingCount()) { try { await flushOutbox() } catch (e) { console.warn(e) } }
  try {
    const out = await fetchRemote()
    setOffline(false)
    const local = store.get(LS.local, null)
    if (pendingCount() && local) return { ...out, ...local }
    const { brandLogo, ...slim } = out
    store.set(LS.server, slim)
    store.set(LS.snap, snapToObj())
    store.del(LS.local)
    return out
  } catch (e) {
    if (!isNetError(e)) throw e
    setOffline(true)
    return loadCached()
  }
}

export async function syncTables(state) {
  if (isOffline()) { store.set(LS.dirty, true); persistLocal(state, true); emit(); return }
  try { await syncRemote(state) } catch (e) {
    if (!isNetError(e)) throw e
    setOffline(true); store.set(LS.dirty, true); persistLocal(state, true); emit()
  }
}

export async function saveSetting(key, value) {
  const queue = () => { const box = outbox().filter((op) => !(op.kind === 'setting' && op.key === key)); box.push({ kind: 'setting', key, value: String(value) }); saveOutbox(box); emit() }
  if (isOffline()) return queue()
  try { check(await supabase.from('settings').upsert({ key, value: String(value) })) } catch (e) {
    if (!isNetError(e)) throw e
    setOffline(true); queue()
  }
}

export async function createSale(sale) {
  const queue = () => { const box = outbox(); box.push({ kind: 'sale', sale: clean(sale), at: Date.now() }); saveOutbox(box); emit(); return { ...sale, offline: true } }
  if (isOffline()) return queue()
  try { return fromRow(check(await supabase.rpc('create_sale', { p: clean(sale) }))) } catch (e) {
    if (!isNetError(e)) throw e
    setOffline(true); return queue()
  }
}

const needOnline = () => { if (isOffline()) throw new Error('Necesita conexión a internet para hacer esto.') }

let flushing = null
export function flushOutbox() {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null })
  return flushing
}
async function doFlush() {
  const result = { done: 0, conflicts: [] }
  if (!navigator.onLine || !pendingCount()) return result
  net.syncing = true; emit()
  try {
    // 1) Catálogo (productos, clientes, equipos…) con el stock ajustado por las ventas pendientes
    if (store.get(LS.dirty, false)) {
      const local = store.get(LS.local, null)
      if (local) await syncRemote(local)
      store.del(LS.dirty); result.done++
    }
    // 2) Ventas y ajustes, en el orden en que se hicieron
    let box = outbox()
    while (box.length) {
      const op = box[0]
      try {
        if (op.kind === 'sale') check(await supabase.rpc('create_sale', { p: op.sale }))
        else if (op.kind === 'setting') check(await supabase.from('settings').upsert({ key: op.key, value: op.value }))
        result.done++
      } catch (e) {
        if (isNetError(e)) throw e
        if (!(op.kind === 'sale' && /duplicate key|already exists/i.test(e.message))) result.conflicts.push({ op, error: e.message })
      }
      box.shift(); saveOutbox(box)
    }
    store.del(LS.local)
    setOffline(false)
  } catch (e) {
    if (isNetError(e)) setOffline(true); else throw e
  } finally {
    net.syncing = false; emit()
  }
  return result
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => setOffline(true))
  window.addEventListener('online', () => setOffline(false))
}


let logoCache = { at: null, value: '' }
async function getLogo(at) {
  if (logoCache.at === at && logoCache.at !== null) return logoCache.value
  const { data } = await supabase.from('settings').select('value').eq('key', 'brand_logo').maybeSingle()
  logoCache = { at, value: (data && data.value) || '' }
  return logoCache.value
}

async function fetchRemote() {
  const [settings, ...rest] = await Promise.all([
    supabase.from('settings').select('key,value').neq('key', 'brand_logo'),
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
  out.brandLogo = await getLogo(s.brand_logo_at || '')
  out.autoEmail = s.invoice_email_auto !== '0'
  resaleReady = out.resaleReady
  return out
}

// Compara los arreglos con la última versión de la nube y envía sólo los cambios
let resaleReady = true
async function syncRemote(state) {
  const pend = pendingStock()
  for (const [name, def] of Object.entries(TABLES)) {
    if (name === 'resale' && !resaleReady) continue
    const prev = snapshot[name] || new Map()
    const current = new Map((state[name] || []).map((o) => [String(o.id), o]))
    const upserts = []
    const next = new Map()
    for (const [id, o] of current) {
      const add = pend[`${name}:${id}`] || 0
      const eff = add ? { ...o, stock: (Number(o.stock) || 0) + add } : o
      const js = JSON.stringify(eff)
      next.set(id, js)
      if (prev.get(id) !== js) upserts.push(toRow(eff, def.cols))
    }
    const deletes = [...prev.keys()].filter((id) => !current.has(id))
    if (upserts.length) check(await supabase.from(def.table).upsert(upserts))
    if (deletes.length) check(await supabase.from(def.table).delete().in('id', deletes))
    snapshot[name] = next
  }
}

export async function cancelSale(id, reason) {
  needOnline()
  return fromRow(check(await supabase.rpc('cancel_sale', { p_id: id, p_reason: reason })))
}
export async function deleteSaleRemote(id) {
  needOnline()
  check(await supabase.rpc('delete_sale', { p_id: id }))
}

export async function importAll(data, opts = {}) {
  needOnline()
  for (const [name, def] of Object.entries(TABLES)) {
    const rows = (data[name] || []).map((o) => toRow(o, def.cols))
    if (rows.length) check(await supabase.from(def.table).upsert(rows))
  }
  const sales = (data.sales || []).map((s) => {
    const { createdAt, ...sale } = s
    const r = toRow({ status: 'activa', channel: 'tienda', ...sale }, SALE_COLS)
    if (r.status !== 'cancelada') r.status = 'activa'
    const when = createdAt ? new Date(createdAt) : parseSaleDate(sale.date)
    if (when && !isNaN(when)) r.created_at = when.toISOString()
    return r
  })
  for (let i = 0; i < sales.length; i += 500) check(await supabase.from('sales').upsert(sales.slice(i, i + 500)))
  if (opts.settings === false) return
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
      timer = setTimeout(onChange, 1500)
    })
    .subscribe()
}

// Envía la factura en PDF al correo del cliente (función "enviar-factura" en Supabase)
export async function sendInvoiceEmail(saleId, pdfBase64) {
  const { data, error } = await supabase.functions.invoke('enviar-factura', { body: { saleId, pdfBase64 } })
  if (error) {
    let msg = error.message
    try { const b = await error.context.json(); if (b && b.error) msg = b.error } catch { /* sin detalle */ }
    if (/Failed to send|not found|404/i.test(msg)) msg = 'el servicio de correo aún no está activado'
    throw new Error(msg)
  }
  if (data && data.error) throw new Error(data.error)
  return data
}

// Asistente de precios con IA (función "asistente-precios" en Supabase)
export async function askPriceAssistant(item) {
  const { data, error } = await supabase.functions.invoke('asistente-precios', { body: item })
  if (error) {
    let msg = error.message
    try { const b = await error.context.json(); if (b && b.error) msg = b.error } catch { /* sin detalle */ }
    if (/Failed to send|not found|404/i.test(msg)) msg = 'El asistente de IA aún no está activado.'
    throw new Error(msg)
  }
  if (data && data.error) throw new Error(data.error)
  return data
}
