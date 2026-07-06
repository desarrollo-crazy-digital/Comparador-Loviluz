export function formatProductDisplayName(supplier, productName) {
  const rawSupplier = String(supplier || '').trim().toUpperCase()
  const rawName = String(productName || '').trim()

  if (!rawName) return ''
  if (rawSupplier !== 'CANALUZ' && rawSupplier !== 'REPSOL') return rawName

  let name = rawName
    .replace(/\b(?:2\.0\s*TD|2\.0TD|3\.0TD|6\.1TD)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  const replacements = [
    [/PRECIO FIJO/gi, 'PF'],
    [/PRESENCIALES/gi, 'PRES.'],
    [/PRESENCIAL/gi, 'PRES.'],
    [/TARIFA NEGOCIO XL/gi, 'NEGOCIO XL'],
    [/PRECIO ÚNICO/gi, 'P. UNICO'],
    [/PRECIO UNICO/gi, 'P. UNICO'],
    [/POTENCIA/gi, 'POT.'],
    [/ESPECIAL/gi, 'ESP.'],
    [/ENERGÍA VERDE/gi, 'E. VERDE'],
    [/ENERGIA VERDE/gi, 'E. VERDE'],
    [/SIN SSAA/gi, 'S/SSAA']
  ]

  for (const [pattern, replacement] of replacements) {
    name = name.replace(pattern, replacement)
  }

  return name.replace(/\s{2,}/g, ' ').trim()
}
