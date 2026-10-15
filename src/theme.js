// Tema de la tienda: paleta de colores derivada del logo (PNG transparente) o elegida a mano.
export const DEFAULT_COLOR = '#7C3AED'
const LS_COLOR = 'ns_brand_color'
const LS_LOGO = 'ns_brand_logo'

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase()

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
  }
  return [h, s, l]
}
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}
const hsl = (h, s, l) => hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1)).map(Math.round)

function luminance([r, g, b]) {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
export const contrastWithWhite = (rgb) => 1.05 / (luminance(rgb) + 0.05)

// Ajusta un color para que funcione como color principal (texto blanco legible encima)
export function normalizeBrand(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return DEFAULT_COLOR
  if (contrastWithWhite(rgb) >= 3.6) return rgbToHex(...rgb)
  let [h, s, l] = rgbToHsl(...rgb)
  s = Math.max(s, 0.45)
  let out = hsl(h, s, l)
  while (contrastWithWhite(out) < 4 && l > 0.15) { l -= 0.03; out = hsl(h, s, l) }
  return rgbToHex(...out)
}

export function buildPalette(hex) {
  const brand = hexToRgb(hex) || hexToRgb(DEFAULT_COLOR)
  const [h, s, l] = rgbToHsl(...brand)
  return {
    brand,
    light: hsl(h, s * 0.9, Math.min(l + 0.2, 0.8)),
    dark: hsl(h, s, Math.max(l - 0.13, 0.08)),
    soft: hsl(h, Math.min(s, 0.8), 0.95),
    softer: hsl(h, Math.min(s, 0.7), 0.975),
    line: hsl(h, Math.min(s, 0.6), 0.91),
    deep: hsl(h, Math.min(s, 0.75), Math.min(l, 0.32)),
    ink: hsl(h, Math.min(s, 0.6), 0.1),
  }
}

let current = DEFAULT_COLOR
export const currentColor = () => current

export function applyPalette(hex) {
  current = rgbToHex(...(hexToRgb(hex) || hexToRgb(DEFAULT_COLOR)))
  const p = buildPalette(current)
  const root = document.documentElement.style
  for (const [k, v] of Object.entries(p)) root.setProperty(k === 'brand' ? '--brand' : '--brand-' + k, v.join(' '))
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', current))
  return current
}

let logoUrl = ''
export const currentLogo = () => logoUrl

export function applyLogo(dataUrl) {
  logoUrl = dataUrl || ''
  document.querySelectorAll('img[data-brand-logo]').forEach((img) => {
    // La primera vez se recuerda el logo original del HTML (si tiene) para poder restaurarlo
    if (img.dataset.orig === undefined) img.dataset.orig = img.getAttribute('src') || ''
    const src = logoUrl || img.dataset.orig
    if (src) img.src = src
    img.classList.toggle('hidden', !src)
  })
  document.querySelectorAll('[data-brand-logo-fallback]').forEach((el) => el.classList.toggle('hidden', !!logoUrl))
  if (logoUrl) {
    let link = document.querySelector('link[rel="icon"]')
    if (link) link.href = logoUrl
  }
}

// Guarda en el navegador para que la pantalla de inicio de sesión ya salga con la marca
export function cacheBrand(color, logo) {
  try {
    localStorage.setItem(LS_COLOR, color || '')
    if (logo) localStorage.setItem(LS_LOGO, logo)
    else localStorage.removeItem(LS_LOGO)
  } catch { /* almacenamiento lleno o bloqueado: no es crítico */ }
}

export function initThemeFromCache() {
  let color = '', logo = ''
  try { color = localStorage.getItem(LS_COLOR) || ''; logo = localStorage.getItem(LS_LOGO) || '' } catch { /* sin almacenamiento */ }
  applyPalette(color || DEFAULT_COLOR)
  applyLogo(logo)
}

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.onload = () => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('El archivo no es una imagen válida'))
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// Reduce el logo (máx. 512 px), detecta transparencia y propone colores principales
export function analyzeLogo(img) {
  const max = 512
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  let dataUrl = c.toDataURL('image/png')
  if (dataUrl.length > 600000) {
    const c2 = document.createElement('canvas')
    c2.width = Math.round(w / 2); c2.height = Math.round(h / 2)
    c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height)
    dataUrl = c2.toDataURL('image/png')
  }

  // Muestra pequeña para analizar colores
  const sw = 96, sh = Math.max(1, Math.round((96 * h) / w))
  const s = document.createElement('canvas')
  s.width = sw; s.height = sh
  const sctx = s.getContext('2d')
  sctx.drawImage(img, 0, 0, sw, sh)
  const px = sctx.getImageData(0, 0, sw, sh).data
  let transparentPx = 0
  const bins = new Map()
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3]
    if (a < 250) transparentPx++
    if (a < 140) continue
    const [hh, ss, ll] = rgbToHsl(px[i], px[i + 1], px[i + 2])
    if (ss < 0.22 || ll < 0.1 || ll > 0.93) continue
    const key = Math.round(hh / 12) % 30
    const weight = ss * (1 - Math.abs(ll - 0.5))
    const b = bins.get(key) || { w: 0, r: 0, g: 0, b: 0, n: 0 }
    b.w += weight; b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2]; b.n++
    bins.set(key, b)
  }
  const total = px.length / 4
  const ranked = [...bins.entries()].sort((a, b) => b[1].w - a[1].w)
  const picked = []
  for (const [key, b] of ranked) {
    if (b.n < total * 0.004) continue
    if (picked.some((p) => Math.min(Math.abs(p.key - key), 30 - Math.abs(p.key - key)) < 3)) continue
    picked.push({ key, hex: normalizeBrand(rgbToHex(b.r / b.n, b.g / b.n, b.b / b.n)) })
    if (picked.length === 4) break
  }
  return {
    dataUrl,
    transparent: transparentPx / total > 0.02,
    colors: picked.map((p) => p.hex),
  }
}
