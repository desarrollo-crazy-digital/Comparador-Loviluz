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
    throw new Error(`No se pudo contar filas remotas: ${response.status} ${body}`)
  }

  const header = response.headers.get('content-range') || '0-0/0'
  const total = Number(header.split('/')[1] || 0)
  return Number.isFinite(total) ? total : 0
}

async function deleteAllRows(url, key, table) {
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
    throw new Error(`No se pudo vaciar la tabla remota: ${response.status} ${body}`)
  }
}

async function main() {
  loadEnvFile(path.resolve('.env'))
  loadEnvFile(path.resolve('.env.local'))

  const supabaseUrl = getConsumptionSupabaseUrl()
  const serviceKey = getConsumptionServiceRoleKey()
  const table = process.env.SUPABASE_CONSUMPTION_TABLE || 'comparator_consumption'

  if (!supabaseUrl) {
    throw new Error(
      'Falta SUPABASE_CONSUMPTION_URL o VITE_SUPABASE_CONSUMPTION_URL'
    )
  }
  if (!serviceKey) {
    throw new Error(
      'Falta SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY o VITE_SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY'
    )
  }

  const before = await countRows(supabaseUrl, serviceKey, table)
  console.log(`Tabla remota: ${table}`)
  console.log(`Filas antes: ${before}`)

  await deleteAllRows(supabaseUrl, serviceKey, table)

  const after = await countRows(supabaseUrl, serviceKey, table)
  console.log(`Filas después: ${after}`)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
