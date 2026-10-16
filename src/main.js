import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './style.css'
import { initThemeFromCache } from './theme.js'
import { mountProgramBrand } from './brand.js'
import { initAuth } from './auth.js'
import { registerSW } from 'virtual:pwa-register'

// Colores y logo de la tienda guardados: la pantalla de inicio ya sale con la marca
initThemeFromCache()
mountProgramBrand()

// Pantalla de bienvenida del programa: se muestra al menos 1.3 s y hasta que cargue la sesión
const shownAt = Date.now()
function hideSplash() {
  const wait = Math.max(0, 1300 - (Date.now() - shownAt))
  setTimeout(() => document.getElementById('splash')?.classList.add('done'), wait)
}

initAuth().finally(hideSplash)
setTimeout(hideSplash, 6000)

// Actualización automática: cuando se publica una versión nueva, la app la descarga y se recarga sola
try {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) { if (reg) setInterval(() => reg.update().catch(() => {}), 5 * 60 * 1000) },
  })
} catch { /* sin service worker */ }
