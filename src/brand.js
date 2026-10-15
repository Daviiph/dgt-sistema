// Identidad del PROGRAMA (no de la tienda). Cambie estos valores para renombrarlo.
export const APP = {
  name: 'Vendra',
  tagline: 'Ventas e inventario, en orden.',
  owner: 'Daviiph',
  version: '1.0',
  year: new Date().getFullYear(),
}

// Logotipo del programa: una "V" con trazo de acento, en su propio color (no cambia con el tema de la tienda)
export function programLogo(size = 40, uid = 'vl') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${APP.name}">
  <defs>
    <linearGradient id="${uid}-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop stop-color="#1B2140"/><stop offset="1" stop-color="#0A0D1C"/></linearGradient>
    <linearGradient id="${uid}-ac" x1="34" y1="14" x2="50" y2="50" gradientUnits="userSpaceOnUse"><stop stop-color="#38BDF8"/><stop offset="1" stop-color="#6366F1"/></linearGradient>
  </defs>
  <rect width="64" height="64" rx="16" fill="url(#${uid}-bg)"/>
  <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="15.25" stroke="white" stroke-opacity=".08" stroke-width="1.5"/>
  <path d="M15 16h9.5l7.5 22.5L28 50h-2z" fill="#fff"/>
  <path d="M40.5 16H50L37.5 50h-9.2z" fill="url(#${uid}-ac)"/>
  <circle cx="47.5" cy="45.5" r="3.2" fill="#38BDF8"/>
</svg>`
}

export function programWordmark(cls = '') {
  return `<span class="font-extrabold italic tracking-tight ${cls}">Ven<span class="text-sky-400">dra</span></span>`
}

export function creditLine() {
  return `${APP.name} v${APP.version} · © ${APP.year} ${APP.owner}`
}

// Pinta el logo/crédito en todos los lugares marcados en el HTML
export function mountProgramBrand() {
  document.querySelectorAll('[data-program-logo]').forEach((el, i) => {
    el.innerHTML = programLogo(Number(el.dataset.programLogo) || 40, 'vl' + i)
  })
  document.querySelectorAll('[data-program-name]').forEach((el) => (el.innerHTML = programWordmark(el.dataset.programName || '')))
  document.querySelectorAll('[data-program-credit]').forEach((el) => (el.textContent = creditLine()))
  document.querySelectorAll('[data-program-tagline]').forEach((el) => (el.textContent = APP.tagline))
}
