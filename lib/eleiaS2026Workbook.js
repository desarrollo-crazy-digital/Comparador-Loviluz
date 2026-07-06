const XLSX = require('xlsx');

const SUPPLIER = 'ELEIA';
const TARIFF_TYPES = new Set(['2.0TD', '3.0TD', '6.1TD']);
const GAS_BANDS = new Set(['RL1', 'RL2', 'RL3', 'RL4', 'RL5']);

const ELECTRIC_SHEETS = new Set([
  'TU DECIDES PLUS',
  'TU DECIDES',
  'TU ELIGES',
  'SIMPLEX',
  'BALANCE OF ENERGY',
  'TU MEDIO AMBIENTE',
  'TRADERPOOL'
]);

const GAS_SHEETS = new Set([
  'PRODUCTO TU DECIDES',
  'PRODUCTO TU ELIGES',
  'PRODUCTO SIMPLEX 360'
]);

function isEleiaS2026Workbook(fileName = '', mimeType = '', buffer = null) {
  const normalizedName = String(fileName).toLowerCase();
  const normalizedMime = String(mimeType).toLowerCase();
  const isExcel =
    normalizedName.endsWith('.xlsx') ||
    normalizedName.endsWith('.xls') ||
    normalizedMime.includes('spreadsheet') ||
    normalizedMime.includes('excel');

  if (!isExcel) return false;
  if (/resumen precios (electricidad|gas) s2026/i.test(normalizedName)) return true;
  if (!buffer) return false;

  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    return workbook.SheetNames.some((sheetName) => {
      const normalized = normalizeSheetName(sheetName);
      return ELECTRIC_SHEETS.has(normalized) || GAS_SHEETS.has(normalized);
    });
  } catch (_) {
    return false;
  }
}

function parseEleiaS2026Workbook(buffer, { fileName = '' } = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const tarifas = [];
  const versions = [];

  for (const sheetName of workbook.SheetNames) {
    const normalizedSheet = normalizeSheetName(sheetName);
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    versions.push(...extractVersions(rows));

    if (ELECTRIC_SHEETS.has(normalizedSheet)) {
      tarifas.push(...parseElectricSheet(rows, fileName));
    } else if (GAS_SHEETS.has(normalizedSheet)) {
      tarifas.push(...parseGasSheet(rows, fileName));
    }
  }

  const effectiveDate = extractEffectiveDateFromVersions(versions) || extractEffectiveDateFromFileName(fileName);

  return {
    comercializadora: SUPPLIER,
    source: 'eleia-s2026-xlsx',
    effectiveDate,
    tarifas: tarifas.map((tarifa) => ({
      ...tarifa,
      effectiveDate: tarifa.effectiveDate || effectiveDate
    }))
  };
}

function parseElectricSheet(rows, fileName) {
  const productRowIndex = findProductRowIndex(rows);
  const energyHeaderIndex = findRowIndex(rows, /T[ÉE]RMINO DE ENERG[IÍ]A/i);
  const powerHeaderIndex = findRowIndex(rows, /T[ÉE]RMINO DE POTENCIA/i);
  if (productRowIndex === -1 || energyHeaderIndex === -1) return [];

  const products = findElectricProductGroups(rows[productRowIndex], rows[energyHeaderIndex]);
  if (!products.length) return [];

  const energyRows = collectTariffRows(rows, energyHeaderIndex + 1, powerHeaderIndex === -1 ? rows.length : powerHeaderIndex);
  const powerRows = powerHeaderIndex === -1 ? new Map() : collectTariffRows(rows, powerHeaderIndex + 1, rows.length);
  const tarifas = [];

  for (const product of products) {
    for (const [tipoTarifa, energyRow] of energyRows.entries()) {
      const periodCount = tipoTarifa === '2.0TD' ? 3 : 6;
      const energy = buildPeriods(energyRow, product.startCol + 1, periodCount);
      const powerRow = powerRows.get(tipoTarifa);
      const power = powerRow ? buildPowerPeriods(powerRow, product, tipoTarifa) : {};
      if (!hasValues(energy) && !hasValues(power)) continue;

      tarifas.push({
        comercializadora: SUPPLIER,
        tipoTarifa,
        nombreProducto: product.name,
        periodosConsumo: energy,
        periodosPotencia: power,
        sourceFile: fileName
      });
    }
  }

  return tarifas;
}

function parseGasSheet(rows, fileName) {
  const productRowIndex = findGasProductRowIndex(rows);
  const fixedHeaderIndex = findRowIndex(rows, /T[ÉE]RMINO FIJO/i);
  if (productRowIndex === -1 || fixedHeaderIndex === -1) return [];

  const products = findGasProductGroups(rows[productRowIndex], rows[fixedHeaderIndex]);
  if (!products.length) return [];

  const tarifas = [];
  for (const product of products) {
    for (let rowIndex = fixedHeaderIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const band = normalizeGasBand(row[product.bandCol]);
      if (!band) continue;

      const fixedMonthly = toNumber(row[product.fixedCol]);
      const variableKwh = toNumber(row[product.variableCol]);
      if (fixedMonthly === null && variableKwh === null) continue;

      const terminoFijoDiario = fixedMonthly === null ? null : roundPrice(fixedMonthly / 30, 8);
      const terminoVariableKwh = variableKwh === null ? null : roundPrice(variableKwh, 6);
      tarifas.push({
        comercializadora: SUPPLIER,
        tipoTarifa: 'GAS',
        nombreProducto: `${product.name} ${band}`,
        band,
        terminoFijoDiario,
        terminoVariableKwh,
        periodosConsumo: terminoVariableKwh === null ? {} : { kWh: terminoVariableKwh },
        periodosPotencia: terminoFijoDiario === null ? {} : { fijoDiario: terminoFijoDiario },
        sourceFile: fileName
      });
    }
  }

  return tarifas;
}

function findElectricProductGroups(productRow, markerRow) {
  const groups = [];
  for (let col = 0; col < productRow.length; col += 1) {
    const productName = normalizeElectricProductName(productRow[col]);
    if (!productName) continue;
    if (!isFixedPriceMarker(markerRow[col])) continue;
    groups.push({ name: productName, startCol: col });
  }
  return groups;
}

function findGasProductGroups(productRow, headerRow) {
  const groups = [];
  for (let col = 0; col < productRow.length; col += 1) {
    const productName = normalizeGasProductName(productRow[col]);
    if (!productName) continue;

    let fixedCol = null;
    let variableCol = null;
    for (let scan = col; scan < Math.min(col + 8, headerRow.length); scan += 1) {
      const header = normalizeText(headerRow[scan]);
      if (fixedCol === null && /TERMINO FIJO/.test(header)) fixedCol = scan;
      if (variableCol === null && /TERMINO VARIABLE/.test(header)) variableCol = scan;
    }
    if (fixedCol === null || variableCol === null) continue;
    groups.push({ name: productName, bandCol: 0, fixedCol, variableCol });
  }
  return groups;
}

function collectTariffRows(rows, fromIndex, toIndex) {
  const out = new Map();
  for (let rowIndex = fromIndex; rowIndex < toIndex; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    for (let col = 0; col < row.length; col += 1) {
      const tariffType = normalizeTariffType(row[col]);
      if (tariffType && !out.has(tariffType)) out.set(tariffType, row);
    }
  }
  return out;
}

function buildPeriods(row, firstValueCol, periodCount) {
  const periods = {};
  for (let index = 0; index < periodCount; index += 1) {
    const value = toNumber(row[firstValueCol + index]);
    if (value !== null) periods[`P${index + 1}`] = roundPrice(value, 6);
  }
  return periods;
}

function buildPowerPeriods(row, product, tipoTarifa) {
  const firstValueCol = product.startCol + 1;
  if (tipoTarifa !== '2.0TD') return buildPowerPeriodsDaily(row, firstValueCol, 6);

  const p1 = toNumber(row[firstValueCol]);
  let p2 = toNumber(row[firstValueCol + 1]);
  const p3ColumnValue = toNumber(row[firstValueCol + 2]);

  // Some Eleia 2.0TD sheets place the second power period under P3.
  if ((p2 === 0 || p2 === null) && p3ColumnValue !== null) {
    p2 = p3ColumnValue;
  }

  const periods = {};
  if (p1 !== null) periods.P1 = roundPrice(p1 / 365, 6);
  if (p2 !== null) periods.P2 = roundPrice(p2 / 365, 6);
  return periods;
}

function buildPowerPeriodsDaily(row, firstValueCol, periodCount) {
  const periods = {};
  for (let index = 0; index < periodCount; index += 1) {
    const value = toNumber(row[firstValueCol + index]);
    if (value !== null) periods[`P${index + 1}`] = roundPrice(value / 365, 6);
  }
  return periods;
}

function findProductRowIndex(rows) {
  return rows.findIndex((row) => row.some((cell) => normalizeElectricProductName(cell)));
}

function findGasProductRowIndex(rows) {
  return rows.findIndex((row) => row.some((cell) => normalizeGasProductName(cell)));
}

function findRowIndex(rows, pattern) {
  return rows.findIndex((row) => row.some((cell) => pattern.test(asString(cell))));
}

function isFixedPriceMarker(value) {
  return normalizeText(value) === 'PRECIO FIJO' || normalizeText(value) === 'PRECIO TERMINO B';
}

function normalizeElectricProductName(value) {
  const raw = normalizeText(value);
  if (!raw || /^PRODUCTO\b/.test(raw)) return '';

  let match = raw.match(/^TDE\s*(PLUS)$/);
  if (match) return 'TDE PLUS';
  match = raw.match(/^TDE\s*(\d)$/);
  if (match) return `TDE${match[1]}`;
  match = raw.match(/^TEE\s*(\d)$/);
  if (match) return `TEE${match[1]}`;
  match = raw.match(/^TMAE\s*(\d)$/);
  if (match) return `TMAE${match[1]}`;
  match = raw.match(/^BALANCE OF ENERGY\s*(\d)$/);
  if (match) return `BOE${match[1]}`;
  match = raw.match(/^TRADERPOOL\s*(\d)$/);
  if (match) return `TRADERPOOL ${match[1]}`;
  if (raw === 'SIMPLEX') return 'SIMPLEX';

  return '';
}

function normalizeGasProductName(value) {
  const raw = normalizeText(value);
  if (!raw || /^PRODUCTO\b/.test(raw)) return '';

  let match = raw.match(/^TDE\s*(\d)$/);
  if (match) return `TDE${match[1]}`;
  match = raw.match(/^TEE\s*(\d)$/);
  if (match) return `TEE${match[1]}`;
  if (raw === 'SIMPLEX') return 'SIMPLEX';

  return '';
}

function normalizeTariffType(value) {
  const raw = normalizeText(value).replace(/\s+/g, '');
  return TARIFF_TYPES.has(raw) ? raw : null;
}

function normalizeGasBand(value) {
  const raw = normalizeText(value).replace(/\./g, '');
  return GAS_BANDS.has(raw) ? raw : null;
}

function extractVersions(rows) {
  const versions = [];
  for (const row of rows || []) {
    for (const cell of row || []) {
      const text = asString(cell);
      const match = text.match(/(?:^|[^0-9])(20\d{6})(?!\d)/);
      if (match) versions.push(match[1]);
    }
  }
  return versions;
}

function extractEffectiveDateFromVersions(versions) {
  const dates = versions
    .map((value) => {
      const text = String(value || '');
      if (!/^\d{8}$/.test(text)) return null;
      return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    })
    .filter(Boolean)
    .sort();
  return dates.pop() || null;
}

function extractEffectiveDateFromFileName(fileName = '') {
  const match = String(fileName).match(/(\d{1,2})[.-](\d{1,2})[.-](\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function normalizeSheetName(value) {
  return normalizeText(value);
}

function normalizeText(value) {
  return asString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function hasValues(periods) {
  return Object.values(periods || {}).some((value) => value !== null && value !== undefined);
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).trim().replace(/\./g, '.').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundPrice(value, decimals) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function asString(value) {
  return value === null || value === undefined ? '' : String(value);
}

module.exports = {
  isEleiaS2026Workbook,
  parseEleiaS2026Workbook
};
