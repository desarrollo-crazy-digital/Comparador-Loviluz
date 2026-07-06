const {
  normalizeCups,
  hasConsumptionLookup,
  querySupabaseAnnualConsumption
} = require('./annualConsumption')

const UNAVAILABLE_MESSAGE = 'no hay consumo sips disponible para este cups.'

function isLookupDisabled() {
  return ['1', 'true', 'yes', 'on'].includes(
    String(
      process.env.DISABLE_ANNUAL_CONSUMPTION_LOOKUP ||
      process.env.VITE_DISABLE_ANNUAL_CONSUMPTION_LOOKUP ||
      ''
    )
      .trim()
      .toLowerCase()
  )
}

function shouldReturnNotFound(err) {
  const message = String(err?.message || '')
  if (isLookupDisabled()) return true
  if (!hasConsumptionLookup()) return true
  if (message.includes('Supabase consumo no configurado')) return true
  return false
}

function writeUnavailable(res, cups) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(
    JSON.stringify({
      found: false,
      cups,
      unavailable: true,
      message: UNAVAILABLE_MESSAGE
    })
  )
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method Not Allowed' }))
    return
  }

  const url = new URL(req.url || '/api/consumo-anual', 'http://localhost')
  const cups = normalizeCups(url.searchParams.get('cups'))

  if (!cups) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'CUPS requerido' }))
    return
  }

  if (isLookupDisabled() || !hasConsumptionLookup()) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ found: false, cups, disabled: true }))
    return
  }

  try {
    const lookup = await querySupabaseAnnualConsumption(cups)
    if (!lookup?.found) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ found: false, cups }))
      return
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        found: true,
        cups: lookup.cups || cups,
        annualKwh: Number(lookup.annualKwh) || 0,
        source: lookup.source || 'supabase',
        durationMs: Number(lookup.durationMs) || 0,
        monthsFound: Number(lookup.monthsFound) || 0,
        monthsUsed: Number(lookup.monthsUsed) || 0,
        rawRowsFound: Number(lookup.rawRowsFound) || 0,
        windowStart: lookup.windowStart || '',
        windowEnd: lookup.windowEnd || '',
        potencias: lookup.potencias || undefined,
        tarifa: lookup.tarifa || undefined
      })
    )
  } catch (err) {
    if (shouldReturnNotFound(err)) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ found: false, cups }))
      return
    }

    console.error(`annualConsumption lookup error for ${cups}:`, err)
    writeUnavailable(res, cups)
  }
}
