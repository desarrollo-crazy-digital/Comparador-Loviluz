#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

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

function getAnyEnv(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name]
  }
  return ''
}

function parseArgs(argv) {
  const args = {
    table: process.env.SUPABASE_CONSUMPTION_TABLE || 'comparator_consumption',
    batchSize: 1000,
    truncateDestination: false,
    dryRun: false,
    maxBatches: null
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--table') args.table = argv[++i]
    else if (arg === '--batch-size') args.batchSize = Number(argv[++i]) || args.batchSize
    else if (arg === '--truncate-destination') args.truncateDestination = true
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--max-batches') args.maxBatches = Number(argv[++i]) || null
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
  node scripts/migrate-consumption-between-supabase.mjs [opciones]

Opciones:
  --table <nombre>              Tabla origen/destino (default: comparator_consumption)
  --batch-size <n>              Filas por lote (default: 1000)
  --truncate-destination        Vacía el destino antes de copiar
  --max-batches <n>             Limita lotes para pruebas
  --dry-run                     Solo valida accesos y muestra conteos
  --help                        Muestra esta ayuda

Variables requeridas:
  SUPABASE_CONSUMPTION_SOURCE_URL
  SUPABASE_CONSUMPTION_SOURCE_SERVICE_ROLE_KEY
  SUPABASE_CONSUMPTION_URL
  SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY
`)
}

function getSourceConfig() {
  return {
    url: getAnyEnv([
      'SUPABASE_CONSUMPTION_SOURCE_URL',
      'SUPABASE_SOURCE_URL'
    ]),
    serviceKey: getAnyEnv([
      'SUPABASE_CONSUMPTION_SOURCE_SERVICE_ROLE_KEY',
      'SUPABASE_SOURCE_SERVICE_ROLE_KEY'
    ])
  }
}

function getDestinationConfig() {
  return {
    url: getAnyEnv([
      'SUPABASE_CONSUMPTION_URL',
      'VITE_SUPABASE_CONSUMPTION_URL',
      'SUPABASE_URL',
      'VITE_SUPABASE_URL'
    ]),
    serviceKey: getAnyEnv([
      'SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY',
      'VITE_SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'VITE_SUPABASE_SERVICE_ROLE_KEY'
    ])
  }
}

async function ensureTable(url, key, table) {
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
    `No se pudo acceder a la tabla "${table}" en ${url}. Respuesta: ${body}`
  )
}

async function countRows(url, key, table) {
  const response = await fetch(
    `${url}/rest/v1/${encodeURIComponent(table)}?select=cups&limit=1`,
    {
      method: 'HEAD',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'count=exact'
      }
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`No se pudo contar filas en ${table}: ${response.status} ${body}`)
  }

  const header = response.headers.get('content-range') || '0-0/0'
  const total = Number(header.split('/')[1] || 0)
  return Number.isFinite(total) ? total : 0
}

async function fetchBatch(url, key, table, offset, limit) {
  const response = await fetch(
    `${url}/rest/v1/${encodeURIComponent(table)}?select=*&order=cups.asc&offset=${offset}&limit=${limit}`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`No se pudo leer el lote origen: ${response.status} ${body}`)
  }

  return await response.json()
}

async function upsertBatch(url, key, table, rows) {
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
    throw new Error(`No se pudo escribir el lote destino: ${response.status} ${body}`)
  }
}

async function truncateTable(url, key, table) {
  const response = await fetch(
    `${url}/rest/v1/${encodeURIComponent(table)}?cups=not.is.null`,
    {
      method: 'DELETE',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=minimal'
      }
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`No se pudo vaciar el destino: ${response.status} ${body}`)
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
  const source = getSourceConfig()
  const destination = getDestinationConfig()

  if (!source.url) {
    throw new Error('Falta SUPABASE_CONSUMPTION_SOURCE_URL o SUPABASE_SOURCE_URL')
  }
  if (!source.serviceKey) {
    throw new Error(
      'Falta SUPABASE_CONSUMPTION_SOURCE_SERVICE_ROLE_KEY o SUPABASE_SOURCE_SERVICE_ROLE_KEY'
    )
  }
  if (!destination.url) {
    throw new Error(
      'Falta SUPABASE_CONSUMPTION_URL o VITE_SUPABASE_CONSUMPTION_URL'
    )
  }
  if (!destination.serviceKey) {
    throw new Error(
      'Falta SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY o VITE_SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY'
    )
  }

  await ensureTable(source.url, source.serviceKey, args.table)
  await ensureTable(destination.url, destination.serviceKey, args.table)

  const sourceCount = await countRows(source.url, source.serviceKey, args.table)
  const destinationBefore = await countRows(destination.url, destination.serviceKey, args.table)

  console.log(`Tabla: ${args.table}`)
  console.log(`Origen: ${sourceCount} filas`)
  console.log(`Destino antes: ${destinationBefore} filas`)

  if (args.dryRun) {
    console.log('Dry run completado. No se copiaron filas.')
    return
  }

  if (args.truncateDestination) {
    console.log('Vaciando destino...')
    await truncateTable(destination.url, destination.serviceKey, args.table)
    console.log('Destino vaciado.')
  }

  let offset = 0
  let copied = 0
  let batches = 0

  while (true) {
    const rows = await fetchBatch(source.url, source.serviceKey, args.table, offset, args.batchSize)
    if (!Array.isArray(rows) || rows.length === 0) break

    await upsertBatch(destination.url, destination.serviceKey, args.table, rows)

    copied += rows.length
    batches += 1
    offset += rows.length

    console.log(
      `[${formatPercent(copied, sourceCount)}%] ${copied}/${sourceCount} filas copiadas (lote ${batches})`
    )

    if (args.maxBatches && batches >= args.maxBatches) {
      console.log('Parada por --max-batches')
      break
    }
  }

  const destinationAfter = await countRows(destination.url, destination.serviceKey, args.table)
  console.log(`Destino después: ${destinationAfter} filas`)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
