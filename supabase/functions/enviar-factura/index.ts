// Envía la factura (PDF) al correo del cliente desde la cuenta Gmail de la tienda.
// Secretos necesarios (Supabase → Edge Functions → Secrets):
//   GMAIL_USER          = dgttecnologiavzla@gmail.com
//   GMAIL_APP_PASSWORD  = contraseña de aplicación de Google (16 letras)
// Gmail por SMTP seguro en el puerto 465 (Supabase bloquea 25 y 587).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const fmt = (n: unknown) => Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  // Secretos de Supabase primero; si no existen, los del archivo local credenciales.ts (no se sube a GitHub)
  let local: { GMAIL_USER?: string; GMAIL_APP_PASSWORD?: string } = {}
  try { local = (await import('./credenciales.ts')).default } catch { /* sin archivo local */ }
  const user = Deno.env.get('GMAIL_USER') || local.GMAIL_USER
  const pass = (Deno.env.get('GMAIL_APP_PASSWORD') || local.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '')
  if (!user || !pass) return json({ error: 'Falta configurar el correo de envío (GMAIL_USER y GMAIL_APP_PASSWORD).' }, 500)

  // Cliente con la sesión de quien llama: respeta los permisos (RLS)
  const url = Deno.env.get('SUPABASE_URL')!
  const auth = req.headers.get('Authorization') ?? ''
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: isMember } = await asUser.rpc('is_member')
  if (!isMember) return json({ error: 'No autorizado' }, 401)
  const { data: me } = await asUser.auth.getUser()

  let body: { saleId?: string; pdfBase64?: string }
  try { body = await req.json() } catch { return json({ error: 'Solicitud inválida' }, 400) }
  const { saleId, pdfBase64 } = body
  if (!saleId || !pdfBase64) return json({ error: 'Faltan datos de la factura' }, 400)
  if (pdfBase64.length > 8_000_000) return json({ error: 'El PDF es demasiado grande' }, 413)

  const { data: sale } = await asUser.from('sales').select('*').eq('id', saleId).maybeSingle()
  if (!sale) return json({ error: 'Venta no encontrada' }, 404)
  const { data: customer } = await asUser.from('customers').select('name,email').eq('id', Number(sale.customer_id)).maybeSingle()
  const to = String(customer?.email || '').trim()
  if (!EMAIL_RE.test(to)) return json({ error: 'El cliente no tiene un correo válido registrado' }, 422)

  const doc = sale.doc_type || 'Nota de Entrega'
  const channel = sale.channel === 'reventa' ? 'Reventa' : 'Tienda'
  const items = (sale.items || []) as Array<{ name: string; qty: number; price: number }>
  const rows = items.map((i) => `<tr><td style="padding:6px 0">${esc(i.name)} × ${esc(i.qty)}</td><td style="padding:6px 0;text-align:right">$ ${fmt(i.price * i.qty)}</td></tr>`).join('')
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#16162E">
    <h2 style="margin:0 0 4px">DGT Technology</h2>
    <p style="margin:0 0 16px;color:#6b6b80">${esc(doc)} N.º ${esc(sale.id)} · ${esc(channel)}</p>
    <p>Hola ${esc(customer?.name || '')}, gracias por su compra. Adjuntamos su ${esc(doc.toLowerCase())} en PDF.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;border-top:1px solid #eee;border-bottom:1px solid #eee">${rows}</table>
    <p style="font-size:18px;text-align:right;margin:12px 0"><b>Total: $ ${fmt(sale.total)}</b></p>
    <p style="font-size:12px;color:#8a8aa0">C.C. City Market, Nivel Plaza, Local 167 · Tel. +58 422 624 3505<br>Documento sin valor fiscal. Garantía de 360 días por defectos de fabricación.</p>
  </div>`

  const client = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: user, password: pass } } })
  try {
    await client.send({
      from: `DGT Technology <${user}>`,
      to,
      replyTo: user,
      subject: `${doc} ${sale.id} – DGT Technology`,
      content: `Gracias por su compra. Adjuntamos su ${doc} ${sale.id}. Total: $ ${fmt(sale.total)}.`,
      html,
      attachments: [{ filename: `${sale.id}.pdf`, content: pdfBase64, encoding: 'base64', contentType: 'application/pdf' }],
    })
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    return json({ error: /auth|535|username|password/i.test(msg) ? 'Gmail rechazó el acceso: revise la contraseña de aplicación' : 'No se pudo enviar el correo: ' + msg }, 502)
  } finally {
    try { await client.close() } catch { /* ya cerrado */ }
  }

  // Deja constancia del envío en la venta
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const sentAt = new Date().toISOString()
  await admin.from('sales').update({ extra: { ...(sale.extra || {}), emailedAt: sentAt, emailedTo: to } }).eq('id', saleId)
  await admin.from('audit_log').insert({ user_id: me?.user?.id ?? null, user_email: me?.user?.email ?? null, action: 'email_invoice', entity: 'sales', entity_id: saleId, details: { to } })

  return json({ ok: true, to, sentAt })
})
