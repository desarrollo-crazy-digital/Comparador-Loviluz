const PDF_STORAGE_KEY = 'comparador:pdf-downloads'
const MAX_PDF_ENTRIES = 300
const MAX_AGE_DAYS = 7

const safeJsonParse = (raw, fallback) => {
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

const nowIso = () => new Date().toISOString()

const loadAll = () => {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(PDF_STORAGE_KEY)
  const parsed = safeJsonParse(raw, [])
  return Array.isArray(parsed) ? parsed : []
}

const saveAll = (items) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PDF_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_PDF_ENTRIES)))
}

const retentionCutoff = (days = MAX_AGE_DAYS) => Date.now() - days * 24 * 60 * 60 * 1000

export const purgeOldPdfDownloads = (days = MAX_AGE_DAYS) => {
  const all = loadAll()
  const cutoff = retentionCutoff(days)
  const filtered = all.filter(item => {
    const ts = new Date(item?.createdAt || 0).getTime()
    return Number.isFinite(ts) && ts >= cutoff
  })
  if (filtered.length !== all.length) saveAll(filtered)
  return filtered
}

export const recordPdfDownload = ({ commercialCode, commercialName, formData, offer }) => {
  if (!offer || !formData) return
  const existing = purgeOldPdfDownloads(MAX_AGE_DAYS)
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: nowIso(),
    commercialCode: String(commercialCode || '').trim() || '—',
    commercialName: String(commercialName || '').trim() || '',
    clientName: String(formData?.clientName || '').trim(),
    cups: String(formData?.cups || '').trim(),
    supplier: String(offer?.supplier || '').trim(),
    productName: String(offer?.productName || offer?.product || '').trim(),
    total: Number(offer?.total) || 0,
    savings: Number(offer?.savings) || 0,
    annualSavings: Number(offer?.annualSavings) || 0,
    formData,
    offer
  }
  existing.unshift(entry)
  saveAll(existing)
}

export const getPdfDownloads = ({ commercialCode, query = '', days = MAX_AGE_DAYS } = {}) => {
  const all = purgeOldPdfDownloads(days)
  const code = String(commercialCode || '').trim().toLowerCase()
  const q = String(query || '').trim().toLowerCase()
  return all
    .filter(item => {
      if (!code) return true
      return String(item?.commercialCode || '').trim().toLowerCase() === code
    })
    .filter(item => {
      if (!q) return true
      const haystack = [
        item?.clientName,
        item?.cups,
        item?.supplier,
        item?.productName,
        item?.commercialName,
        item?.commercialCode
      ].map(v => String(v || '').toLowerCase()).join(' ')
      return haystack.includes(q)
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export const clearPdfDownloads = () => {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(PDF_STORAGE_KEY)
}
