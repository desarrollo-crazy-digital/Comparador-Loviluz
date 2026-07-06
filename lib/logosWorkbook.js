const XLSX = require('xlsx');

const LOGOS_SHEET_NAME = 'RESUMEN LITE';
const TARIFF_TYPES = new Set(['2.0TD', '3.0TD', '6.1TD']);
const FIXED_HOME_FAMILIES = new Set(['SIGMA', 'OMEGA', 'EPSILON', 'DELTA', 'BETA']);
const FIXED_HOME_MODES = new Set(['FIJO', 'UNICO']);
const ZETA_PRODUCTS = new Set(['ZETA', 'ZETA PLUS']);
const FIXED_PYME_LITE_PRODUCTS = new Set([
  'SIGMA LITE',
  'OMEGA LITE',
  'EPSILON LITE',
  'DELTA LITE',
  'GAMMA LITE',
  'BETA LITE'
]);

function isLogosWorkbook(fileName = '', mimeType = '', buffer = null) {
  const normalizedName = String(fileName).toLowerCase();
  const normalizedMime = String(mimeType).toLowerCase();
  const isExcel =
    normalizedName.endsWith('.xlsx') ||
    normalizedName.endsWith('.xls') ||
    normalizedMime.includes('spreadsheet') ||
    normalizedMime.includes('excel');

  if (!isExcel) return false;
  if (/logos/i.test(normalizedName) || /resumen de precios/i.test(normalizedName)) return true;
  if (!buffer) return false;

  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    if (!workbook.SheetNames.includes(LOGOS_SHEET_NAME)) return false;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[LOGOS_SHEET_NAME], {
      header: 1,
      raw: false,
      defval: ''
    });
    return rows.some((row) => {
      const homeFamily = normalizeProductName(row[2]);
      const pymeProduct = normalizeProductName(row[11]);
      return homeFamily.endsWith(' LITE') || FIXED_HOME_FAMILIES.has(homeFamily) || ZETA_PRODUCTS.has(pymeProduct);
    });
  } catch (_) {
    return false;
  }
}

function parseLogosWorkbook(buffer, { fileName = '' } = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[LOGOS_SHEET_NAME];
  if (!sheet) {
    return {
      comercializadora: 'LOGOS',
      source: 'logos-xlsx',
      tarifas: []
    };
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  const tarifas = [];
  const effectiveDate = extractEffectiveDate(rows);
  tarifas.push(...buildFixedHomeTariffs(rows, fileName, effectiveDate));
  tarifas.push(...buildFixedHomePymeTariffs(rows, fileName, effectiveDate));
  tarifas.push(...buildFixedPymeLiteTariffs(rows, fileName, effectiveDate));

  return {
    comercializadora: 'LOGOS',
    source: 'logos-xlsx',
    effectiveDate,
    tarifas: tarifas.filter(Boolean)
  };
}

function buildTariffRow(productName, tariffType, powerValues, energyValues, fileName, effectiveDate) {
  const isTwoPointZero = tariffType === '2.0TD';
  const normalizedPowerValues = normalizePeriodValues(powerValues, isTwoPointZero ? 2 : 6);
  const normalizedEnergyValues = normalizePeriodValues(energyValues, isTwoPointZero ? 3 : 6);
  const periodosPotencia = compactPeriods({
    P1: normalizedPowerValues[0] ?? null,
    P2: normalizedPowerValues[1] ?? null,
    P3: isTwoPointZero ? null : (normalizedPowerValues[2] ?? null),
    P4: isTwoPointZero ? null : (normalizedPowerValues[3] ?? null),
    P5: isTwoPointZero ? null : (normalizedPowerValues[4] ?? null),
    P6: isTwoPointZero ? null : (normalizedPowerValues[5] ?? null)
  });
  const periodosConsumo = compactPeriods({
    P1: normalizedEnergyValues[0] ?? null,
    P2: normalizedEnergyValues[1] ?? null,
    P3: normalizedEnergyValues[2] ?? null,
    P4: isTwoPointZero ? null : (normalizedEnergyValues[3] ?? null),
    P5: isTwoPointZero ? null : (normalizedEnergyValues[4] ?? null),
    P6: isTwoPointZero ? null : (normalizedEnergyValues[5] ?? null)
  });

  if (!hasValues(periodosPotencia) || !hasValues(periodosConsumo)) return null;

  return {
    comercializadora: 'LOGOS',
    tipoTarifa: tariffType,
    nombreProducto: productName,
    periodosConsumo,
    periodosPotencia,
    sourceFile: fileName,
    effectiveDate
  };
}

function buildFixedHomeTariffs(rows, fileName, effectiveDate) {
  const tarifas = [];
  let currentFamily = '';
  let currentTariffType = null;

  for (const row of rows || []) {
    const family = normalizeProductName(row[2]);
    if (FIXED_HOME_FAMILIES.has(family)) currentFamily = family;

    const mode = normalizeMode(row[3]);
    const tariffType = normalizeTariffType(row[4]) || currentTariffType;
    if (normalizeTariffType(row[4])) currentTariffType = normalizeTariffType(row[4]);
    if (!currentFamily || !mode || tariffType !== '2.0TD') continue;

    tarifas.push(buildTariffRow(
      `${currentFamily} HOGAR ${mode}`,
      tariffType,
      [toNumber(row[5]), toNumber(row[6])],
      [toNumber(row[7]), toNumber(row[8]), toNumber(row[9])],
      fileName,
      effectiveDate
    ));
  }

  return tarifas.filter(Boolean);
}

function buildFixedHomePymeTariffs(rows, fileName, effectiveDate) {
  const tarifas = [];

  for (const row of rows || []) {
    const productName = normalizeProductName(row[11]);
    const tariffType = normalizeTariffType(row[13]);
    if (!ZETA_PRODUCTS.has(productName) || tariffType !== '2.0TD') continue;

    tarifas.push(buildTariffRow(
      productName,
      tariffType,
      [toNumber(row[14]), toNumber(row[15])],
      [toNumber(row[16]), toNumber(row[17]), toNumber(row[18])],
      fileName,
      effectiveDate
    ));
  }

  return tarifas.filter(Boolean);
}

function buildFixedPymeLiteTariffs(rows, fileName, effectiveDate) {
  const tarifas = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const productName = normalizeProductName(row[2]);
    const tariffType = normalizeTariffType(row[3]);

    if (!isSupportedLiteProduct(productName) || !tariffType) continue;

    const groupRows = [{ tariffType, row }];
    for (let next = index + 1; next < rows.length; next += 1) {
      const nextRow = rows[next] || [];
      if (normalizeProductName(nextRow[2])) break;
      const nextTariffType = normalizeTariffType(nextRow[3]);
      if (!nextTariffType) continue;
      groupRows.push({ tariffType: nextTariffType, row: nextRow });
    }

    for (const group of groupRows) {
      tarifas.push(buildTariffRow(
        productName,
        group.tariffType,
        [
          toNumber(group.row[4]),
          toNumber(group.row[5]),
          toNumber(group.row[6]),
          toNumber(group.row[7]),
          toNumber(group.row[8]),
          toNumber(group.row[9])
        ],
        [
          toNumber(group.row[10]),
          toNumber(group.row[11]),
          toNumber(group.row[12]),
          toNumber(group.row[13]),
          toNumber(group.row[14]),
          toNumber(group.row[15])
        ],
        fileName,
        effectiveDate
      ));
    }
  }

  return tarifas.filter(Boolean);
}

function extractEffectiveDate(rows) {
  for (const row of rows || []) {
    const rowText = row.map(asString).join(' ').toLowerCase();
    if (!rowText.includes('fecha entrada en vigor')) continue;
    for (const cell of row) {
      const parsed = parseDateCell(cell);
      if (parsed) return parsed;
    }
  }
  return null;
}

function parseDateCell(value) {
  const raw = asString(value).trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (!month || !day || !year) return null;
  return `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isSupportedLiteProduct(productName) {
  return FIXED_PYME_LITE_PRODUCTS.has(productName);
}

function normalizeMode(value) {
  const raw = asString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (raw === 'UNICO') return 'UNICO';
  return FIXED_HOME_MODES.has(raw) ? raw : null;
}

function normalizeTariffType(value) {
  const raw = asString(value).toUpperCase().replace(/\s+/g, '');
  return TARIFF_TYPES.has(raw) ? raw : null;
}

function normalizeProductName(value) {
  return asString(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function compactPeriods(periods) {
  return Object.fromEntries(Object.entries(periods).filter(([, value]) => value !== null));
}

function hasValues(periods) {
  return Object.keys(periods).length > 0;
}

function normalizePeriodValues(values, expectedPeriods) {
  const normalized = Array.from({ length: expectedPeriods }, (_, index) => values[index] ?? null);
  const present = normalized.filter((value) => value !== null);
  if (present.length === 1) {
    return normalized.map(() => present[0]);
  }
  return normalized;
}

function toNumber(value) {
  const raw = asString(value).trim();
  if (!raw) return null;
  let normalized = raw;
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function asString(value) {
  return value === null || value === undefined ? '' : String(value);
}

module.exports = {
  isLogosWorkbook,
  parseLogosWorkbook
};
