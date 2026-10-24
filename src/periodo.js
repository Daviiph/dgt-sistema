// Selector de período: botones rápidos + "Personalizado" con calendario de rango (cruza meses)
import { PRESETS, presetRange, customRange, rangeLabel } from './fechas.js'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fromYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d) }
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Estado guardado: { k: 'mes' } o { k: 'custom', a: 'aaaa-mm-dd', b: 'aaaa-mm-dd' }
export function loadPeriod(storeKey, fallback = '30') {
  try {
    const raw = localStorage.getItem(storeKey)
    if (!raw) return { k: fallback }
    if (raw[0] !== '{') return { k: raw } // formato viejo: solo la clave
    const st = JSON.parse(raw)
    if (st.k === 'custom' && !(st.a && st.b)) return { k: fallback }
    return st
  } catch { return { k: fallback } }
}
export function savePeriod(storeKey, st) { try { localStorage.setItem(storeKey, JSON.stringify(st)) } catch {} }

export function rangeOf(st, times = [], now = new Date()) {
  if (st.k === 'custom') return customRange(fromYmd(st.a), fromYmd(st.b))
  return presetRange(st.k, times, now)
}

export function periodTitle(st, r) {
  if (st.k === 'custom') return rangeLabel(r)
  return { hoy: 'Hoy', 7: 'Últimos 7 días', 30: 'Últimos 30 días', mes: 'Este mes', mespasado: 'Mes pasado', todo: 'Todo el historial' }[st.k] || rangeLabel(r)
}

// Píldora "Este mes ▾" que abre un menú con los períodos y "Personalizado…" (calendario).
// onChange(nuevoEstado) cuando el usuario elige.
let menuOpen = null
export function mountPeriod(el, { state, range, onChange }) {
  if (!el) return
  el.classList.add('period')
  const custom = state.k === 'custom'
  const label = custom ? rangeLabel(range) : (PRESETS.find((p) => p.k === state.k) || {}).t || 'Período'
  el.innerHTML = `<button type="button" class="period-pill" aria-haspopup="menu" aria-expanded="false">
      <i class="fas fa-calendar-days"></i><span>${esc(label)}</span><i class="fas fa-chevron-down period-chev"></i></button>`
  const btn = el.querySelector('.period-pill')
  btn.title = rangeLabel(range)
  btn.onclick = (e) => {
    e.stopPropagation()
    if (menuOpen && menuOpen.btn === btn) return closeMenu()
    closeMenu()
    const m = document.createElement('div')
    m.className = 'period-menu'
    m.setAttribute('role', 'menu')
    m.innerHTML = PRESETS.map((p) => `<button type="button" role="menuitemradio" aria-checked="${state.k === p.k}" data-p="${p.k}" class="${state.k === p.k ? 'on' : ''}">${p.t}<i class="fas fa-check"></i></button>`).join('') +
      `<div class="period-sep"></div><button type="button" role="menuitemradio" aria-checked="${custom}" data-custom class="${custom ? 'on' : ''}"><span><i class="fas fa-calendar-days"></i> Personalizado…</span>${custom ? `<small>${esc(rangeLabel(range))}</small>` : ''}</button>`
    document.body.appendChild(m)
    const r = btn.getBoundingClientRect()
    const w = Math.max(220, r.width)
    m.style.minWidth = w + 'px'
    const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8)
    m.style.left = left + 'px'
    m.style.top = (r.bottom + 8) + 'px'
    btn.setAttribute('aria-expanded', 'true')
    requestAnimationFrame(() => m.classList.add('in'))
    m.addEventListener('click', (ev) => {
      const t = ev.target.closest('button')
      if (!t) return
      closeMenu()
      if (t.dataset.p) return onChange({ k: t.dataset.p })
      openRangePicker({ anchor: btn, from: range.from, to: new Date(range.to.getTime() - 1), onApply: (a, b) => onChange({ k: 'custom', a: ymd(a), b: ymd(b) }) })
    })
    menuOpen = { m, btn }
    m.querySelector('.on, button')?.focus()
  }
}
function closeMenu() {
  if (!menuOpen) return
  const { m, btn } = menuOpen
  menuOpen = null
  btn.setAttribute('aria-expanded', 'false')
  m.remove()
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => { if (menuOpen && !menuOpen.m.contains(e.target)) closeMenu() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen) { const b = menuOpen.btn; closeMenu(); b.focus() } })
  window.addEventListener('resize', closeMenu)
  document.addEventListener('scroll', closeMenu, true)
}

// ---- Calendario ----
let open = null
export function openRangePicker({ anchor, from, to, onApply }) {
  if (open) open.close()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const twoUp = () => window.matchMedia('(min-width: 720px)').matches
  let a = from ? new Date(from) : null, b = to ? new Date(to) : null
  if (a) a.setHours(0, 0, 0, 0)
  if (b) b.setHours(0, 0, 0, 0)
  let hover = null, picking = false
  // Mes que se ve a la izquierda: el del final del rango (si caben dos, el anterior a él)
  let view = new Date((b || today).getFullYear(), (b || today).getMonth(), 1)
  if (twoUp()) view.setMonth(view.getMonth() - 1)

  const back = document.createElement('div')
  back.className = 'rp-back'
  const box = document.createElement('div')
  box.className = 'rp'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-modal', 'true')
  box.setAttribute('aria-label', 'Elegir rango de fechas')
  back.appendChild(box)
  document.body.appendChild(back)
  const prevFocus = document.activeElement

  const QUICK = [
    ['Hoy', () => [today, today]],
    ['Ayer', () => { const y = new Date(today); y.setDate(y.getDate() - 1); return [y, y] }],
    ['Esta semana', () => { const f = new Date(today); f.setDate(f.getDate() - ((f.getDay() + 6) % 7)); return [f, today] }],
    ['Este mes', () => [new Date(today.getFullYear(), today.getMonth(), 1), today]],
    ['Mes pasado', () => [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)]],
    ['Últimos 2 meses', () => [new Date(today.getFullYear(), today.getMonth() - 1, 1), today]],
    ['Últimos 3 meses', () => [new Date(today.getFullYear(), today.getMonth() - 2, 1), today]],
    ['Este año', () => [new Date(today.getFullYear(), 0, 1), today]],
  ]

  const lo = () => { const e = picking && hover ? hover : b; if (!a) return null; return e && e < a ? e : a }
  const hi = () => { const e = picking && hover ? hover : b; if (!a) return null; return e && e > a ? e : (e ? a : a) }

  function monthHtml(m) {
    const first = new Date(m.getFullYear(), m.getMonth(), 1)
    const pad = (first.getDay() + 6) % 7
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
    const L = lo(), H = hi()
    let cells = ''
    for (let i = 0; i < pad; i++) cells += '<span></span>'
    for (let d = 1; d <= days; d++) {
      const day = new Date(m.getFullYear(), m.getMonth(), d)
      const isL = sameDay(day, L), isH = sameDay(day, H)
      const inside = L && H && day > L && day < H
      const cls = ['rp-day', isL && 'is-start', isH && 'is-end', inside && 'is-in', sameDay(day, today) && 'is-today', day > today && 'is-future', L && H && !sameDay(L, H) && (isL || isH) && 'has-band'].filter(Boolean).join(' ')
      const label = day.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      cells += `<button type="button" class="${cls}" data-d="${ymd(day)}" aria-label="${label}" aria-pressed="${isL || isH}"><span>${d}</span></button>`
    }
    return `<div class="rp-month"><p class="rp-mname">${MESES[m.getMonth()]} <span>${m.getFullYear()}</span></p>
      <div class="rp-grid rp-dow">${DIAS.map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="rp-grid">${cells}</div></div>`
  }

  function summary() {
    const L = lo(), H = hi()
    if (!L) return '<span class="rp-hint">Toca el día de inicio</span>'
    const f = (d) => d.toLocaleDateString('es-VE', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '')
    const n = Math.round((H - L) / 864e5) + 1
    if (picking) return `<b>${f(L)}</b> <span class="rp-hint">→ toca el día final</span>`
    return `<b>${f(L)}</b> <i class="fas fa-arrow-right"></i> <b>${f(H)}</b> <span class="rp-n">${n} día${n === 1 ? '' : 's'}</span>`
  }

  function render() {
    const months = twoUp() ? [view, new Date(view.getFullYear(), view.getMonth() + 1, 1)] : [view]
    box.innerHTML = `
      <div class="rp-head">
        <p class="rp-title">Elegir fechas</p>
        <button type="button" class="rp-x" data-act="close" aria-label="Cerrar"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="rp-quick">${QUICK.map(([t], i) => `<button type="button" data-q="${i}">${t}</button>`).join('')}</div>
      <div class="rp-body">
        <button type="button" class="rp-nav" data-act="prev" aria-label="Mes anterior"><i class="fas fa-chevron-left"></i></button>
        <div class="rp-months">${months.map(monthHtml).join('')}</div>
        <button type="button" class="rp-nav" data-act="next" aria-label="Mes siguiente"><i class="fas fa-chevron-right"></i></button>
      </div>
      <div class="rp-foot">
        <p class="rp-sum" aria-live="polite">${summary()}</p>
        <div class="rp-btns">
          <button type="button" class="rp-btn" data-act="close">Cancelar</button>
          <button type="button" class="rp-btn rp-ok" data-act="ok" ${a && !picking ? '' : 'disabled'}>Aplicar</button>
        </div>
      </div>`
  }

  function close() {
    document.removeEventListener('keydown', onKey)
    back.classList.add('out')
    setTimeout(() => back.remove(), 160)
    open = null
    if (prevFocus && prevFocus.focus) prevFocus.focus()
  }
  function onKey(e) { if (e.key === 'Escape') close() }

  box.addEventListener('click', (e) => {
    const t = e.target.closest('button')
    if (!t) return
    const act = t.dataset.act
    if (act === 'close') return close()
    if (act === 'prev') { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); return render() }
    if (act === 'next') { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); return render() }
    if (act === 'ok') { if (a) { onApply(lo(), hi() || lo()); close() } return }
    if (t.dataset.q != null) {
      const [x, y] = QUICK[+t.dataset.q][1]()
      a = x; b = y; picking = false
      view = new Date(y.getFullYear(), y.getMonth(), 1)
      if (twoUp()) view.setMonth(view.getMonth() - 1)
      return render()
    }
    if (t.dataset.d) {
      const d = fromYmd(t.dataset.d)
      if (!picking) { a = d; b = null; picking = true; hover = d }
      else { b = d; picking = false; if (b < a) [a, b] = [b, a] }
      render()
      const again = box.querySelector(`[data-d="${t.dataset.d}"]`)
      if (again) again.focus()
    }
  })
  box.addEventListener('pointerover', (e) => {
    if (!picking) return
    const t = e.target.closest('[data-d]')
    if (!t) return
    const d = fromYmd(t.dataset.d)
    if (sameDay(d, hover)) return
    hover = d
    // Solo repinta las marcas (no todo el calendario) para que el puntero no pierda el botón
    const L = lo(), H = hi()
    box.querySelectorAll('[data-d]').forEach((btn) => {
      const day = fromYmd(btn.dataset.d)
      const isL = sameDay(day, L), isH = sameDay(day, H)
      btn.classList.toggle('is-start', isL)
      btn.classList.toggle('is-end', isH)
      btn.classList.toggle('is-in', day > L && day < H)
      btn.classList.toggle('has-band', !sameDay(L, H) && (isL || isH))
    })
    box.querySelector('.rp-sum').innerHTML = summary()
  })
  back.addEventListener('click', (e) => { if (e.target === back) close() })
  document.addEventListener('keydown', onKey)

  render()
  open = { close }
  requestAnimationFrame(() => { back.classList.add('in'); (box.querySelector('.is-start') || box.querySelector('.rp-day'))?.focus() })
  return open
}
