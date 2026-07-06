import { supabase, hasSupabase } from './supabaseClient'

const STORAGE_KEY = 'comparador:history'
const CONTRACTS_KEY = 'comparador:contracts'
const ROLLUPS_KEY = 'comparador:rollups'
const MAX_ENTRIES = 500
const RETENTION_DAYS = 10

const safeJsonParse = (raw, fallback) => {
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

const loadAll = () => {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return Array.isArray(safeJsonParse(raw, [])) ? safeJsonParse(raw, []) : []
}

const saveAll = (items) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ENTRIES)))
}

const loadContracts = () => {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(CONTRACTS_KEY)
  return Array.isArray(safeJsonParse(raw, [])) ? safeJsonParse(raw, []) : []
}

const saveContracts = (items) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CONTRACTS_KEY, JSON.stringify(items.slice(0, MAX_ENTRIES)))
}

const loadRollups = () => {
  if (typeof window === 'undefined') return []
  const raw = window.localStorage.getItem(ROLLUPS_KEY)
  return Array.isArray(safeJsonParse(raw, [])) ? safeJsonParse(raw, []) : []
}

const saveRollups = (items) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ROLLUPS_KEY, JSON.stringify(items))
}

const normalizeOffers = (offers) => offers.map(o => ({
  supplier: o?.supplier || '',
  productName: o?.productName || '',
  total: Number(o?.total) || 0,
  savings: Number(o?.savings) || 0,
  annualSavings: Number(o?.annualSavings) || 0,
  commission: Number(o?.commission) || 0,
  pricingConsumo: o?.pricingConsumo || {},
  pricingPotencia: o?.pricingPotencia || {}
}))

const buildSummary = (offer, formData) => ({
  supplier: offer?.supplier || '',
  productName: offer?.productName || '',
  total: Number(offer?.total) || 0,
  savings: Number(offer?.savings) || 0,
  annualSavings: Number(offer?.annualSavings) || 0,
  commission: Number(offer?.commission) || 0,
  savingsPercent: Number(offer?.savingsPercent) || 0,
  currentBill: Number(formData?.currentBill) || 0,
  energyType: formData?.energyType || '',
  tariffType: formData?.tariffType || formData?.gasTariffBand || ''
})

const mergeCounts = (target, source) => {
  if (!source) return
  Object.entries(source).forEach(([key, value]) => {
    if (!key) return
    target[key] = (target[key] || 0) + (Number(value) || 0)
  })
}

const dateKey = (date) => date.toISOString().split('T')[0]

const periodStart = (date, type) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  if (type === 'weekly') {
    const day = d.getUTCDay()
    const diff = (day + 6) % 7
    d.setUTCDate(d.getUTCDate() - diff)
    return dateKey(d)
  }
  if (type === 'monthly') {
    d.setUTCDate(1)
    return dateKey(d)
  }
  return dateKey(d)
}

const buildRollups = (entries, periodTypes = ['weekly', 'monthly']) => {
  const buckets = {}
  entries.forEach(entry => {
    const created = new Date(entry.createdAt || entry.created_at || Date.now())
    periodTypes.forEach(type => {
      const start = periodStart(created, type)
      const key = `${type}|${start}`
      if (!buckets[key]) {
        buckets[key] = {
          period_type: type,
          period_start: start,
          totals: {
            count: 0,
            totalProposal: 0,
            totalSavings: 0,
            totalAnnualSavings: 0,
            totalCommission: 0
          },
          counts: {
            byCommercial: {},
            bySupplier: {},
            byProduct: {},
            byTariff: {}
          }
        }
      }
      const bucket = buckets[key]
      const supplier = entry.supplier || entry.offers?.[0]?.supplier || '—'
      const productName = entry.productName || entry.offers?.[0]?.productName || '—'
      const product = `${supplier} • ${productName}`
      const tariff = entry.tariffType || '—'
      const commercial = entry.commercialCode || '—'
      bucket.totals.count += 1
      bucket.totals.totalProposal += Number(entry.total) || 0
      bucket.totals.totalSavings += Number(entry.savings) || 0
      bucket.totals.totalAnnualSavings += Number(entry.annualSavings) || 0
      bucket.totals.totalCommission += Number(entry.commission) || 0
      bucket.counts.byCommercial[commercial] = (bucket.counts.byCommercial[commercial] || 0) + 1
      bucket.counts.bySupplier[supplier] = (bucket.counts.bySupplier[supplier] || 0) + 1
      bucket.counts.byProduct[product] = (bucket.counts.byProduct[product] || 0) + 1
      bucket.counts.byTariff[tariff] = (bucket.counts.byTariff[tariff] || 0) + 1
    })
  })
  return Object.values(buckets)
}

export const recordComparison = async ({ commercialCode, formData, offers }) => {
  if (!Array.isArray(offers) || offers.length === 0) return
  const now = new Date()
  const summary = buildSummary(offers[0], formData)
  const entry = {
    id: `${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now.toISOString(),
    commercialCode: commercialCode || '—',
    clientName: formData?.clientName || '',
    cups: formData?.cups || '',
    energyType: summary.energyType,
    tariffType: summary.tariffType,
    supplier: summary.supplier,
    productName: summary.productName,
    total: summary.total,
    savings: summary.savings,
    annualSavings: summary.annualSavings,
    commission: summary.commission,
    savingsPercent: summary.savingsPercent,
    currentBill: summary.currentBill,
    offers: normalizeOffers(offers)
  }

  if (hasSupabase) {
    const { error } = await supabase.from('comparisons').insert({
      commercial_code: entry.commercialCode,
      client_name: entry.clientName,
      cups: entry.cups,
      energy_type: entry.energyType,
      tariff_type: entry.tariffType,
      supplier: entry.supplier,
      product_name: entry.productName,
      total: entry.total,
      savings: entry.savings,
      annual_savings: entry.annualSavings,
      commission: entry.commission,
      savings_percent: entry.savingsPercent,
      current_bill: entry.currentBill,
      offers: entry.offers
    })
    if (error) throw error
    return
  }

  if (typeof window === 'undefined') return
  const all = loadAll()
  all.unshift(entry)
  saveAll(all)
}

export const getHistory = async ({ commercialCode } = {}) => {
  if (hasSupabase) {
    let query = supabase
      .from('comparisons')
      .select('id, created_at, commercial_code, client_name, cups, energy_type, tariff_type, supplier, product_name, total, savings, annual_savings, commission, savings_percent, current_bill, offers')
      .order('created_at', { ascending: false })
      .limit(200)
    if (commercialCode) query = query.eq('commercial_code', commercialCode)
    const { data, error } = await query
    if (error) throw error
    return (data || []).map(row => ({
      id: row.id,
      createdAt: row.created_at,
      commercialCode: row.commercial_code,
      clientName: row.client_name,
      cups: row.cups,
      energyType: row.energy_type,
      tariffType: row.tariff_type,
      supplier: row.supplier,
      productName: row.product_name,
      total: row.total,
      savings: row.savings,
      annualSavings: row.annual_savings,
      commission: row.commission,
      savingsPercent: row.savings_percent,
      currentBill: row.current_bill,
      offers: row.offers || []
    }))
  }

  const all = loadAll()
  if (!commercialCode) return all
  return all.filter(item => item.commercialCode === commercialCode)
}

export const getRollups = async () => {
  if (hasSupabase) {
    const { data, error } = await supabase
      .from('comparison_rollups')
      .select('period_type, period_start, totals, counts')
      .order('period_start', { ascending: false })
      .limit(200)
    if (error) throw error
    return data || []
  }
  return loadRollups()
}

export const compactHistory = async ({ retentionDays = RETENTION_DAYS } = {}) => {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  if (hasSupabase) {
    const rows = []
    const pageSize = 1000
    let from = 0
    const cutoffIso = cutoff.toISOString()
    while (true) {
      const { data, error } = await supabase
        .from('comparisons')
        .select('id, created_at, commercial_code, supplier, product_name, tariff_type, total, savings, annual_savings, commission')
        .lt('created_at', cutoffIso)
        .order('created_at', { ascending: true })
        .range(from, from + pageSize - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      rows.push(...data.map(row => ({
        id: row.id,
        createdAt: row.created_at,
        commercialCode: row.commercial_code,
        supplier: row.supplier,
        productName: row.product_name,
        tariffType: row.tariff_type,
        total: row.total,
        savings: row.savings,
        annualSavings: row.annual_savings,
        commission: row.commission
      })))
      if (data.length < pageSize) break
      from += pageSize
    }

    if (rows.length === 0) return { removed: 0, rollups: 0 }
    const rollups = buildRollups(rows)
    const { error: rollupError } = await supabase
      .from('comparison_rollups')
      .upsert(rollups, { onConflict: 'period_type,period_start' })
    if (rollupError) throw rollupError

    const { error: deleteError } = await supabase
      .from('comparisons')
      .delete()
      .lt('created_at', cutoffIso)
    if (deleteError) throw deleteError
    return { removed: rows.length, rollups: rollups.length }
  }

  const all = loadAll()
  const old = all.filter(item => new Date(item.createdAt) < cutoff)
  const keep = all.filter(item => new Date(item.createdAt) >= cutoff)
  if (old.length === 0) return { removed: 0, rollups: 0 }
  const rollups = buildRollups(old)
  saveAll(keep)
  const existing = loadRollups()
  saveRollups([...rollups, ...existing])
  return { removed: old.length, rollups: rollups.length }
}

export const recordContract = async ({ comparison, commercialCode }) => {
  const now = new Date()
  const offer = comparison?.offers?.[0] || comparison || {}
  const entry = {
    id: `${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now.toISOString(),
    comparisonId: comparison?.id || null,
    commercialCode: commercialCode || comparison?.commercialCode || '—',
    supplier: comparison?.supplier || offer?.supplier || '',
    productName: comparison?.productName || offer?.productName || '',
    energyType: comparison?.energyType || '',
    tariffType: comparison?.tariffType || '',
    total: Number(comparison?.total ?? offer?.total) || 0,
    savings: Number(comparison?.savings ?? offer?.savings) || 0,
    annualSavings: Number(comparison?.annualSavings ?? offer?.annualSavings) || 0,
    commission: Number(comparison?.commission ?? offer?.commission) || 0
  }

  if (hasSupabase) {
    const { error } = await supabase.from('contracts').insert({
      comparison_id: entry.comparisonId,
      commercial_code: entry.commercialCode,
      supplier: entry.supplier,
      product_name: entry.productName,
      energy_type: entry.energyType,
      tariff_type: entry.tariffType,
      total: entry.total,
      savings: entry.savings,
      annual_savings: entry.annualSavings,
      commission: entry.commission
    })
    if (error) throw error
    return
  }

  if (typeof window === 'undefined') return
  const all = loadContracts()
  if (entry.comparisonId && all.some(c => c.comparisonId === entry.comparisonId)) return
  all.unshift(entry)
  saveContracts(all)
}

export const getContracts = async ({ commercialCode } = {}) => {
  if (hasSupabase) {
    let query = supabase
      .from('contracts')
      .select('id, created_at, comparison_id, commercial_code, supplier, product_name, energy_type, tariff_type, total, savings, annual_savings, commission')
      .order('created_at', { ascending: false })
      .limit(200)
    if (commercialCode) query = query.eq('commercial_code', commercialCode)
    const { data, error } = await query
    if (error) throw error
    return (data || []).map(row => ({
      id: row.id,
      createdAt: row.created_at,
      comparisonId: row.comparison_id,
      commercialCode: row.commercial_code,
      supplier: row.supplier,
      productName: row.product_name,
      energyType: row.energy_type,
      tariffType: row.tariff_type,
      total: row.total,
      savings: row.savings,
      annualSavings: row.annual_savings,
      commission: row.commission
    }))
  }

  const all = loadContracts()
  if (!commercialCode) return all
  return all.filter(item => item.commercialCode === commercialCode)
}

export const getStats = async () => {
  const all = hasSupabase ? await getHistory() : loadAll()
  const contracts = hasSupabase ? await getContracts() : loadContracts()
  const rollups = await getRollups()
  const byCommercial = {}
  const bySupplier = {}
  const byProduct = {}
  const byTariff = {}
  const totals = {
    count: 0,
    totalProposal: 0,
    totalSavings: 0,
    totalAnnualSavings: 0,
    totalCommission: 0
  }

  const contractsByCommercial = {}
  const contractsBySupplier = {}
  const contractsByProduct = {}
  const contractsByTariff = {}
  const contractTotals = {
    totalProposal: 0,
    totalSavings: 0,
    totalAnnualSavings: 0,
    totalCommission: 0
  }

  all.forEach(entry => {
    const code = entry.commercialCode || '—'
    byCommercial[code] = (byCommercial[code] || 0) + 1
    const supplier = entry.supplier || entry.offers?.[0]?.supplier || '—'
    const productName = entry.productName || entry.offers?.[0]?.productName || '—'
    const product = `${supplier} • ${productName}`
    const tariff = entry.tariffType || '—'
    bySupplier[supplier] = (bySupplier[supplier] || 0) + 1
    byProduct[product] = (byProduct[product] || 0) + 1
    byTariff[tariff] = (byTariff[tariff] || 0) + 1
    totals.count += 1
    totals.totalProposal += Number(entry.total) || 0
    totals.totalSavings += Number(entry.savings) || 0
    totals.totalAnnualSavings += Number(entry.annualSavings) || 0
    totals.totalCommission += Number(entry.commission) || 0
  })

  rollups.forEach(rollup => {
    mergeCounts(byCommercial, rollup.counts?.byCommercial)
    mergeCounts(bySupplier, rollup.counts?.bySupplier)
    mergeCounts(byProduct, rollup.counts?.byProduct)
    mergeCounts(byTariff, rollup.counts?.byTariff)
    totals.count += Number(rollup.totals?.count) || 0
    totals.totalProposal += Number(rollup.totals?.totalProposal) || 0
    totals.totalSavings += Number(rollup.totals?.totalSavings) || 0
    totals.totalAnnualSavings += Number(rollup.totals?.totalAnnualSavings) || 0
    totals.totalCommission += Number(rollup.totals?.totalCommission) || 0
  })

  contracts.forEach(entry => {
    const code = entry.commercialCode || '—'
    contractsByCommercial[code] = (contractsByCommercial[code] || 0) + 1
    const supplier = entry.supplier || '—'
    const product = `${supplier} • ${entry.productName || '—'}`
    const tariff = entry.tariffType || '—'
    contractsBySupplier[supplier] = (contractsBySupplier[supplier] || 0) + 1
    contractsByProduct[product] = (contractsByProduct[product] || 0) + 1
    contractsByTariff[tariff] = (contractsByTariff[tariff] || 0) + 1
    contractTotals.totalProposal += Number(entry.total) || 0
    contractTotals.totalSavings += Number(entry.savings) || 0
    contractTotals.totalAnnualSavings += Number(entry.annualSavings) || 0
    contractTotals.totalCommission += Number(entry.commission) || 0
  })

  const conversionByCommercial = {}
  Object.keys(byCommercial).forEach(code => {
    const total = byCommercial[code] || 0
    const sold = contractsByCommercial[code] || 0
    conversionByCommercial[code] = total > 0 ? (sold / total) : 0
  })

  const total = totals.count
  return {
    total,
    byCommercial,
    bySupplier,
    byProduct,
    byTariff,
    totals,
    contracts: {
      total: contracts.length,
      byCommercial: contractsByCommercial,
      bySupplier: contractsBySupplier,
      byProduct: contractsByProduct,
      byTariff: contractsByTariff,
      totals: contractTotals
    },
    conversionByCommercial,
    latest: all.slice(0, 20)
  }
}

export const clearHistory = () => {
  if (hasSupabase) return
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
}
