const { getSupabaseClient } = require('../lib/supabase')

function asNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pickOfferPayload(offers) {
  if (!offers) return {}
  if (Array.isArray(offers)) return offers[0] || {}
  if (typeof offers === 'object') return offers
  return {}
}

async function fetchAllComparisons(supabase, { days } = {}) {
  const pageSize = 1000
  let from = 0
  const rows = []
  const cutoffIso = Number.isFinite(days) && days > 0
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    : null

  while (true) {
    const to = from + pageSize - 1
    let query = supabase
      .from('comparisons')
      .select('id, created_at, commercial_code, offers')
      .order('created_at', { ascending: false })
      .range(from, to)
    if (cutoffIso) query = query.gte('created_at', cutoffIso)

    const { data, error } = await query

    if (error) {
      if (error.message && error.message.includes('Could not find the table')) {
        console.warn('Table not found, returning empty array');
        break;
      }
      throw error;
    }
    if (!data || data.length === 0) break

    rows.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }

  return rows
}

function parseRangeFromReq(req) {
  const url = new URL(req.url || '/api/stats', 'http://localhost')
  const raw = String(url.searchParams.get('range') || '').trim().toLowerCase()
  if (!raw || raw === 'all' || raw === 'total') return { raw: 'all', days: null }
  const map = { '7d': 7, '15d': 15, '30d': 30 }
  if (map[raw]) return { raw, days: map[raw] }

  const asNumber = Number(raw)
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return { raw: `${asNumber}d`, days: asNumber }
  }
  return { raw: 'all', days: null }
}

module.exports = async function handler(req, res) {
  try {
    const route = (req.url || '').split('?')[0]

    if (route.endsWith('/stats/track')) {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      const payload = await readJsonBody(req)
      payload.timestamp = payload.timestamp || new Date().toISOString()

      const commercial = payload.commercial || payload.commercialCode || payload.codigo || 'unknown'

      const supabase = getSupabaseClient()
      const { error } = await supabase.from('comparisons').insert({
        commercial_code: commercial,
        client_name: payload.clientName || null,
        cups: payload.cups || null,
        energy_type: payload.energyType || null,
        tariff_type: payload.tariffType || null,
        offers: payload
      })
      if (error) {
        if (error.message && error.message.includes('Could not find the table')) {
          console.warn('Table not found, ignoring track insert');
        } else {
          throw error;
        }
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (route.endsWith('/stats/cleanup')) {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      const { days } = await readJsonBody(req)
      const numDays = Number(days)
      if (!Number.isFinite(numDays) || numDays <= 0) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Parametro days invalido' }))
        return
      }

      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - numDays)

      const supabase = getSupabaseClient()
      const { error } = await supabase
        .from('comparisons')
        .delete()
        .lt('created_at', cutoff.toISOString())
      if (error) throw error

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (req.method !== 'GET') {
      res.statusCode = 405
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    const supabase = getSupabaseClient()
    const range = parseRangeFromReq(req)
    const data = await fetchAllComparisons(supabase, { days: range.days })

    const downloads = []
    const comparisons = []

    ;(data || []).forEach((row) => {
      const payload = pickOfferPayload(row.offers)
      const type = payload.type || 'download'
      const base = {
        commercial: row.commercial_code || payload.commercial || 'unknown',
        timestamp: payload.timestamp || row.created_at || new Date().toISOString()
      }

      if (type === 'comparison') {
        comparisons.push({ ...base, ...payload })
        return
      }

      downloads.push({
        ...base,
        supplier: payload.supplier || payload.comercializadora || payload.company || 'unknown',
        product: payload.product || payload.productName || payload.tarifa || 'unknown',
        commission: asNumber(payload.commission),
        savings: Math.abs(asNumber(payload.savings))
      })
    })

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ comparisons, downloads, meta: { range: range.raw, days: range.days } }))
  } catch (err) {
    const status = err.statusCode || 500
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: err.message || 'Error cargando stats' }))
  }
}

async function readJsonBody(req) {
  return await new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch (e) {
        reject(new Error('JSON invalido'))
      }
    })
  })
}
