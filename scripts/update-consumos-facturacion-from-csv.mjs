#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_CSV =
  '/Volumes/easystore/actualización abril/202606_SIPS2026_CONSUMOS_ELECTRICIDAD_peninsular.csv'

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIndex = line.indexOf('=')
    if (eqIndex === -1) continue
    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function parseArgs(argv) {
  const args = {
    mode: 'compare',
    csvPath: DEFAULT_CSV,
    table: process.env.SUPABASE_CONSUMOS_TABLE || 'consumos_facturacion',
    batchSize: 500,
    sampleSize: 25,
    startLine: 1,
    maxScanRows: null,
    maxUploadRows: null,
    minFechaFin: '',
    allowFullUpload: false,
    dryRun: false
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--mode') args.mode = argv[++i]
    else if (arg === '--csv-path') args.csvPath = argv[++i]
    else if (arg === '--table') args.table = argv[++i]
    else if (arg === '--batch-size') args.batchSize = Number(argv[++i]) || args.batchSize
    else if (arg === '--sample-size') args.sampleSize = Number(argv[++i]) || args.sampleSize
    else if (arg === '--start-line') args.startLine = Number(argv[++i]) || args.startLine
    else if (arg === '--max-scan-rows') args.maxScanRows = Number(argv[++i]) || null
    else if (arg === '--max-upload-rows') args.maxUploadRows = Number(argv[++i]) || null
    else if (arg === '--min-fecha-fin') args.minFechaFin = argv[++i] || ''
    else if (arg === '--allow-full-upload') args.allowFullUpload = true
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--help') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Argumento no reconocido: ${arg}`)
    }
  }

  if (!['compare', 'upload'].includes(args.mode)) {
    throw new Error('--mode debe ser compare o upload')
  }

  return args
}

function printHelp() {
  console.log(`
Uso:
  node scripts/update-consumos-facturacion-from-csv.mjs [opciones]

Opciones:
  --mode compare|upload      Compara muestra o sube por lotes (default: compare)
  --csv-path <ruta>          CSV de consumos origen
  --table <nombre>           Tabla destino (default: consumos_facturacion)
  --min-fecha-fin <YYYY-MM-DD> Solo procesa lecturas con fecha_fin >= valor
  --start-line <n>           Reanuda desde linea de datos n (default: 1)
  --max-scan-rows <n>        Limita filas leidas del CSV
  --sample-size <n>          Filas candidatas para comparar (default: 25)
  --batch-size <n>           Filas por lote al subir (default: 500)
  --max-upload-rows <n>      Limita filas subidas en pruebas
  --allow-full-upload        Permite upload sin --min-fecha-fin
  --dry-run                  En upload, normaliza y cuenta sin escribir
  --help                     Muestra esta ayuda

Variables:
  SUPABASE_ENERGIA_URL / SUPABASE_URL
  Compare: SUPABASE_ENERGIA_KEY / SUPABASE_ANON_KEY
  Upload: SUPABASE_ENERGIA_SERVICE_ROLE_KEY
`)
}

function getAnyEnv(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name]
  }
  return ''
}

function getSupabaseUrl() {
  return getAnyEnv([
    'SUPABASE_ENERGIA_URL',
    'ENERGIA_SUPABASE_URL',
    'SUPABASE_URL',
    'VITE_SUPABASE_URL'
  ])
}

function getSupabaseReadKey() {
  return getAnyEnv([
    'SUPABASE_ENERGIA_SERVICE_ROLE_KEY',
    'SUPABASE_ENERGIA_KEY',
    'SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
  ])
}

function getSupabaseWriteKey() {
  return getAnyEnv([
    'SUPABASE_ENERGIA_SERVICE_ROLE_KEY',
    'ENERGIA_SUPABASE_SERVICE_ROLE_KEY'
  ])
}

function parseCsvLine(line) {
  const values = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      values.push(current)
      current = ''
    } else {
      current += char
    }
  }
  values.push(current)
  return values
}

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeCups(value) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, '')
}

function numberOrNull(value) {
  const text = normalizeText(value)
  if (!text) return null
  const parsed = Number(text.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function rowFromValues(header, values, minFechaFin) {
  const raw = {}
  for (let i = 0; i < header.length; i += 1) raw[header[i]] = values[i] ?? ''

  const cups = normalizeCups(raw.cups)
  const fechaInicio = normalizeText(raw.fechaInicioMesConsumo)
  const fechaFin = normalizeText(raw.fechaFinMesConsumo)
  if (!cups || !fechaInicio || !fechaFin) return null
  if (minFechaFin && fechaFin < minFechaFin) return null

  return {
    cups,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    tarifa: normalizeText(raw.codigoTarifaATR) || null,
    activa_p1: numberOrNull(raw.consumoEnergiaActivaEnWhP1),
    activa_p2: numberOrNull(raw.consumoEnergiaActivaEnWhP2),
    activa_p3: numberOrNull(raw.consumoEnergiaActivaEnWhP3),
    activa_p4: numberOrNull(raw.consumoEnergiaActivaEnWhP4),
    activa_p5: numberOrNull(raw.consumoEnergiaActivaEnWhP5),
    activa_p6: numberOrNull(raw.consumoEnergiaActivaEnWhP6),
    reactiva_p1: numberOrNull(raw.consumoEnergiaReactivaInductivaEnVArhP1),
    reactiva_p2: numberOrNull(raw.consumoEnergiaReactivaInductivaEnVArhP2),
    reactiva_p3: numberOrNull(raw.consumoEnergiaReactivaInductivaEnVArhP3),
    reactiva_p4: numberOrNull(raw.consumoEnergiaReactivaInductivaEnVArhP4),
    reactiva_p5: numberOrNull(raw.consumoEnergiaReactivaInductivaEnVArhP5),
    reactiva_p6: numberOrNull(raw.consumoEnergiaReactivaInductivaEnVArhP6),
    potencia_p1: numberOrNull(raw.potenciaDemandadaEnWP1),
    potencia_p2: numberOrNull(raw.potenciaDemandadaEnWP2),
    potencia_p3: numberOrNull(raw.potenciaDemandadaEnWP3),
    potencia_p4: numberOrNull(raw.potenciaDemandadaEnWP4),
    potencia_p5: numberOrNull(raw.potenciaDemandadaEnWP5),
    potencia_p6: numberOrNull(raw.potenciaDemandadaEnWP6),
    tipo_equipo: normalizeText(raw.codigoDHEquipoDeMedida) || null,
    tipo_lectura: normalizeText(raw.codigoTipoLectura) || null
  }
}

function sameRemoteRow(local, remote) {
  if (!remote) return false
  const fields = [
    'tarifa',
    'activa_p1',
    'activa_p2',
    'activa_p3',
    'activa_p4',
    'activa_p5',
    'activa_p6',
    'reactiva_p1',
    'reactiva_p2',
    'reactiva_p3',
    'reactiva_p4',
    'reactiva_p5',
    'reactiva_p6',
    'potencia_p1',
    'potencia_p2',
    'potencia_p3',
    'potencia_p4',
    'potencia_p5',
    'potencia_p6',
    'tipo_equipo',
    'tipo_lectura'
  ]
  return fields.every((field) => String(local[field] ?? '') === String(remote[field] ?? ''))
}

async function fetchRemoteRow(url, key, table, row) {
  const params = new URLSearchParams()
  params.set('select', '*')
  params.set('cups', `eq.${row.cups}`)
  params.set('fecha_inicio', `eq.${row.fecha_inicio}`)
  params.set('fecha_fin', `eq.${row.fecha_fin}`)
  if (row.tipo_lectura) params.set('tipo_lectura', `eq.${row.tipo_lectura}`)
  params.set('limit', '1')

  const response = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?${params}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Error consultando Supabase: ${response.status} ${body.slice(0, 300)}`)
  }

  const rows = await response.json()
  return rows[0] || null
}

async function ensureRemoteTable(url, key, table) {
  const response = await fetch(
    `${url}/rest/v1/${encodeURIComponent(table)}?select=cups,fecha_inicio,fecha_fin,tipo_lectura&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    }
  )

  if (response.ok) return

  const body = await response.text()
  throw new Error(`No se pudo acceder a ${table}: ${response.status} ${body.slice(0, 500)}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function insertBatch(url, key, table, rows) {
  if (rows.length === 0) return
  const endpoint = `${url}/rest/v1/${encodeURIComponent(table)}`
  const backoffsMs = [2000, 5000, 15000, 30000]

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(rows)
    })

    if (response.ok) return

    const body = await response.text()
    const retriable = response.status === 429 || response.status >= 500
    if (!retriable || attempt === 5) {
      throw new Error(`Error insertando lote: ${response.status} ${body.slice(0, 500)}`)
    }

    const delay = backoffsMs[attempt - 1]
    console.warn(`Lote falló con ${response.status}. Reintentando en ${delay}ms`)
    await sleep(delay)
  }
}

async function updateRemoteRow(url, key, table, row) {
  const params = new URLSearchParams()
  params.set('cups', `eq.${row.cups}`)
  params.set('fecha_inicio', `eq.${row.fecha_inicio}`)
  params.set('fecha_fin', `eq.${row.fecha_fin}`)
  if (row.tipo_lectura) params.set('tipo_lectura', `eq.${row.tipo_lectura}`)

  const response = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?${params}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(row)
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Error actualizando fila: ${response.status} ${body.slice(0, 500)}`)
  }
}

async function writeCheckedBatch(url, key, table, rows) {
  const missing = []
  let identical = 0
  let updated = 0

  for (const row of rows) {
    const remote = await fetchRemoteRow(url, key, table, row)
    if (!remote) {
      missing.push(row)
    } else if (sameRemoteRow(row, remote)) {
      identical += 1
    } else {
      await updateRemoteRow(url, key, table, row)
      updated += 1
    }
  }

  await insertBatch(url, key, table, missing)
  return { inserted: missing.length, updated, identical }
}

async function openCsv(csvPath) {
  const stream = fs.createReadStream(csvPath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  return { stream, rl }
}

async function compare(args, url, key) {
  const { stream, rl } = await openCsv(args.csvPath)
  let header = null
  let scanned = 0
  let sampled = 0
  let existing = 0
  let missing = 0
  let different = 0
  let firstMissing = null
  let firstDifferent = null

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line.replace(/^\uFEFF/, ''))
      continue
    }

    scanned += 1
    if (scanned < args.startLine) continue
    if (args.maxScanRows && scanned > args.maxScanRows) {
      rl.close()
      stream.destroy()
      break
    }

    const row = rowFromValues(header, parseCsvLine(line), args.minFechaFin)
    if (!row) continue

    const remote = await fetchRemoteRow(url, key, args.table, row)
    sampled += 1
    if (!remote) {
      missing += 1
      if (!firstMissing) firstMissing = row
    } else if (sameRemoteRow(row, remote)) {
      existing += 1
    } else {
      different += 1
      if (!firstDifferent) firstDifferent = { local: row, remote }
    }

    if (sampled >= args.sampleSize) {
      rl.close()
      stream.destroy()
      break
    }
  }

  console.log(`CSV: ${args.csvPath}`)
  console.log(`Tabla: ${args.table}`)
  console.log(`Leidas: ${scanned}`)
  console.log(`Muestra comparada: ${sampled}`)
  console.log(`Ya iguales en Supabase: ${existing}`)
  console.log(`Faltan en Supabase: ${missing}`)
  console.log(`Distintas en Supabase: ${different}`)
  if (firstMissing) console.log(`Primera faltante: ${JSON.stringify(firstMissing, null, 2)}`)
  if (firstDifferent) console.log(`Primera distinta: ${JSON.stringify(firstDifferent, null, 2)}`)
}

async function upload(args, url, key) {
  const { stream, rl } = await openCsv(args.csvPath)
  let header = null
  let scanned = 0
  let candidates = 0
  let uploaded = 0
  let inserted = 0
  let updated = 0
  let identical = 0
  let batch = []
  let lastLine = 0

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line.replace(/^\uFEFF/, ''))
      continue
    }

    scanned += 1
    if (scanned < args.startLine) continue
    if (args.maxScanRows && scanned > args.maxScanRows) {
      rl.close()
      stream.destroy()
      break
    }

    const row = rowFromValues(header, parseCsvLine(line), args.minFechaFin)
    if (!row) continue

    candidates += 1
    batch.push(row)
    lastLine = scanned

    if (batch.length >= args.batchSize) {
      if (!args.dryRun) {
        const result = await writeCheckedBatch(url, key, args.table, batch)
        inserted += result.inserted
        updated += result.updated
        identical += result.identical
      }
      uploaded += batch.length
      console.log(`Procesadas ${uploaded} candidatas. Ultima linea: ${lastLine}`)
      batch = []
    }

    if (args.maxUploadRows && uploaded + batch.length >= args.maxUploadRows) {
      rl.close()
      stream.destroy()
      break
    }
  }

  if (batch.length > 0) {
    if (!args.dryRun) {
      const result = await writeCheckedBatch(url, key, args.table, batch)
      inserted += result.inserted
      updated += result.updated
      identical += result.identical
    }
    uploaded += batch.length
  }

  console.log(`CSV: ${args.csvPath}`)
  console.log(`Tabla: ${args.table}`)
  console.log(`Leidas: ${scanned}`)
  console.log(`Candidatas: ${candidates}`)
  console.log(args.dryRun ? `Dry run. Filas que se subirian: ${uploaded}` : `Subidas/actualizadas: ${uploaded}`)
  if (!args.dryRun) {
    console.log(`Insertadas: ${inserted}`)
    console.log(`Actualizadas: ${updated}`)
    console.log(`Ya iguales: ${identical}`)
  }
  console.log(`Para reanudar, usa --start-line ${lastLine || args.startLine}`)
}

async function main() {
  loadEnvFile(path.resolve('.env'))
  loadEnvFile(path.resolve('.env.local'))

  const args = parseArgs(process.argv.slice(2))
  args.csvPath = path.resolve(args.csvPath)
  if (!fs.existsSync(args.csvPath)) throw new Error(`No existe el CSV: ${args.csvPath}`)

  const url = getSupabaseUrl()
  const needsWrite = args.mode === 'upload' && !args.dryRun
  const key = needsWrite ? getSupabaseWriteKey() : getSupabaseReadKey()
  if (!url) throw new Error('Falta SUPABASE_ENERGIA_URL o SUPABASE_URL')
  if (!key && needsWrite) {
    throw new Error('Falta SUPABASE_ENERGIA_SERVICE_ROLE_KEY para escribir en Supabase energia')
  }
  if (!key) throw new Error('Falta key de Supabase para comparar')
  if (args.mode === 'upload' && !args.minFechaFin && !args.allowFullUpload) {
    throw new Error(
      'Por seguridad, upload requiere --min-fecha-fin YYYY-MM-DD. ' +
        'Usa --allow-full-upload solo si quieres recorrer todo el CSV.'
    )
  }

  await ensureRemoteTable(url, key, args.table)
  if (args.mode === 'compare') await compare(args, url, key)
  else await upload(args, url, key)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
