// Asistente de precios para reventa: sugiere precio de venta y margen con IA (Claude + búsqueda web).
// Requiere ANTHROPIC_API_KEY (secreto de Supabase o archivo local credenciales.ts, que no se sube a GitHub).
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  let local: { ANTHROPIC_API_KEY?: string; ANTHROPIC_MODEL?: string } = {}
  try { local = (await import('./credenciales.ts')).default } catch { /* sin archivo local */ }
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || local.ANTHROPIC_API_KEY
  const model = Deno.env.get('ANTHROPIC_MODEL') || local.ANTHROPIC_MODEL || 'claude-haiku-5-5'
  if (!apiKey) return json({ error: 'El asistente de IA aún no está activado: falta la clave de la API de Claude.' }, 503)

  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: isAdmin } = await asUser.rpc('is_admin')
  if (!isAdmin) return json({ error: 'Sólo un administrador puede usar el asistente' }, 401)

  let it: Record<string, unknown>
  try { it = await req.json() } catch { return json({ error: 'Solicitud inválida' }, 400) }
  const cost = Number(it.cost) || 0
  const modelName = `${it.brand ?? ''} ${it.name ?? ''}`.trim().slice(0, 120)
  if (!modelName || !(cost > 0)) return json({ error: 'Faltan el modelo o el costo' }, 400)
  const condition = it.condition === 'sellado' ? 'sellado (nuevo, caja cerrada)' : 'usado'
  const history = JSON.stringify(Array.isArray(it.history) ? it.history.slice(0, 6) : [])

  const prompt = `Eres asesor de precios de una tienda de teléfonos en Venezuela (Caracas) que revende equipos conseguidos por fuera.
Equipo: ${modelName}${it.color ? ' color ' + String(it.color).slice(0, 40) : ''}, condición: ${condition}.
Costo de compra: ${cost} USD.
Historial de la tienda (costo y precio que puso a otros equipos): ${history}

Busca en internet el precio actual de este equipo en Venezuela en USD (MercadoLibre Venezuela, tiendas y grupos de venta locales) para la misma condición. Luego recomienda un precio de venta que sea competitivo y deje ganancia sobre el costo.
Responde SOLO con un objeto JSON, sin texto adicional, con esta forma:
{"precio": número, "minimo": número, "maximo": número, "margen_pct": número, "explicacion": "1 o 2 frases cortas en español con el rango de mercado"}`

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2, user_location: { type: 'approximate', country: 'VE', city: 'Caracas', timezone: 'America/Caracas' } }],
    }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = data?.error?.message || `error ${r.status}`
    if (r.status === 401) return json({ error: 'La clave de la API de Claude no es válida.' }, 502)
    if (/credit|billing|balance/i.test(msg)) return json({ error: 'La cuenta de la API de Claude no tiene saldo.' }, 502)
    return json({ error: 'La IA no respondió: ' + msg }, 502)
  }

  const blocks = (data.content || []) as Array<Record<string, any>>
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')
  const match = text.match(/\{[\s\S]*\}/)
  let out: Record<string, unknown> = {}
  try { out = match ? JSON.parse(match[0]) : {} } catch { /* respuesta sin JSON */ }
  const precio = Number(out.precio)
  if (!(precio > 0)) return json({ error: 'La IA no pudo calcular un precio para este equipo. Intente con un modelo más específico.' }, 502)

  // Fuentes: citas y resultados de búsqueda
  const seen = new Set<string>()
  const fuentes: Array<{ title: string; url: string }> = []
  for (const b of blocks) {
    for (const c of b.citations || []) if (c.url && !seen.has(c.url)) { seen.add(c.url); fuentes.push({ title: c.title || c.url, url: c.url }) }
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const x of b.content) if (x.url && !seen.has(x.url)) { seen.add(x.url); fuentes.push({ title: x.title || x.url, url: x.url }) }
  }

  return json({
    precio,
    minimo: Number(out.minimo) || precio,
    maximo: Number(out.maximo) || precio,
    margen_pct: Number(out.margen_pct) || Math.round(((precio - cost) / precio) * 100),
    explicacion: String(out.explicacion || '').slice(0, 600),
    fuentes: fuentes.slice(0, 5),
  })
})
