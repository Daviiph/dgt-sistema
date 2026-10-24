// Fechas de ventas y rangos de períodos (sin dependencias: se prueba con node --test)
// Venezuela no tiene horario de verano: Caracas = UTC-4 todo el año.
const CARACAS_OFFSET_H = 4
export const DAY = 864e5

// Fecha de texto de una venta → instante real. El texto se interpreta como hora de Caracas,
// sin importar la zona horaria del equipo que la lee.
// Acepta "14/10/2026, 1:30:53 a.m.", "20/10/2026, 21:00:28", "10/15/2026, 7:06:38 PM".
export function parseSaleDate(text) {
  const s = String(text || '')
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s*(m)?)?/i.exec(s)
  if (!m) return null
  const [, a, b, y, hh = '0', mm = '0', ss = '0', ap] = m
  const english = /\b[AP]M\b/.test(s)
  let day = +a, month = +b
  if (english || (+a <= 12 && +b > 12)) { day = +b; month = +a }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  let h = +hh
  if (ap) { const pm = ap.toLowerCase() === 'p'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0 }
  const d = new Date(Date.UTC(+y, month - 1, day, h + CARACAS_OFFSET_H, +mm, +ss))
  return isNaN(d) ? null : d
}

// Momento de una venta. La hora de la nube (createdAt) es la fiable: no depende del reloj ni
// de la zona del equipo. Solo si la venta se hizo SIN conexión y llegó a la nube más de 2 h
// después, vale la hora escrita (que entonces es anterior a la de la nube).
export function saleTime(s) {
  const created = s && s.createdAt ? new Date(s.createdAt) : null
  const written = parseSaleDate(s && s.date)
  const okCreated = created && !isNaN(created)
  if (okCreated && written && created - written > 2 * 3600e3) return written
  if (okCreated) return created
  return written
}

// Texto fijo para guardar en la venta: "dd/mm/aaaa, HH:MM:SS" en hora de Caracas (24 h)
export function stampCaracas(d = new Date()) {
  const t = new Date(d.getTime() - CARACAS_OFFSET_H * 3600e3)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}, ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`
}

// ---- Rangos [from, to) en hora local del equipo ----
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1)

export const PRESETS = [
  { k: 'hoy', t: 'Hoy' },
  { k: '7', t: '7 días' },
  { k: '30', t: '30 días' },
  { k: 'mes', t: 'Este mes' },
  { k: 'mespasado', t: 'Mes pasado' },
  { k: 'todo', t: 'Todo' },
]

export function presetRange(k, times = [], now = new Date()) {
  const start = startOfDay(now), end = addDays(start, 1)
  let r
  if (k === 'hoy') r = { from: start, to: end }
  else if (k === '7' || k === '30') r = { from: addDays(start, -(+k - 1)), to: end }
  else if (k === 'mes') r = { from: new Date(now.getFullYear(), now.getMonth(), 1), to: end }
  else if (k === 'mespasado') r = { from: addMonths(now, -1), to: addMonths(now, 0) }
  else {
    const ts = times.filter(Boolean).map(Number)
    r = { from: ts.length ? startOfDay(new Date(Math.min(...ts))) : start, to: end }
    r.all = true
  }
  r.key = k
  return r
}

// Del día a al día b, ambos incluidos (en cualquier orden)
export function customRange(a, b) {
  let from = startOfDay(a), last = startOfDay(b)
  if (last < from) [from, last] = [last, from]
  return { from, to: addDays(last, 1), key: 'custom' }
}

const isFirst = (d) => d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() === 0
function wholeMonths(r) {
  if (!isFirst(r.from) || !isFirst(r.to)) return 0
  return (r.to.getFullYear() - r.from.getFullYear()) * 12 + r.to.getMonth() - r.from.getMonth()
}

// Período con el que se compara (para el "▲ 12 %")
export function previousRange(r) {
  if (r.all) return null
  const n = wholeMonths(r)
  if (n > 0) return { from: addMonths(r.from, -n), to: new Date(r.from) }
  const days = Math.round((r.to - r.from) / DAY)
  if (r.from.getDate() === 1) {
    // Mes en curso: mismos días del mes anterior (1 al N)
    const f = addMonths(r.from, -1)
    return { from: f, to: addDays(f, days) }
  }
  return { from: addDays(r.from, -days), to: new Date(r.from) }
}

export const inRange = (t, r) => !!t && t >= r.from && t < r.to

const dayLabel = (d) => d.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' }).replace('.', '')

// Cubetas para las gráficas: por hora (1 día), por día (≤ 62 días) o por mes
export function buckets(r) {
  const out = []
  const days = Math.round((r.to - r.from) / DAY)
  if (days <= 1) {
    for (let h = 0; h < 24; h++) {
      const f = new Date(r.from); f.setHours(h); const t = new Date(f); t.setHours(h + 1)
      out.push({ from: f, to: t, label: `${h}h`, title: `${dayLabel(f)} de ${h}:00 a ${h + 1}:00`, unit: 'hora' })
    }
    return out
  }
  if (days <= 62) {
    for (let i = 0; i < days; i++) {
      const f = addDays(r.from, i), t = addDays(f, 1)
      out.push({ from: f, to: t, label: dayLabel(f), title: f.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' }), unit: 'día' })
    }
    return out
  }
  let f = new Date(r.from.getFullYear(), r.from.getMonth(), 1)
  while (f < r.to) {
    const t = addMonths(f, 1)
    out.push({ from: f < r.from ? new Date(r.from) : f, to: t > r.to ? new Date(r.to) : t, label: f.toLocaleDateString('es-VE', { month: 'short', year: '2-digit' }).replace('.', ''), title: f.toLocaleDateString('es-VE', { month: 'long', year: 'numeric' }), unit: 'mes' })
    f = t
  }
  return out
}

// "1 sep – 30 oct 2026" / "23 oct 2026"
export function rangeLabel(r) {
  const last = addDays(r.to, -1)
  const full = (d) => d.toLocaleDateString('es-VE', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '')
  if (+startOfDay(last) === +r.from) return full(r.from)
  const sameYear = r.from.getFullYear() === last.getFullYear()
  const a = sameYear ? r.from.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' }).replace(/\./g, '') : full(r.from)
  return `${a} – ${full(last)}`
}
