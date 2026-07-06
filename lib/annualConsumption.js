const { createClient } = require('@supabase/supabase-js')

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function substractOneYear(date) {
  const year = date.getFullYear() - 1;
  const month = date.getMonth();
  const day = date.getDate();
  const d = new Date(year, month, day);
  // 29-feb en año no bisiesto: igual que sips_service.py, recorta al dia 28
  if (d.getMonth() !== month) return new Date(year, month, 28);
  return d;
}

function normalizeCups(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}

function getAnyEnv(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name]
  }
  return ''
}

function getEnergiaSupabaseUrl() {
  return getAnyEnv([
    'ENERGIA_SUPABASE_URL',
    'VITE_ENERGIA_SUPABASE_URL'
  ])
}

function getEnergiaServiceRoleKey() {
  return getAnyEnv([
    'ENERGIA_SUPABASE_KEY',
    'VITE_ENERGIA_SUPABASE_KEY'
  ])
}

function hasConsumptionLookup() {
  return Boolean(getEnergiaSupabaseUrl() && getEnergiaServiceRoleKey())
}

function createSupabaseClient(url, key, missingMessage) {
  if (!url || !key) throw new Error(missingMessage)

  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function getEnergiaSupabaseClient() {
  return createSupabaseClient(
    getEnergiaSupabaseUrl(),
    getEnergiaServiceRoleKey(),
    'Supabase energia no configurado (faltan ENERGIA_SUPABASE_URL y/o ENERGIA_SUPABASE_KEY)'
  )
}

function applyCupsLookup(query, cups) {
  if (cups.length >= 22) return query.eq('cups', cups)

  const base20 = cups.slice(0, 20)
  if (base20.length >= 20) return query.gte('cups', base20).lt('cups', `${base20}ZZ`)

  return query.eq('cups', cups)
}

function getBase20Cups(cups) {
  const normalized = normalizeCups(cups)
  if (normalized.length < 20) return ''
  return normalized.slice(0, 20)
}

async function fetchDeterministicCupsRow(supabase, tableName, cups) {
  const normalizedCups = normalizeCups(cups)
  if (!normalizedCups) return { data: null, error: null }

  const exactResult = await supabase
    .from(tableName)
    .select('*')
    .eq('cups', normalizedCups)
    .maybeSingle()

  if (exactResult.data || exactResult.error || normalizedCups.length < 20) {
    return exactResult
  }

  const base20 = getBase20Cups(normalizedCups)
  if (!base20) return exactResult

  const rangeResult = await supabase
    .from(tableName)
    .select('*')
    .gte('cups', base20)
    .lt('cups', `${base20}ZZ`)
    .order('cups', { ascending: true })
    .limit(20)

  if (rangeResult.error) return rangeResult

  const rows = Array.isArray(rangeResult.data) ? rangeResult.data : []
  const exactBase20Match = rows.find((row) => normalizeCups(row?.cups).slice(0, 20) === base20)
  if (exactBase20Match) {
    return { data: exactBase20Match, error: null }
  }

  const firstRow = rows[0] || null
  return { data: firstRow, error: null }
}

async function fetchDeterministicCupsRows(supabase, tableName, cups, limit = 36) {
  const normalizedCups = normalizeCups(cups)
  if (!normalizedCups) return { data: [], error: null }

  const exactResult = await supabase
    .from(tableName)
    .select('*')
    .eq('cups', normalizedCups)
    .order('fecha_fin', { ascending: false })
    .limit(limit)

  if ((exactResult.data && exactResult.data.length > 0) || exactResult.error || normalizedCups.length < 20) {
    return exactResult
  }

  const base20 = getBase20Cups(normalizedCups)
  if (!base20) return exactResult

  const rangeResult = await supabase
    .from(tableName)
    .select('*')
    .gte('cups', base20)
    .lt('cups', `${base20}ZZ`)
    .order('cups', { ascending: true })
    .order('fecha_fin', { ascending: false })
    .limit(limit)

  return rangeResult
}

async function querySupabaseAnnualConsumption(cups) {
  const normalizedCups = normalizeCups(cups)
  if (!normalizedCups) {
    return { found: false, cups: normalizedCups }
  }

  const startedAt = Date.now()
  const supabase = getEnergiaSupabaseClient()

  // 1. Consultar a vw_puntos_suministro_detallado (Primero coincidencia exacta)
  const sipsResult = await fetchDeterministicCupsRow(
    supabase,
    'vw_puntos_suministro_detallado',
    normalizedCups
  )
  let { data: sipsData, error: sipsError } = sipsResult

  if (sipsError) {
    console.error(`SIPS fetch error for ${normalizedCups}:`, sipsError)
  }

  // 2. Consultar consumos_facturacion (ultimos 36 periodos)
  const cupsToSearch = sipsData?.cups || normalizedCups

  let consumosData = null
  let consumosError = null

  const exactConsumosResult = await fetchDeterministicCupsRows(
    supabase,
    'consumos_facturacion',
    cupsToSearch
  )
  consumosData = Array.isArray(exactConsumosResult.data) ? exactConsumosResult.data : []
  consumosError = exactConsumosResult.error

  if (consumosError) {
    console.error(`Consumos fetch error for ${cupsToSearch}:`, consumosError)
  }

  if (!sipsData && (!consumosData || consumosData.length === 0)) {
    // Fallback a la tabla antigua si estamos usando el proyecto anterior sin las nuevas vistas
    const table = process.env.SUPABASE_CONSUMPTION_TABLE || 'comparator_consumption'
    let { data: oldData } = await supabase.from(table).select('cups, annual_kwh').eq('cups', normalizedCups).maybeSingle()
    if (!oldData) {
      const base20 = normalizedCups.slice(0, 20)
      if (base20.length >= 20) {
        const prefixLookup = await supabase.from(table).select('cups, annual_kwh').gte('cups', base20).lt('cups', base20 + 'ZZ').limit(1).maybeSingle()
        if (prefixLookup.data) oldData = prefixLookup.data
      }
    }

    if (oldData) {
      return {
        found: true,
        cups: oldData.cups || normalizedCups,
        annualKwh: Number(oldData.annual_kwh) || 0,
        source: 'supabase_fallback',
        durationMs: Date.now() - startedAt
      }
    }

    return {
      found: false,
      cups: normalizedCups,
      source: 'supabase_energia',
      durationMs: Date.now() - startedAt
    }
  }

  // Calcular CAE aplicando deduplicacion y pro-rateo (misma logica que backend/app/services/sips_service.py)
  let annualKwh = 0
  let filteredRows = []
  let fechaInicioTxt = '-'
  let fechaFinTxt = '-'
  let uniqueRows = []

  if (consumosData && consumosData.length > 0) {
    // 2.1 Deduplicar y priorizar por fecha_inicio y fecha_fin
    const deduped = {}
    for (const row of consumosData) {
      const fIni = row.fecha_inicio
      const fFin = row.fecha_fin
      if (!fIni || !fFin) continue
      const keyVal = `${fIni}_${fFin}`

      const tl = String(row.tipo_lectura || '').trim().toUpperCase()
      const rank = ['30', 'R', 'REAL'].includes(tl) ? 1 : (['E', 'ESTIMADA'].includes(tl) ? 2 : 3)

      if (!deduped[keyVal]) {
        deduped[keyVal] = { row, rank }
      } else {
        if (rank < deduped[keyVal].rank) {
          deduped[keyVal] = { row, rank }
        }
      }
    }

    uniqueRows = Object.values(deduped).map(item => item.row)
    // Orden identico al backend: fecha_inicio desc, luego fecha_fin desc
    uniqueRows.sort((a, b) => {
      const byInicio = String(b.fecha_inicio || '').localeCompare(String(a.fecha_inicio || ''))
      if (byInicio !== 0) return byInicio
      return String(b.fecha_fin || '').localeCompare(String(a.fecha_fin || ''))
    })

    if (uniqueRows.length > 0) {
      const mostRecentRow = uniqueRows[0]
      fechaFinTxt = mostRecentRow.fecha_fin || '-'
      const latestDt = parseLocalDate(fechaFinTxt)
      const cutoffDt = latestDt ? substractOneYear(latestDt) : null

      // 2.3 Filtrar registros en el año movil (365 dias), ambos extremos
      for (const row of uniqueRows) {
        const fIniStr = row.fecha_inicio
        const fFinStr = row.fecha_fin
        if (!fIniStr || !fFinStr) continue
        try {
          const fIniDt = parseLocalDate(fIniStr)
          const fFinDt = parseLocalDate(fFinStr)
          if (latestDt && cutoffDt) {
            if (fFinDt > cutoffDt && fIniDt <= latestDt) {
              filteredRows.push(row)
            }
          } else {
            if (filteredRows.length < 12) filteredRows.push(row)
          }
        } catch (e) {
          if (filteredRows.length < 12) filteredRows.push(row)
        }
      }

      // 2.4 Acumular con prorrateo por dias solo en el/los periodos que cruzan el corte
      // (identico a overlap_factor en sips_service.py, en vez de un factor global de escala)
      for (const row of filteredRows) {
        const fIniStr = row.fecha_inicio
        const fFinStr = row.fecha_fin
        let overlapFactor = 1.0
        if (latestDt && cutoffDt && fIniStr && fFinStr) {
          try {
            const fIniDt = parseLocalDate(fIniStr)
            const fFinDt = parseLocalDate(fFinStr)
            const rowDays = Math.max(Math.round((fFinDt.getTime() - fIniDt.getTime()) / (1000 * 60 * 60 * 24)), 1)
            const overlapStart = fIniDt > cutoffDt ? fIniDt : cutoffDt
            const overlapEnd = fFinDt < latestDt ? fFinDt : latestDt
            const overlapDays = Math.max(Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)), 0)
            overlapFactor = rowDays > 0 ? overlapDays / rowDays : 1.0
          } catch (e) {
            overlapFactor = 1.0
          }
        }

        for (let i = 1; i <= 6; i++) {
          const val = row[`activa_p${i}`]
          if (val !== null && val !== undefined) {
            annualKwh += (Number(val) / 1000.0) * overlapFactor
          }
        }
      }

      if (filteredRows.length > 0) {
        fechaFinTxt = filteredRows[0].fecha_fin || '-'
        fechaInicioTxt = filteredRows[filteredRows.length - 1].fecha_inicio || filteredRows[filteredRows.length - 1].fecha_fin || '-'
      }
    }
  }

  // Extraer potencias
  const potencias = {}
  let tarifa = null

  if (sipsData) {
    for (let i = 1; i <= 6; i++) {
      const pVal = sipsData[`potenciascontratadasenwp${i}`]
      if (pVal !== null && pVal !== undefined) {
        potencias[`p${i}`] = Number((Number(pVal) / 1000.0).toFixed(3))
      }
    }
    tarifa = sipsData.tarifa_texto || sipsData.codigotarifaatrenvigor || null
  }

  if (!sipsData && (!consumosData || consumosData.length === 0)) {
    return {
      found: false,
      cups: normalizedCups,
      source: 'supabase_energia',
      durationMs: Date.now() - startedAt
    }
  }

  return {
    found: true,
    cups: normalizedCups,
    annualKwh: Number(annualKwh.toFixed(2)),
    potencias: Object.keys(potencias).length > 0 ? potencias : undefined,
    tarifa: tarifa,
    source: 'supabase_energia',
    durationMs: Date.now() - startedAt,
    monthsFound: uniqueRows ? uniqueRows.length : 0,
    monthsUsed: filteredRows ? filteredRows.length : 0,
    rawRowsFound: consumosData ? consumosData.length : 0,
    windowStart: fechaInicioTxt,
    windowEnd: fechaFinTxt
  }
}

module.exports = {
  normalizeCups,
  hasConsumptionLookup,
  querySupabaseAnnualConsumption
}
