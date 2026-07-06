const XLSX = require('xlsx');

const PRODUCT_NAME_RE = /^TERRA\s+/i;
const TARIFF_TYPE_RE = /TARIFA\s+(2\.0\s*TD|2\.0TD|3\.0\s*TD|3\.0TD|6\.1\s*TD|6\.1TD)/i;
const TARIFF_HEADER_RE = /\bTARIFA\b/i;

function isIgnisWorkbook(fileName = '', mimeType = '') {
  const normalizedName = String(fileName).toLowerCase();
  const normalizedMime = String(mimeType).toLowerCase();
  const isExcel =
    normalizedName.endsWith('.xlsx') ||
    normalizedName.endsWith('.xls') ||
    normalizedMime.includes('spreadsheet') ||
    normalizedMime.includes('excel');

  if (!isExcel) return false;
  return /terra\s+(air|solid)/i.test(fileName);
}

function parseIgnisWorkbook(buffer, { fileName = '' } = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const tarifas = [];
  const effectiveDate = extractEffectiveDateFromFileName(fileName);
  const seenTariffs = new Set();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    let currentType = null;

    for (const row of rows) {
      const label = asString(row[1]);
      const detectedType = normalizeTariffType(label);
      if (detectedType) {
        currentType = detectedType;
        continue;
      }
      if (isTariffHeader(label)) {
        currentType = null;
        continue;
      }

      if (!currentType || !PRODUCT_NAME_RE.test(label)) continue;

      const tarifa = buildTariffRow({ currentType, row, fileName, effectiveDate });
      if (!tarifa) continue;
      const tariffKey = `${tarifa.tipoTarifa}::${normalizeProductKey(tarifa.nombreProducto)}`;
      if (seenTariffs.has(tariffKey)) continue;
      seenTariffs.add(tariffKey);
      tarifas.push(tarifa);
    }
  }

  return {
    comercializadora: 'IGNIS',
    source: 'ignis-xlsx',
    effectiveDate,
    tarifas
  };
}

function buildTariffRow({ currentType, row, fileName, effectiveDate }) {
  const nombreProducto = asString(row[1]).trim();
  if (!nombreProducto) return null;

  if (currentType === '2.0TD') {
    const periodosPotencia = compactPeriods(fillRepeatedPeriods({
      P1: toNumber(row[2]),
      P2: toNumber(row[4])
    }));
    const periodosConsumo = compactPeriods(fillRepeatedPeriods({
      P1: toNumber(row[8]),
      P2: toNumber(row[9]),
      P3: toNumber(row[10])
    }));

    if (!hasValues(periodosPotencia) && !hasValues(periodosConsumo)) return null;

    return {
      comercializadora: 'IGNIS',
      tipoTarifa: currentType,
      nombreProducto,
      periodosConsumo,
      periodosPotencia,
      sourceFile: fileName,
      effectiveDate
    };
  }

  const periodosPotencia = compactPeriods(fillRepeatedPeriods({
    P1: toNumber(row[2]),
    P2: toNumber(row[3]),
    P3: toNumber(row[4]),
    P4: toNumber(row[5]),
    P5: toNumber(row[6]),
    P6: toNumber(row[7])
  }));
  const periodosConsumo = compactPeriods(fillRepeatedPeriods({
    P1: toNumber(row[8]),
    P2: toNumber(row[9]),
    P3: toNumber(row[10]),
    P4: toNumber(row[11]),
    P5: toNumber(row[12]),
    P6: toNumber(row[13])
  }));

  if (!hasValues(periodosPotencia) && !hasValues(periodosConsumo)) return null;

  return {
    comercializadora: 'IGNIS',
    tipoTarifa: currentType,
    nombreProducto,
    periodosConsumo,
    periodosPotencia,
    sourceFile: fileName,
    effectiveDate
  };
}

function normalizeTariffType(value) {
  const text = asString(value).toUpperCase();
  const match = text.match(TARIFF_TYPE_RE);
  if (!match) return null;
  return match[1].replace(/\s+/g, '');
}

function isTariffHeader(value) {
  return TARIFF_HEADER_RE.test(asString(value));
}

function extractEffectiveDateFromFileName(fileName = '') {
  const match = String(fileName).match(/(\d{1,2})[.-](\d{1,2})[.-](\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function fillRepeatedPeriods(periods) {
  const entries = Object.entries(periods);
  const nonNull = entries.filter(([, value]) => value !== null);
  if (nonNull.length === 1) {
    const repeatedValue = nonNull[0][1];
    return Object.fromEntries(entries.map(([key]) => [key, repeatedValue]));
  }
  return periods;
}

function compactPeriods(periods) {
  return Object.fromEntries(
    Object.entries(periods).filter(([, value]) => value !== null)
  );
}

function hasValues(periods) {
  return Object.keys(periods).length > 0;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number(value);

  const normalized = String(value).trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function asString(value) {
  return value === null || value === undefined ? '' : String(value);
}

function normalizeProductKey(value) {
  return asString(value).trim().replace(/\s+/g, ' ').toUpperCase();
}

module.exports = {
  isIgnisWorkbook,
  parseIgnisWorkbook
};
