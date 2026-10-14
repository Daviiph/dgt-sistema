const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

async function getBcv() {
  const r = await fetch('https://ve.dolarapi.com/v1/dolares/oficial')
  const d = await r.json()
  if (!(d.promedio > 0)) throw new Error('BCV sin datos')
  return { rate: Math.round(d.promedio * 100) / 100, date: d.fechaActualizacion }
}

async function getBinance() {
  const r = await fetch('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ asset: 'USDT', fiat: 'VES', tradeType: 'BUY', page: 1, rows: 20, payTypes: [], publisherType: null }),
  })
  const d = await r.json()
  const prices = (d.data || []).map((a: any) => Number(a.adv.price)).filter((p: number) => p > 0).slice(0, 10).sort((a: number, b: number) => a - b)
  if (!prices.length) throw new Error('Binance sin datos')
  const mid = prices[Math.floor(prices.length / 2)]
  return { rate: Math.round(mid * 100) / 100, date: new Date().toISOString() }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const [bcv, binance] = await Promise.allSettled([getBcv(), getBinance()])
  const body = {
    bcv: bcv.status === 'fulfilled' ? bcv.value : null,
    binance: binance.status === 'fulfilled' ? binance.value : null,
    fetchedAt: new Date().toISOString(),
  }
  return new Response(JSON.stringify(body), {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  })
})
