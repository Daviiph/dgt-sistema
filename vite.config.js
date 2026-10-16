import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

// VITE_MOCK=1 sólo para pruebas visuales: reemplaza Supabase por datos de ejemplo en memoria
const mock = process.env.VITE_MOCK === '1'

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  build: { chunkSizeWarningLimit: 2000 },
  resolve: mock ? { alias: [{ find: 'virtual:pwa-register', replacement: fileURLToPath(new URL('./test/pwa-stub.js', import.meta.url)) }, { find: /^\.\/supabase\.js$/, replacement: fileURLToPath(new URL('./test/mock-supabase.js', import.meta.url)) }] } : {},
  plugins: [
    !mock && VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'logo.png'],
      manifest: {
        name: 'DgtTecnologyVzla – Vendra',
        short_name: 'Vendra',
        description: 'Sistema de ventas e inventario de DGT Technology',
        lang: 'es',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        theme_color: '#7C3AED',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff,woff2,ttf}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
})
