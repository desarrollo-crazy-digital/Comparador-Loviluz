#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_PS_CSV =
  '/Volumes/easystore/actualización abril/202606_SIPS2026_PS_ELECTRICIDAD_peninsular.csv'

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
    csvPath: DEFAULT_PS_CSV,
    table: process.env.SUPABASE_PS_TABLE || 'puntos_suministro',
    batchSize: 1000,
    startAfter: '',
    maxRows: null,
    maxScanned: null,
    dryRun: false
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--csv-path') args.csvPath = argv[++i]
    else if (arg === '--table') args.table = argv[++i]
    else if (arg === '--batch-size') args.batchSize = Number(argv[++i]) || args.batchSize
    else if (arg === '--start-after') args.startAfter = String(argv[++i] || '').trim().toUpperCase()
    else if (arg === '--max-rows') args.maxRows = Number(argv[++i]) || null
    else if (arg === '--max-scanned') args.maxScanned = Number(argv[++i]) || null
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--help') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Argumento no reconocido: ${arg}`)
    }
  }

  return args
}

function printHelp() {
  console.log(`
Uso:
  node scripts/update-puntos-suministro-from-ps.mjs [opciones]

Opciones:
  --csv-path <ruta>     CSV PS origen (default: ${DEFAULT_PS_CSV})
  --table <nombre>      Tabla destino (default: puntos_suministro)
  --batch-size <n>      Filas por lote (default: 1000)
  --start-after <cups>  Reanuda despues de este CUPS
  --max-rows <n>        Limita filas candidatas para pruebas
  --max-scanned <n>     Limita filas leidas del CSV para pruebas rapidas
  --dry-run             Lee el CSV y muestra muestra, sin subir a Supabase
  --help                Muestra esta ayuda

Variables:
  ENERGIA_SUPABASE_URL / VITE_ENERGIA_SUPABASE_URL / VITE_SUPABASE_URL
  ENERGIA_SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY
  SUPABASE_PS_TABLE opcional
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
    'ENERGIA_SUPABASE_URL',
    'VITE_ENERGIA_SUPABASE_URL',
    'SUPABASE_URL',
    'VITE_SUPABASE_URL'
  ])
}

function getSupabaseKey() {
  return getAnyEnv([
    'ENERGIA_SUPABASE_KEY',
    'VITE_ENERGIA_SUPABASE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VITE_SUPABASE_SERVICE_ROLE_KEY',
    'VITE_SUPABASE_ANON_KEY'
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
  const text = String(value || '').trim()
  return text ? text.replace(/\s+/g, ' ') : ''
}

function normalizeCups(value) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, '')
}

function buildDireccion(row) {
  return [
    row.tipoViaPS,
    row.viaPS,
    row.numFincaPS
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ')
}

function rowFromValues(header, values) {
  const row = {}
  for (let i = 0; i < header.length; i += 1) {
    row[header[i]] = values[i] ?? ''
  }

  const cups = normalizeCups(row.cups)
  if (!cups) return null

  const normalized = { cups }
  const referenciaCatastral = normalizeText(row.referenciaCatastralPS)
  const direccion = buildDireccion(row)

  if (referenciaCatastral) normalized.referencia_catastral = referenciaCatastral
  if (direccion) normalized.direccion = direccion

  return Object.keys(normalized).length > 1 ? normalized : null
}

async function ensureRemoteTable(url, key, table) {
  const response = await fetch(
    `${url}/rest/v1/${encodeURIComponent(table)}?select=cups&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    }
  )

  if (response.ok) return

  const body = await response.text()
  throw new Error(
    `No se pudo acceder a "${table}". Ejecuta supabase/puntos_suministro.sql si faltan columnas. Respuesta: ${body}`
  )
}

async function uploadBatch(url, key, table, rows) {
  const response = await fetch(
    `${url}/rest/v1/${encodeURIComponent(table)}?on_conflict=cups`,
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(rows)
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Error subiendo lote a Supabase: ${response.status} ${body.slice(0, 500)}`)
  }
}

async function main() {
  loadEnvFile(path.resolve('.env'))
  loadEnvFile(path.resolve('.env.local'))

  const args = parseArgs(process.argv.slice(2))
  const csvPath = path.resolve(args.csvPath)
  if (!fs.existsSync(csvPath)) throw new Error(`No existe el CSV PS: ${csvPath}`)

  const supabaseUrl = getSupabaseUrl()
  const supabaseKey = getSupabaseKey()
  if (!args.dryRun) {
    if (!supabaseUrl) throw new Error('Falta URL de Supabase en .env')
    if (!supabaseKey) throw new Error('Falta key de Supabase en .env')
    await ensureRemoteTable(supabaseUrl, supabaseKey, args.table)
  }

  const stream = fs.createReadStream(csvPath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let header = null
  let scanned = 0
  let processed = 0
  let uploaded = 0
  let skipped = 0
  let batch = []
  let lastCups = ''
  let sample = null

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line.replace(/^\uFEFF/, ''))
      continue
    }

    scanned += 1
    const row = rowFromValues(header, parseCsvLine(line))
    if (!row) {
      skipped += 1
      if (args.maxScanned && scanned >= args.maxScanned) {
        rl.close()
        stream.destroy()
        break
      }
      continue
    }
    if (args.startAfter && row.cups <= args.startAfter) continue

    processed += 1
    lastCups = row.cups
    if (!sample) sample = row
    batch.push(row)

    if (args.dryRun && args.maxRows && processed >= args.maxRows) {
      rl.close()
      stream.destroy()
      break
    }
    if (args.maxScanned && scanned >= args.maxScanned) {
      rl.close()
      stream.destroy()
      break
    }

    if (!args.dryRun && batch.length >= args.batchSize) {
      await uploadBatch(supabaseUrl, supabaseKey, args.table, batch)
      uploaded += batch.length
      console.log(`Subidas ${uploaded} filas. Ultimo CUPS: ${lastCups}`)
      batch = []
    }

    if (!args.dryRun && args.maxRows && processed >= args.maxRows) {
      rl.close()
      stream.destroy()
      break
    }
    if (!args.dryRun && args.maxScanned && scanned >= args.maxScanned) {
      rl.close()
      stream.destroy()
      break
    }
  }

  if (!args.dryRun && batch.length > 0) {
    await uploadBatch(supabaseUrl, supabaseKey, args.table, batch)
    uploaded += batch.length
  }

  console.log(`CSV PS: ${csvPath}`)
  console.log(`Tabla destino: ${args.table}`)
  console.log(`Leidas: ${scanned}`)
  console.log(`Procesadas: ${processed}`)
  console.log(`Saltadas sin campos nuevos: ${skipped}`)
  console.log(`Ultimo CUPS: ${lastCups || '-'}`)
  if (sample) console.log(`Muestra: ${JSON.stringify(sample, null, 2)}`)
  if (args.dryRun) console.log('Dry run completado. No se subieron filas.')
  else console.log(`Subidas: ${uploaded}`)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
