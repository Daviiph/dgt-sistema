// Gráficas en SVG puro (sin librerías), pensadas para las tarjetas oscuras del panel
let uid = 0

function smoothPath(pts) {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

const niceMax = (v) => {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / p / (v / p > 5 ? 2 : 1)) * p * (v / p > 5 ? 2 : 1)
}

// series: [{ values:[], color:'r g b' | css var }]
export function areaChart({ labels, series, height = 220, format = (v) => v }) {
  const id = 'ac' + uid++
  const W = 640, H = height, L = 44, R = 12, T = 14, B = 26
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)))
  const n = labels.length
  const x = (i) => L + (n === 1 ? 0 : (i * (W - L - R)) / (n - 1))
  const y = (v) => T + (H - T - B) * (1 - v / max)
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const yy = y(max * f)
    return `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="currentColor" stroke-opacity=".08"/>
      <text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="10" fill="currentColor" fill-opacity=".45">${format(max * f)}</text>`
  }).join('')
  const step = Math.ceil(n / 8)
  const xl = labels.map((lb, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="currentColor" fill-opacity=".45">${lb}</text>` : '')).join('')
  const paths = series.map((s, si) => {
    const pts = s.values.map((v, i) => [x(i), y(v)])
    const line = smoothPath(pts)
    const area = `${line} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`
    const col = s.color || 'var(--brand)'
    return `<defs><linearGradient id="${id}g${si}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${col})" stop-opacity=".55"/><stop offset="1" stop-color="rgb(${col})" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#${id}g${si})"/>
      <path d="${line}" fill="none" stroke="rgb(${col})" stroke-width="3" stroke-linecap="round" filter="url(#${id}glow)"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="10" fill="transparent"><title>${labels[i]}: ${format(s.values[i])}</title></circle>`).join('')}`
  }).join('')
  return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" preserveAspectRatio="none" role="img">
    <defs><filter id="${id}glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    ${grid}${xl}${paths}</svg>`
}

export function barChart({ labels, values, height = 160, format = (v) => v }) {
  const W = 320, H = height, B = 22, T = 8
  const max = niceMax(Math.max(1, ...values))
  const n = values.length
  const slot = W / n, bw = Math.min(14, slot * 0.35)
  return `<svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img">
    ${values.map((v, i) => {
      const h = ((H - B - T) * v) / max, cx = slot * i + slot / 2
      return `<rect x="${cx - bw / 2}" y="${T}" width="${bw}" height="${H - B - T}" rx="${bw / 2}" fill="white" fill-opacity=".07"/>
        <rect x="${cx - bw / 2}" y="${H - B - h}" width="${bw}" height="${Math.max(h, 0.0001)}" rx="${bw / 2}" fill="white"><title>${labels[i]}: ${format(v)}</title></rect>
        <text x="${cx}" y="${H - 6}" text-anchor="middle" font-size="10" fill="white" fill-opacity=".5">${labels[i]}</text>`
    }).join('')}</svg>`
}

// Indicador circular tipo "gauge" (0..1)
export function gauge(value, { size = 150, color = 'var(--brand-light)', label = '' } = {}) {
  const id = 'gg' + uid++
  const v = Math.max(0, Math.min(1, value || 0))
  const r = 52, c = 2 * Math.PI * r, arc = c * 0.75
  return `<svg viewBox="0 0 140 140" width="${size}" height="${size}" role="img">
    <defs><linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="rgb(var(--brand))"/><stop offset="1" stop-color="rgb(${color})"/></linearGradient></defs>
    <g transform="rotate(135 70 70)">
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="white" stroke-opacity=".08" stroke-width="10" stroke-linecap="round" stroke-dasharray="${arc} ${c}"/>
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="url(#${id})" stroke-width="10" stroke-linecap="round" stroke-dasharray="${arc * v} ${c}"/>
    </g>
    <text x="70" y="74" text-anchor="middle" font-size="26" font-weight="700" fill="white">${Math.round(v * 100)}%</text>
    <text x="70" y="94" text-anchor="middle" font-size="9" fill="white" fill-opacity=".55">${label}</text>
  </svg>`
}
