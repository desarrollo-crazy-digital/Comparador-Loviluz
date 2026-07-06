#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

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
    sqlitePath: 'sips_comparator.sqlite',
    table: process.env.SUPABASE_CONSUMPTION_TABLE || 'comparator_consumption',
    batchSize: 1000,
    startAfter: '',
    maxBatches: null,
    dryRun: false,
    truncate: false
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--sqlite-path') args.sqlitePath = argv[++i]
    else if (arg === '--table') args.table = argv[++i]
    else if (arg === '--batch-size') args.batchSize = Number(argv[++i]) || args.batchSize
    else if (arg === '--start-after') args.startAfter = argv[++i] || ''
    else if (arg === '--max-batches') args.maxBatches = Number(argv[++i]) || null
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--truncate') args.truncate = true
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
  node scripts/upload-consumption-to-supabase.mjs [opciones]

Opciones:
  --sqlite-path <ruta>   Ruta a sips_comparator.sqlite
  --table <nombre>       Tabla destino en Supabase
  --batch-size <n>       Filas por lote (default: 1000)
  --start-after <cups>   Reanuda despues de este CUPS
  --max-batches <n>      Limita lotes para pruebas
  --truncate             Vacía la tabla remota antes de subir
  --dry-run              Lee la SQLite pero no sube datos
  --help                 Muestra esta ayuda
`)
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Falta la variable de entorno ${name}`)
  return value
}

function getAnyEnv(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name]
  }
  return ''
}

function getConsumptionSupabaseUrl() {
  return getAnyEnv([
    'SUPABASE_CONSUMPTION_URL',
    'VITE_SUPABASE_CONSUMPTION_URL',
    'SUPABASE_URL',
    'VITE_SUPABASE_URL'
  ])
}

function getConsumptionServiceRoleKey() {
  return getAnyEnv([
    'SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY',
    'VITE_SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VITE_SUPABASE_SERVICE_ROLE_KEY'
  ])
}

function runPython(sqlitePath, code, args = []) {
  return execFileSync('python3', ['-c', code, sqlitePath, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 32
  }).trim()
}

function getRowCount(sqlitePath) {
  const code = `
import sqlite3, sys
conn = sqlite3.connect(sys.argv[1])
cur = conn.cursor()
query = "SELECT COUNT(*) FROM comparator_consumption"
print(cur.execute(query).fetchone()[0])
conn.close()
`
  return Number(runPython(sqlitePath, code)) || 0
}

function getBatch(sqlitePath, startAfter, batchSize) {
  const code = `
import sqlite3, json, sys
conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
start_after = sys.argv[2]
batch_size = int(sys.argv[3])
cur = conn.cursor()
query = """
SELECT cups, annual_kwh
FROM comparator_consumption
WHERE cups > ?
"""
params = [start_after]
query += " ORDER BY cups LIMIT ?"
params.append(batch_size)
rows = cur.execute(query, params).fetchall()
print(json.dumps([dict(row) for row in rows], ensure_ascii=False))
conn.close()
`
  const raw = runPython(sqlitePath, code, [startAfter, String(batchSize)])
  return raw ? JSON.parse(raw) : []
}

function normalizeRows(rows) {
  return rows.map((row) => ({
    cups: String(row.cups || '').trim().toUpperCase(),
    annual_kwh: Number(row.annual_kwh) || 0
  }))
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
    `No se pudo acceder a la tabla remota "${table}". ` +
      `Crea primero la tabla con supabase/comparator_consumption.sql. Respuesta: ${body}`
  )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function uploadBatch(url, key, table, rows) {
  const endpoint = `${url}/rest/v1/${encodeURIComponent(table)}?on_conflict=cups`
  const maxAttempts = 5
  const backoffsMs = [2000, 5000, 15000, 30000]
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(rows)
      })
    } catch (err) {
      lastError = err
      if (attempt === maxAttempts) break
      const delay = backoffsMs[attempt - 1]
      console.warn(`Lote falló por red (${err.message}). Reintentando en ${delay}ms (intento ${attempt + 1}/${maxAttempts})`)
      await sleep(delay)
      continue
    }

    if (response.ok) return

    const body = await response.text()
    const status = response.status
    const retriable = status === 429 || status >= 500
    lastError = new Error(`HTTP ${status}: ${body.slice(0, 200)}`)

    if (!retriable || attempt === maxAttempts) {
      throw new Error(`Error subiendo lote a Supabase: ${status} ${body.slice(0, 500)}`)
    }

    const delay = backoffsMs[attempt - 1]
    console.warn(`Lote falló con ${status}. Reintentando en ${delay}ms (intento ${attempt + 1}/${maxAttempts})`)
    await sleep(delay)
  }

  throw lastError || new Error('Error subiendo lote a Supabase tras reintentos')
}

async function truncateRemoteTable(url, key, table) {
  const endpoint = `${url}/rest/v1/${encodeURIComponent(table)}?cups=not.is.null`
  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=minimal'
    }
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Error vaciando la tabla remota: ${response.status} ${body}`)
  }
}

function formatPercent(done, total) {
  if (!total) return '0.00'
  return ((done / total) * 100).toFixed(2)
}

async function main() {
  loadEnvFile(path.resolve('.env'))
  loadEnvFile(path.resolve('.env.local'))

  const args = parseArgs(process.argv.slice(2))
  const sqlitePath = path.resolve(args.sqlitePath)
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`No existe la base SQLite: ${sqlitePath}`)
  }

  const totalRows = getRowCount(sqlitePath)
  console.log(`SQLite origen: ${sqlitePath}`)
  console.log(`Tabla destino: ${args.table}`)
  console.log(`Filas locales: ${totalRows}`)

  if (args.dryRun) {
    const sample = normalizeRows(
      getBatch(sqlitePath, args.startAfter, Math.min(args.batchSize, 3))
    )
    console.log('Dry run: primeras filas normalizadas')
    console.log(JSON.stringify(sample, null, 2))
    return
  }

  const supabaseUrl = getConsumptionSupabaseUrl()
  if (!supabaseUrl) {
    throw new Error(
      'Falta SUPABASE_CONSUMPTION_URL o VITE_SUPABASE_CONSUMPTION_URL en .env'
    )
  }
  const serviceKey = getConsumptionServiceRoleKey()
  if (!serviceKey) {
    throw new Error(
      'Falta SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY o VITE_SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY en .env para cargar datos a Supabase'
    )
  }

  await ensureRemoteTable(supabaseUrl, serviceKey, args.table)
  if (args.truncate) {
    console.log(`Vaciando tabla remota ${args.table}...`)
    await truncateRemoteTable(supabaseUrl, serviceKey, args.table)
    console.log('Tabla remota vaciada.')
  }

  let uploaded = 0
  let batches = 0
  let lastCups = args.startAfter || ''

  while (true) {
    const batch = normalizeRows(getBatch(sqlitePath, lastCups, args.batchSize))
    if (batch.length === 0) break

    await uploadBatch(supabaseUrl, serviceKey, args.table, batch)

    uploaded += batch.length
    batches += 1
    lastCups = batch[batch.length - 1].cups

    console.log(
      `[${formatPercent(uploaded, totalRows)}%] ${uploaded}/${totalRows} filas subidas ` +
        `(lote ${batches}, ultimo CUPS: ${lastCups})`
    )

    if (args.maxBatches && batches >= args.maxBatches) {
      console.log('Parada por --max-batches')
      break
    }
  }

  console.log(`Carga finalizada. Filas subidas: ${uploaded}`)
  console.log(`Ultimo CUPS procesado: ${lastCups || '<inicio>'}`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
