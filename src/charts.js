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
  const { labels, series, format = (v) => v, onSelect } = opts
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
    const grid = [0, 0.5, 1].map((f) => {
      const yy = y(max * f)
      return `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="currentColor" stroke-opacity="${f === 0 ? 0.18 : 0.08}"/>
        <text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".5">${esc(format(max * f))}</text>`
    }).join('')
    const maxLabels = Math.max(2, Math.floor((W - L - R) / 64))
    const step = Math.max(1, Math.ceil(n / maxLabels))
    const xl = labels.map((lb, i) => ((i % step === 0 && (n - 1 - i >= step / 2 || i === n - 1)) || i === n - 1
      ? `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" font-size="11" fill="currentColor" fill-opacity=".5">${esc(lb)}</text>` : '')).join('')
    const paths = series.map((s, si) => {
      const pts = s.values.map((v, i) => [x(i), y(v)])
      const line = smoothPath(pts, y(0))
      const col = s.color || 'var(--brand-light)'
      const area = si === 0 && n > 1 ? `<path d="${line} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#${id}g${si})"/>` : ''
      return `<defs><linearGradient id="${id}g${si}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${col})" stop-opacity=".45"/><stop offset="1" stop-color="rgb(${col})" stop-opacity="0"/></linearGradient></defs>
        ${area}<path d="${line}" fill="none" stroke="rgb(${col})" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}glow)"/>`
    }).join('')
    const dots = series.map((s, si) => `<circle class="cx-dot" data-s="${si}" r="5" fill="rgb(${s.color || 'var(--brand-light)'})" stroke="#0b0e20" stroke-width="2" opacity="0"/>`).join('')
    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible">
      <defs><filter id="${id}glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      ${grid}${xl}${paths}
      <line class="cx-line" y1="${T}" y2="${y(0)}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="3 3" opacity="0"/>
      ${dots}
      <rect class="cx-hit" x="${L - 10}" y="0" width="${W - L - R + 20}" height="${H}" fill="transparent" style="cursor:${onSelect ? 'pointer' : 'crosshair'}"/>
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
        (extra ? `<p class="tip-extra">${esc(extra)}</p>` : '') + (onSelect ? '<p class="tip-hint">Toque para ver las ventas</p>' : '')
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
    hit.addEventListener('pointermove', (e) => show(idxFromEvent(e)))
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide() })
    hit.addEventListener('click', (e) => { const i = idxFromEvent(e); show(i); onSelect && onSelect(i) })
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
    <button type="button" data-k="${k}" class="rank-row group w-full text-left rounded-xl px-2 py-2 -mx-2 transition hover:bg-white/5 focus-visible:bg-white/5">
      <span class="flex items-baseline justify-between gap-3 text-sm">
        <span class="truncate">${esc(it.label)}</span>
        <span class="shrink-0 tabular-nums font-semibold">${esc(format(it.value))} <span class="font-normal opacity-50 text-xs">${Math.round((it.value / total) * 100)}%</span></span>
      </span>
      <span class="mt-1.5 block h-1.5 rounded-full bg-white/10 overflow-hidden"><span class="block h-full rounded-full transition-all" style="width:${(it.value / max) * 100}%;background:${it.color || 'linear-gradient(90deg, rgb(var(--brand)), rgb(var(--brand-light)))'}"></span></span>
      ${it.sub ? `<span class="mt-1 block text-[11px] opacity-50">${esc(it.sub)}</span>` : ''}
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
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="white" stroke-opacity=".08" stroke-width="10" stroke-linecap="round" stroke-dasharray="${arc} ${c}"/>
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="url(#${id})" stroke-width="10" stroke-linecap="round" stroke-dasharray="${arc * v} ${c}"/>
    </g>
    <text x="70" y="74" text-anchor="middle" font-size="26" font-weight="700" fill="white">${Math.round(v * 100)}%</text>
    <text x="70" y="94" text-anchor="middle" font-size="9" fill="white" fill-opacity=".55">${esc(label)}</text>
  </svg>`
}
