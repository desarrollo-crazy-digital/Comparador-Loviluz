const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function sha(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex')
}

function firstExisting(candidates) {
  for (const full of candidates) {
    if (fs.existsSync(full)) return full
  }
  return null
}

function readSection({ key, label, fileName }) {
  const candidates = [
    path.join(process.cwd(), 'api', 'data-private', fileName),
    path.join(__dirname, '..', 'api', 'data-private', fileName),
    path.join(__dirname, '..', 'data-private', fileName)
  ]
  const filePath = firstExisting(candidates)
  if (!filePath) {
    return { key, label, fileName, hash: '', mtimeMs: 0 }
  }
  const content = fs.readFileSync(filePath, 'utf8')
  const stat = fs.statSync(filePath)
  return {
    key,
    label,
    fileName,
    hash: sha(content),
    mtimeMs: Number(stat?.mtimeMs || 0),
    content
  }
}

function normalizeText(value) {
  return String(value || '').trim()
}

function sortedUnique(list) {
  return Array.from(new Set((list || []).map(normalizeText).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es'))
}

function pushProduct(target, provider, productName) {
  const p = normalizeText(provider)
  const name = normalizeText(productName)
  if (!p || !name) return
  if (!target[p]) target[p] = []
  target[p].push(name)
}

function buildCatalog(sectionKey, content) {
  let parsed = null
  try {
    parsed = JSON.parse(content || '{}')
  } catch {
    parsed = null
  }
  if (!parsed || typeof parsed !== 'object') {
    return { providers: [], productsByProvider: {} }
  }

  const productsByProvider = {}

  if (sectionKey === 'tarifas_luz') {
    for (const tariffType of Object.keys(parsed)) {
      const byProvider = parsed[tariffType]
      if (!byProvider || typeof byProvider !== 'object') continue
      for (const provider of Object.keys(byProvider)) {
        if (provider === 'LOGOS') continue
        const providerData = byProvider[provider]
        const products = Array.isArray(providerData?.productos) ? providerData.productos : []
        for (const item of products) {
          pushProduct(productsByProvider, provider, item?.nombre || item?.name || '')
        }
      }
    }
  } else if (sectionKey === 'tarifas_gas') {
    const gasRoot = parsed?.GAS && typeof parsed.GAS === 'object' ? parsed.GAS : {}
    for (const provider of Object.keys(gasRoot)) {
      if (provider === 'LOGOS') continue
      const providerData = gasRoot[provider]
      const products = Array.isArray(providerData?.productos) ? providerData.productos : []
      for (const item of products) {
        pushProduct(productsByProvider, provider, item?.nombre || item?.name || item?.band || '')
      }
    }
  } else if (sectionKey === 'comisiones') {
    for (const provider of Object.keys(parsed)) {
      if (provider === 'LOGOS') continue
      const tarifas = parsed?.[provider]?.tarifas
      if (!tarifas || typeof tarifas !== 'object') continue
      for (const tariffType of Object.keys(tarifas)) {
        const productsObj = tarifas[tariffType]
        if (!productsObj || typeof productsObj !== 'object') continue
        for (const productName of Object.keys(productsObj)) {
          pushProduct(productsByProvider, provider, productName)
        }
      }
    }
  }

  const normalized = {}
  for (const provider of Object.keys(productsByProvider)) {
    normalized[provider] = sortedUnique(productsByProvider[provider])
  }
  const providers = sortedUnique(Object.keys(normalized))
  return { providers, productsByProvider: normalized }
}

function getConfigVersion() {
  const sections = [
    readSection({ key: 'tarifas_luz', label: 'Tarifas electricidad', fileName: 'tarifas.v2.json' }),
    readSection({ key: 'tarifas_gas', label: 'Tarifas gas', fileName: 'tarifas-gas.v2.json' }),
    readSection({ key: 'comisiones', label: 'Comisiones', fileName: 'comisiones.json' })
  ]
  const versionSeed = sections.map(s => `${s.key}:${s.hash}`).join('|')
  const version = sha(versionSeed).slice(0, 16)
  const maxMtime = sections.reduce((acc, s) => Math.max(acc, Number(s.mtimeMs || 0)), 0)
  return {
    version,
    updatedAt: maxMtime > 0 ? new Date(maxMtime).toISOString() : new Date().toISOString(),
    sections: sections.map(({ key, label, hash, content }) => ({
      key,
      label,
      hash,
      catalog: buildCatalog(key, content)
    }))
  }
}

module.exports = { getConfigVersion }
