# DGT Sistema – PWA + Supabase (plan de trabajo)

Origen: /home/ubuntu/out/sistema.html (single-file, localStorage). Objetivo: PWA instalable con login y datos en Supabase.

## Arquitectura
- Vite (vanilla) + Tailwind 3 (build local, sin CDN) + vite-plugin-pwa + @supabase/supabase-js + html2pdf.js.
- index.html = UI de sistema.html + pantalla de login. src/app.js = lógica original adaptada.
- Persistencia: `save()` hace diff de arrays (brands, products, customers, sellers, payments) vs último snapshot y upsert/delete en Supabase.
  Mapeo genérico camelCase<->snake_case con columnas conocidas por tabla; claves desconocidas van a columna `extra jsonb`.
- Ventas: RPC `create_sale(p jsonb)` (valida y descuenta stock atómico), `cancel_sale(id, reason)` (admin, devuelve stock),
  `delete_sale(id)` (admin, sólo anuladas). Todas escriben en audit_log.
- Settings (moneda, tasa) en tabla settings key/value (admin escribe).
- Roles en profiles: 'admin' | 'vendedor'. Primer usuario registrado = admin (trigger). Vendedor: lee catálogo, crea clientes y ventas, ve solo sus ventas.
- Import JSON (respaldo actual) -> admin: upsert catálogo + insert ventas directo (RLS admin).
- Realtime: suscripción a cambios -> recarga datos y re-render.

## Pendiente
- Claves Supabase del usuario (URL, anon key, DB password) -> aplicar supabase/schema.sql.
- Hosting: necesita cuenta del usuario (Vercel/Netlify/GitHub Pages). Usuario GitHub: Daviiph.
- Entregar siempre HTML/zip descargable al usuario.
