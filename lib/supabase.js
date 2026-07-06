const { createClient } = require('@supabase/supabase-js')

function getEnv(name) {
  return process.env[name] || ''
}

function getSupabaseUrl() {
  const url =
    getEnv('SUPABASE_URL') ||
    getEnv('VITE_SUPABASE_URL') ||
    getEnv('ENERGIA_SUPABASE_URL') ||
    getEnv('VITE_ENERGIA_SUPABASE_URL')
  if (!url) {
    const err = new Error('Supabase no configurado (faltan SUPABASE_URL/SUPABASE_ANON_KEY o VITE_SUPABASE_*)')
    err.statusCode = 500
    throw err
  }
  return url
}

function getSupabaseClient() {
  const url = getSupabaseUrl()
  const key =
    getEnv('SUPABASE_ANON_KEY') ||
    getEnv('VITE_SUPABASE_ANON_KEY') ||
    getEnv('ENERGIA_SUPABASE_KEY') ||
    getEnv('VITE_ENERGIA_SUPABASE_KEY')
  if (!key) {
    const err = new Error('Supabase no configurado (faltan SUPABASE_ANON_KEY o VITE_SUPABASE_ANON_KEY)')
    err.statusCode = 500
    throw err
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

function getSupabaseAdminClient() {
  const url = getSupabaseUrl()
  const key =
    getEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    getEnv('SUPABASE_ANON_KEY') ||
    getEnv('VITE_SUPABASE_ANON_KEY') ||
    getEnv('ENERGIA_SUPABASE_KEY') ||
    getEnv('VITE_ENERGIA_SUPABASE_KEY')
  if (!key) {
    const err = new Error('Supabase no configurado (faltan SUPABASE_SERVICE_ROLE_KEY o SUPABASE_ANON_KEY)')
    err.statusCode = 500
    throw err
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

module.exports = { getSupabaseClient, getSupabaseAdminClient }

