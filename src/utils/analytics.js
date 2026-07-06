const GA_MEASUREMENT_ID = 'G-GDZL3F61E2'
const GA_COMMERCIAL_CODE_KEY = 'ga_commercial_code'

function safeWindow() {
  if (typeof window === 'undefined') return null
  return window
}

function pushToDataLayer(args) {
  const w = safeWindow()
  if (!w) return
  w.dataLayer = w.dataLayer || []
  w.dataLayer.push(args)
}

export function ga(...args) {
  const w = safeWindow()
  if (!w) return
  if (typeof w.gtag === 'function') {
    w.gtag(...args)
    return
  }
  pushToDataLayer(args)
}

async function sha256Hex(text) {
  const w = safeWindow()
  if (!w?.crypto?.subtle || typeof TextEncoder === 'undefined') return null
  const bytes = new TextEncoder().encode(text)
  const digest = await w.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function getOrCreateUserId(commercialCode) {
  const w = safeWindow()
  if (!w) return null
  const keyId = 'ga_user_id'
  const keyCode = 'ga_user_code'
  const incoming = String(commercialCode || '').trim()
  const existingCode = w.sessionStorage?.getItem?.(keyCode) || ''
  const existingId = w.sessionStorage?.getItem?.(keyId)
  if (existingId && existingCode && existingCode === incoming) return existingId

  const hashed = await sha256Hex(incoming)
  if (!hashed) return null

  try {
    w.sessionStorage?.setItem?.(keyId, hashed)
    w.sessionStorage?.setItem?.(keyCode, incoming)
  } catch {}
  return hashed
}

export function gaClearUser() {
  const w = safeWindow()
  if (!w) return
  try {
    w.sessionStorage?.removeItem?.('ga_user_id')
    w.sessionStorage?.removeItem?.('ga_user_code')
    w.sessionStorage?.removeItem?.(GA_COMMERCIAL_CODE_KEY)
  } catch {}
}

export async function gaIdentifyCommercial({ commercialCode, role }) {
  const code = String(commercialCode || '').trim()
  const w = safeWindow()
  if (w && code) {
    try { w.sessionStorage?.setItem?.(GA_COMMERCIAL_CODE_KEY, code) } catch {}
  }
  const userId = await getOrCreateUserId(commercialCode)
  if (userId) {
    ga('config', GA_MEASUREMENT_ID, { user_id: userId })
    ga('set', 'user_properties', {
      role: role || 'commercial',
      commercial_code: code || undefined,
      comercial_code: code || undefined
    })
  }
}

export function gaEvent(eventName, params = {}) {
  if (!eventName) return
  const w = safeWindow()
  const code = w?.sessionStorage?.getItem?.(GA_COMMERCIAL_CODE_KEY) || ''
  const enriched = {
    ...params,
    commercial_code: params?.commercial_code || code || undefined,
    comercial_code: params?.comercial_code || params?.commercial_code || code || undefined
  }

  ga('event', eventName, enriched)

  // Backward compatibility for existing GA4 explorations and custom reports.
  if (eventName === 'calculate_success') {
    ga('event', 'comparativa_calculada', enriched)
  } else if (eventName === 'offer_pdf_download') {
    ga('event', 'descarga_pdf', enriched)
  }
}
