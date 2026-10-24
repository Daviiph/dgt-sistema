// Gráficas en SVG (sin librerías) con capa interactiva: guía vertical, tooltip, teclado y clic/toque.
let uid = 0
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function smoothPath(pts, floor = Infinity) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(floor, p1[1] + (p2[1] - p0[1]) / 6)]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(floor, p2[1] - (p3[1] - p1[1]) / 6)]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

const niceMax = (v) => {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

function tooltipEl(host) {
  let tip = host.querySelector(':scope > .chart-tip')
  if (!tip) {
    tip = document.createElement('div')
    tip.className = 'chart-tip'
    tip.setAttribute('role', 'status')
    host.appendChild(tip)
  }
  return tip
}

function placeTip(host, tip, x, y) {
  const hw = host.clientWidth, tw = tip.offsetWidth
  let left = x + 14
  if (left + tw > hw - 4) left = x - tw - 14
  tip.style.left = Math.max(4, left) + 'px'
  tip.style.top = Math.max(0, y - tip.offsetHeight / 2) + 'px'
}

// Observa el ancho del contenedor para dibujar a tamaño real (el texto no se deforma)
function onResize(host, draw) {
  if (host._ro) host._ro.disconnect()
  let last = 0
  host._ro = new ResizeObserver(() => {
    const w = Math.round(host.clientWidth)
    if (w && w !== last) { last = w; draw(w) }
  })
  host._ro.observe(host)
}

/**
 * Área/línea interactiva.
 * opts: { labels[], series:[{name, values[], color:'r g b'}], format(v), height, onSelect(i), hint }
 */
export function mountAreaChart(host, opts) {
  const { labels, series, format = (v) => v, onSelect, onRange } = opts
  const tipFormat = opts.tipFormat || format
  host.classList.add('chart-host')
  host.tabIndex = 0
  host.setAttribute('role', 'img')
  host.setAttribute('aria-label', opts.ariaLabel || 'Gráfica')
  const n = labels.length
  let active = -1

  function draw(W) {
    const id = 'ac' + uid++
    const H = opts.height || (window.innerWidth >= 1280 ? 300 : 220), L = 48, R = 14, T = 16, B = 28
    const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)))
    const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1))
    const y = (v) => T + (H - T - B) * (1 - v / max)
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const yy = y(max * f)
      return `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="currentColor" stroke-opacity="${f === 0 ? 0.16 : 0.06}"/>
        <text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".5">${esc(format(max * f))}</text>`
    }).join('')
    const maxLabels = Math.max(2, Math.floor((W - L - R) / 64))
    const step = Math.max(1, Math.ceil(n / maxLabels))
    const showX = (i) => i === n - 1 || (i % step === 0 && n - 1 - i >= Math.max(step, 2) * 0.85)
    const vgrid = labels.map((lb, i) => showX(i) && n > 1 ? `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${y(0)}" stroke="currentColor" stroke-opacity=".05"/>` : '').join('')
    const xl = labels.map((lb, i) => showX(i)
      ? `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" font-size="11" fill="currentColor" fill-opacity=".5">${esc(lb)}</text>` : '').join('')
    const paths = series.map((s, si) => {
      const pts = s.values.map((v, i) => [x(i), y(v)])
      const line = smoothPath(pts, y(0))
      const col = s.color || 'var(--brand-light)'
      const area = si === 0 && n > 1 ? `<path d="${line} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#${id}g${si})"/>` : ''
      return `<defs><linearGradient id="${id}g${si}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${col})" stop-opacity=".45"/><stop offset="1" stop-color="rgb(${col})" stop-opacity="0"/></linearGradient></defs>
        ${area}<path class="cx-line-path" d="${line}" fill="none" stroke="rgb(${col})" stroke-width="${s.flat ? 2 : 2.5}" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/>`
    }).join('')
    const dots = series.map((s, si) => `<circle class="cx-dot" data-s="${si}" r="5" fill="rgb(${s.color || 'var(--brand-light)'})" stroke="var(--card-bg)" stroke-width="2.5" opacity="0"/>`).join('')
    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible">
      <defs><filter id="${id}glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      ${grid}${vgrid}${xl}${paths}
      <line class="cx-line" y1="${T}" y2="${y(0)}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="3 3" opacity="0"/>
      ${dots}
      <rect class="cx-sel" y="${T}" height="${y(0) - T}" rx="6" fill="rgb(var(--brand))" fill-opacity=".1" stroke="rgb(var(--brand))" stroke-opacity=".35" stroke-dasharray="4 3" opacity="0"/>
      <rect class="cx-hit" x="${L - 10}" y="0" width="${W - L - R + 20}" height="${H}" fill="transparent" style="cursor:${onSelect ? 'pointer' : 'crosshair'};touch-action:pan-y"/>
    </svg>`
    const svg = host.querySelector('svg'), tip = tooltipEl(host)
    const show = (i) => {
      if (i < 0 || i >= n) return hide()
      active = i
      const cx = x(i)
      const line = svg.querySelector('.cx-line')
      line.setAttribute('x1', cx); line.setAttribute('x2', cx); line.setAttribute('opacity', 1)
      svg.querySelectorAll('.cx-dot').forEach((d) => { const s = series[d.dataset.s]; d.setAttribute('cx', cx); d.setAttribute('cy', y(s.values[i])); d.setAttribute('opacity', 1) })
      const extra = opts.detail ? opts.detail(i) : ''
      tip.innerHTML = `<p class="tip-label">${esc(labels[i])}</p>` + series.map((s) =>
        `<p class="tip-row"><span class="tip-key" style="background:rgb(${s.color || 'var(--brand-light)'})"></span><b>${esc(tipFormat(s.values[i]))}</b><span>${esc(s.name || '')}</span></p>`).join('') +
        (extra ? `<p class="tip-extra">${esc(extra)}</p>` : '') + (onSelect ? `<p class="tip-hint">${onRange && n > 2 ? 'Toque para ver las ventas · arrastre para elegir fechas' : 'Toque para ver las ventas'}</p>` : '')
      tip.classList.add('on')
      placeTip(host, tip, cx, y(Math.max(...series.map((s) => s.values[i]))))
    }
    const hide = () => { active = -1; svg.querySelector('.cx-line').setAttribute('opacity', 0); svg.querySelectorAll('.cx-dot').forEach((d) => d.setAttribute('opacity', 0)); tip.classList.remove('on') }
    const idxFromEvent = (e) => {
      const r = svg.getBoundingClientRect()
      const px = e.clientX - r.left
      return Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))))
    }
    const hit = svg.querySelector('.cx-hit')
    // Tocar = ver ventas de ese punto · arrastrar de lado = elegir un tramo de fechas (onRange)
    const sel = svg.querySelector('.cx-sel')
    let drag = null
    const paintSel = (a, b) => {
      const lo = Math.min(a, b), hi = Math.max(a, b), half = n > 1 ? (W - L - R) / (n - 1) / 2 : 0
      sel.setAttribute('x', x(lo) - half); sel.setAttribute('width', Math.max(2, x(hi) - x(lo) + half * 2)); sel.setAttribute('opacity', 1)
    }
    hit.addEventListener('pointerdown', (e) => {
      if (e.button) return
      drag = { i: idxFromEvent(e), j: idxFromEvent(e), x0: e.clientX, moved: false, id: e.pointerId }
    })
    hit.addEventListener('pointermove', (e) => {
      const i = idxFromEvent(e)
      if (drag && onRange && n > 2) {
        if (!drag.moved && Math.abs(e.clientX - drag.x0) > 8) { drag.moved = true; try { hit.setPointerCapture(drag.id) } catch {} }
        if (drag.moved) { drag.j = i; paintSel(drag.i, drag.j) }
      }
      show(i)
    })
    const endDrag = (e) => {
      if (!drag) return
      const d = drag; drag = null
      sel.setAttribute('opacity', 0)
      if (d.moved && d.i !== d.j) { onRange(Math.min(d.i, d.j), Math.max(d.i, d.j)); return }
      if (e.type === 'pointerup') { const i = idxFromEvent(e); show(i); onSelect && onSelect(i) }
    }
    hit.addEventListener('pointerup', endDrag)
    hit.addEventListener('pointercancel', () => { drag = null; sel.setAttribute('opacity', 0) })
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag) hide() })
    host.onkeydown = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(Math.max(0, Math.min(n - 1, (active < 0 ? n - 1 : active + (e.key === 'ArrowRight' ? 1 : -1))))) }
      if ((e.key === 'Enter' || e.key === ' ') && active >= 0 && onSelect) { e.preventDefault(); onSelect(active) }
      if (e.key === 'Escape') hide()
    }
    host.onblur = hide
  }
  onResize(host, draw)
  draw(Math.max(280, host.clientWidth || 600))
}

/**
 * Barras horizontales interactivas (ranking). Cada fila es un botón.
 * items: [{ label, value, sub, color }]
 */
export function mountRankBars(host, { items, format = (v) => v, onSelect, empty = 'Sin datos en este período' }) {
  if (!items.length) { host.innerHTML = `<p class="py-6 text-center text-sm opacity-60">${esc(empty)}</p>`; return }
  const max = Math.max(...items.map((i) => i.value), 1)
  const total = items.reduce((a, i) => a + i.value, 0) || 1
  host.innerHTML = items.map((it, k) => `
    <button type="button" data-k="${k}" class="rank-row group w-full text-left rounded-xl px-2 py-2 -mx-2 hover:bg-gray-50 dark:hover:bg-white/5">
      <span class="flex items-baseline justify-between gap-3 text-sm">
        <span class="truncate">${esc(it.label)}</span>
        <span class="shrink-0 tabular-nums font-semibold">${esc(format(it.value))} <span class="font-normal opacity-50 text-xs">${Math.round((it.value / total) * 100)}%</span></span>
      </span>
      <span class="mt-1.5 block h-2 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden"><span class="rank-fill block h-full rounded-full" style="width:${(it.value / max) * 100}%;background:${it.color || 'linear-gradient(90deg, rgb(var(--brand)), rgb(var(--brand-light)))'}"></span></span>
      ${it.sub ? `<span class="mt-1 block text-[11px] text-gray-400">${esc(it.sub)}</span>` : ''}
    </button>`).join('')
  host.querySelectorAll('.rank-row').forEach((b) => b.addEventListener('click', () => onSelect && onSelect(items[b.dataset.k], +b.dataset.k)))
}

// Indicador circular (0..1). Es un botón cuando tiene acción.
export function gauge(value, { size = 150, color = 'var(--brand-light)', label = '' } = {}) {
  const id = 'gg' + uid++
  const v = Math.max(0, Math.min(1, value || 0))
  const r = 52, c = 2 * Math.PI * r, arc = c * 0.75
  return `<svg viewBox="0 0 140 140" width="${size}" height="${size}" role="img" aria-label="${Math.round(v * 100)}% ${esc(label)}">
    <defs><linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="rgb(var(--brand))"/><stop offset="1" stop-color="rgb(${color})"/></linearGradient></defs>
    <g transform="rotate(135 70 70)">
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".08" stroke-width="10" stroke-linecap="round" stroke-dasharray="${arc} ${c}"/>
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="url(#${id})" stroke-width="10" stroke-linecap="round" stroke-dasharray="${arc * v} ${c}"/>
    </g>
    <text x="70" y="74" text-anchor="middle" font-size="26" font-weight="700" fill="currentColor">${Math.round(v * 100)}%</text>
    <text x="70" y="94" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity=".5">${esc(label)}</text>
  </svg>`
}

// Agrupa los cubos de un período en como máximo `max` columnas (suma valores y une rangos)
export function groupBuckets(bk, values, max = 8) {
  const n = bk.length, size = Math.max(1, Math.ceil(n / max)), out = []
  for (let i = 0; i < n; i += size) {
    const part = bk.slice(i, i + size)
    out.push({ label: part[0].label, title: part.length > 1 ? `${part[0].title} – ${part[part.length - 1].title}` : part[0].title,
      from: part[0].from, to: part[part.length - 1].to, value: values.slice(i, i + size).reduce((a, b) => a + b, 0) })
  }
  return out
}

// Mini barras dentro de una tarjeta (cada barra es un botón)
export function mountMiniBars(host, { groups, format = (v) => v, onSelect }) {
  const max = Math.max(1, ...groups.map((g) => g.value))
  host.innerHTML = `<div class="mb-wrap">${groups.map((g, i) => `
    <button type="button" data-i="${i}" class="mb-col" title="${esc(g.title)}: ${esc(format(g.value))}" aria-label="${esc(g.title)}: ${esc(format(g.value))}">
      <span class="mb-track"><span class="mb-bar${i === groups.length - 1 ? ' last' : ''}" style="transform:scaleY(${Math.max(0.04, g.value / max)});--o:${0.35 + 0.65 * ((i + 1) / groups.length)}"></span></span>
      <span class="mb-lb">${esc(g.label)}</span>
    </button>`).join('')}</div>`
  host.querySelectorAll('.mb-col').forEach((b) => b.addEventListener('click', () => onSelect && onSelect(groups[+b.dataset.i])))
}

// Mini línea con puntos (sparkline) — se dibuja al ancho real del contenedor
export function mountMiniLine(host, { values, labels = [], format = (v) => v, height = 76 }) {
  host.classList.add('chart-host')
  const n = values.length
  function draw(W) {
    const id = 'ml' + uid++, P = 8, max = Math.max(1, ...values)
    const x = (i) => P + (n === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (n - 1))
    const y = (v) => P + (height - 2 * P) * (1 - v / max)
    const pts = values.map((v, i) => [x(i), y(v)])
    const line = smoothPath(pts, y(0))
    host.innerHTML = `<svg width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" style="display:block;overflow:visible">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(var(--chart))" stop-opacity=".22"/><stop offset="1" stop-color="rgb(var(--chart))" stop-opacity="0"/></linearGradient></defs>
      ${n > 1 ? `<path d="${line} L${x(n - 1)},${height} L${x(0)},${height} Z" fill="url(#${id})"/>` : ''}
      <path class="ml-path" d="${line}" fill="none" stroke="rgb(var(--chart))" stroke-width="2" stroke-linecap="round" pathLength="1"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === n - 1 ? 4.5 : 3.5}" fill="var(--card-bg)" stroke="rgb(var(--chart))" stroke-width="2"><title>${esc(labels[i] || '')}: ${esc(format(values[i]))}</title></circle>`).join('')}
    </svg>`
  }
  onResize(host, draw)
  draw(Math.max(160, host.clientWidth || 240))
}

/**
 * Anillo (dona) interactivo: cada porción y cada fila de la leyenda son botones.
 * items: [{ label, value, sub }] · center: { value, label }
 */
const DONUT_COLORS = ['rgb(var(--brand))', 'rgb(236 72 153)', 'rgb(var(--brand-light))', 'rgb(56 189 248)', 'rgb(16 185 129)', 'rgb(245 158 11)', 'rgb(148 163 184)']
export function mountDonut(host, { items, format = (v) => v, onSelect, center, empty = 'Sin datos en este período' }) {
  const list = items.filter((i) => i.value > 0)
  if (!list.length) { host.innerHTML = `<p class="py-6 text-center text-sm opacity-60">${esc(empty)}</p>`; return }
  const total = list.reduce((a, i) => a + i.value, 0)
  const r = 54, c = 2 * Math.PI * r, gap = list.length > 1 ? 3 : 0
  let acc = 0
  const arcs = list.map((it, k) => {
    const len = (it.value / total) * c
    const seg = `<circle class="dn-seg" data-k="${k}" cx="70" cy="70" r="${r}" fill="none" stroke="${it.color || DONUT_COLORS[k % DONUT_COLORS.length]}" stroke-width="16"
      stroke-dasharray="${Math.max(0.5, len - gap)} ${c}" stroke-dashoffset="${-acc}" tabindex="0" role="button" aria-label="${esc(it.label)}: ${esc(format(it.value))} (${Math.round((it.value / total) * 100)}%)"><title>${esc(it.label)}: ${esc(format(it.value))}</title></circle>`
    acc += len
    return seg
  }).join('')
  const top = list.reduce((a, b) => (b.value > a.value ? b : a))
  host.innerHTML = `<div class="dn-wrap">
    <div class="dn-ring"><svg viewBox="0 0 140 140" width="150" height="150"><g transform="rotate(-90 70 70)">
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".06" stroke-width="16"/>${arcs}</g></svg>
      <div class="dn-center"><b>${esc(center ? center.value : Math.round((top.value / total) * 100) + '%')}</b><span>${esc(center ? center.label : top.label)}</span></div></div>
    <div class="dn-legend">${list.map((it, k) => `<button type="button" class="dn-row" data-k="${k}">
      <span class="dn-key" style="background:${it.color || DONUT_COLORS[k % DONUT_COLORS.length]}"></span>
      <span class="dn-lb">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>
      <span class="dn-v">${esc(format(it.value))}<small>${Math.round((it.value / total) * 100)}%</small></span></button>`).join('')}</div></div>`
  const pick = (k) => onSelect && onSelect(list[k], k)
  host.querySelectorAll('[data-k]').forEach((el) => {
    el.addEventListener('click', () => pick(+el.dataset.k))
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(+el.dataset.k) } })
    el.addEventListener('pointerenter', () => host.querySelectorAll('[data-k]').forEach((o) => o.classList.toggle('dim', o.dataset.k !== el.dataset.k)))
    el.addEventListener('pointerleave', () => host.querySelectorAll('[data-k]').forEach((o) => o.classList.remove('dim')))
  })
}
