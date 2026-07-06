const XLSX = require('xlsx');

const LOVILUZ_SUPPLIER = 'LOVILUZ';
const PRODUCT_LIMITS_2_0TD = {
  'Lov Verano V': { consumoAnualMax: 5000 },
  'Lov TOO V': { consumoAnualMax: 10000 },
  'Lov ME V': { consumoAnualMax: 10000 }
};

function isLoviluzWorkbook(fileName = '', mimeType = '', buffer = null) {
  const normalizedName = String(fileName).toLowerCase();
  const normalizedMime = String(mimeType).toLowerCase();
  const isExcel =
    normalizedName.endsWith('.xlsx') ||
    normalizedName.endsWith('.xls') ||
    normalizedMime.includes('spreadsheet') ||
    normalizedMime.includes('excel');

  if (!isExcel) return false;
  if (/loviluz|tarifas?\s+lov/i.test(normalizedName)) return true;
  if (!buffer) return false;

  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return false;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
      header: 1,
      raw: false,
      defval: ''
    });
    const previewText = rows
      .slice(0, 12)
      .flat()
      .map(asString)
      .join(' ')
      .toUpperCase();
    return previewText.includes('LOVILUZ') && previewText.includes('TARIFAS');
  } catch (_) {
    return false;
  }
}

function parseLoviluzWorkbook(buffer, { fileName = '' } = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.SheetNames.length) {
    return {
      comercializadora: LOVILUZ_SUPPLIER,
      source: 'loviluz-xlsx',
      tarifas: []
    };
  }

  const sheets = {};
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    sheets[sheetName] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  }

  const effectiveDate = extractEffectiveDate(Object.values(sheets).flat());
  const tarifas = [
    ...buildLoviluz2Tariffs(sheets['2.0TD'] || [], fileName, effectiveDate),
    ...buildLoviluz3UniqueTariffs(sheets['3.0TD UNICA'] || [], false, fileName, effectiveDate),
    ...buildLoviluz3UniqueTariffs(sheets['3.0TD UNICA SSAA FUERA'] || [], true, fileName, effectiveDate),
    ...buildLoviluz3PeriodsTariffs(sheets['3.0TD PERIODOS'] || [], false, fileName, effectiveDate),
    ...buildLoviluz3PeriodsTariffs(sheets['3.0TD PERIODOS SSAA FUERA'] || [], true, fileName, effectiveDate),
    ...buildLoviluzFlexTariffs(sheets['FLEX (INDEX)'] || [], fileName, effectiveDate)
  ];
  const comisiones = buildLoviluzCommissions(sheets['COMISIONES'] || []);

  return {
    comercializadora: LOVILUZ_SUPPLIER,
    source: 'loviluz-xlsx',
    effectiveDate,
    tarifas,
    comisiones
  };
}
function buildLoviluz2Tariffs(rows, fileName, effectiveDate) {
  const tariffs = [];
  const products = [
    { titleRow: 4, titleCol: 0, potenciaRow: 7, potenciaCols: [1, 2], energiaRow: 10, energiaCols: [1, 2, 3] },
    { titleRow: 4, titleCol: 5, potenciaRow: 7, potenciaCols: [6, 7], energiaRow: 10, energiaCols: [6, 7, 8] },
    { titleRow: 14, titleCol: 0, potenciaRow: 17, potenciaCols: [1, 2], energiaRow: 20, energiaCols: [1, 2, 3] },
    { titleRow: 14, titleCol: 5, potenciaRow: 17, potenciaCols: [6, 7], energiaRow: 20, energiaCols: [6, 7, 8] },
    { titleRow: 25, titleCol: 0, potenciaRow: 28, potenciaCols: [1, 2], energiaRow: 31, energiaCols: [1, 2, 3] },
    { titleRow: 25, titleCol: 5, potenciaRow: 28, potenciaCols: [6, 7], energiaRow: 31, energiaCols: [6, 7, 8] }
  ];
  for (const def of products) {
    const title = rows[def.titleRow]?.[def.titleCol];
    const productName = stripLovTitle(title);
    if (!productName) continue;
    const potenciaRow = rows[def.potenciaRow] || [];
    const energiaRow = rows[def.energiaRow] || [];
    const periodosPotencia = {
      P1: toNumber(potenciaRow[def.potenciaCols[0]]),
      P2: toNumber(potenciaRow[def.potenciaCols[1]]),
      P3: null
    };
    const periodosConsumo = {
      P1: toNumber(energiaRow[def.energiaCols[0]]),
      P2: toNumber(energiaRow[def.energiaCols[1]]),
      P3: toNumber(energiaRow[def.energiaCols[2]])
    };
    tariffs.push({
      comercializadora: LOVILUZ_SUPPLIER,
      tipoTarifa: '2.0TD',
      nombreProducto: productName,
      periodosConsumo,
      periodosPotencia,
      sourceFile: fileName,
      effectiveDate,
      ...get2_0TDLimits(productName)
    });
  }
  return tariffs;
}

function buildLoviluz3UniqueTariffs(rows, ssaaFuera, fileName, effectiveDate) {
  const tariffs = [];
  const starts = [3, 14, 25, 36, 46];
  const names = ['Lov Verano V UNICA', 'Lov ME V UNICA', 'Lov ON V UNICA', 'Lov PLUS V UNICA', 'Lov US V SOLAR UNICA'];
  for (let i = 0; i < starts.length; i += 1) {
    const baseName = names[i];
    const productName = ssaaFuera ? `${baseName} SSAA NO INCLUIDOS` : baseName;
    const powerRow = rows[starts[i] + 2] || [];
    const energyRow = rows[starts[i] + 6] || [];
    tariffs.push({
      comercializadora: LOVILUZ_SUPPLIER,
      tipoTarifa: '3.0TD',
      nombreProducto: productName,
      periodosConsumo: buildLoviluz3Periods(energyRow, 1),
      periodosPotencia: buildLoviluz3Periods(powerRow, 1),
      sourceFile: fileName,
      effectiveDate
    });
  }
  return tariffs;
}

function buildLoviluz3PeriodsTariffs(rows, ssaaFuera, fileName, effectiveDate) {
  const tariffs = [];
  const starts = [3, 14, 25, 36];
  const names = ['Lov Verano V PERIODOS', 'Lov ME V PERIODOS', 'Lov ON V PERIODOS', 'Lov PLUS V PERIODOS'];
  for (let i = 0; i < starts.length; i += 1) {
    const productName = ssaaFuera ? `${names[i]} SSAA NO INCLUIDOS` : names[i];
    const powerRow = rows[starts[i] + 2] || [];
    const energyRow = rows[starts[i] + 6] || [];
    tariffs.push({
      comercializadora: LOVILUZ_SUPPLIER,
      tipoTarifa: '3.0TD',
      nombreProducto: productName,
      periodosConsumo: buildLoviluz3Periods(energyRow, 1),
      periodosPotencia: buildLoviluz3Periods(powerRow, 1),
      sourceFile: fileName,
      effectiveDate
    });
  }
  return tariffs;
}

function buildLoviluzFlexTariffs(rows, fileName, effectiveDate) {
  return [];
}

function buildLoviluzCommissions(rows) {
  const comisiones = {
    [LOVILUZ_SUPPLIER]: {
      tipo: 'variable',
      tarifas: {
        '2.0TD': {},
        '3.0TD': {}
      }
    }
  };
  let currentSection = null;
  let currentTariffType = null;
  let currentHeaders = [];
  for (const row of rows || []) {
    const label = asString(row?.[0]).trim().toUpperCase();
    if (/^2\.0TD$/.test(label)) {
      currentSection = '2.0TD';
      currentTariffType = '2.0TD';
      currentHeaders = row.slice(2).map(asString);
      continue;
    }
    if (/^3\.0TD UNICA$/.test(label) || /^3\.0TD POR PERIODOS$/.test(label)) {
      currentSection = '3.0TD';
      currentTariffType = '3.0TD';
      currentHeaders = row.slice(2).map(asString);
      continue;
    }
    if (!currentSection || !currentTariffType) continue;
    const firstCell = asString(row?.[0]).trim().toUpperCase();
    if (!firstCell || /TARIFA|CONSUMO|TOTAL|RETROCOMISION/.test(firstCell)) continue;
    for (let col = 2; col < row.length; col += 1) {
      const header = asString(currentHeaders[col - 2]).trim();
      const commission = parseEuroAmount(row[col]);
      if (!header || commission === null) continue;
      const key = stripLovTitle(header);
      const target = comisiones[LOVILUZ_SUPPLIER].tarifas[currentTariffType];
      if (!target[key]) {
        target[key] = { tipo: 'fija', comision: commission };
      } else {
        target[key + ' ' + firstCell] = { tipo: 'fija', comision: commission };
      }
    }
  }
  return comisiones;
}

function buildPeriods(row, colIndex, tariffType, kind) {
  if (tariffType === '2.0TD') {
    if (kind === 'potencia') {
      return {
        P1: toNumber(row[colIndex + 1]),
        P2: toNumber(row[colIndex + 2]),
        P3: null
      };
    }
    return {
      P1: toNumber(row[colIndex + 1]),
      P2: toNumber(row[colIndex + 2]),
      P3: toNumber(row[colIndex + 3])
    };
  }

  return {
    P1: toNumber(row[colIndex + 1]),
    P2: toNumber(row[colIndex + 2]),
    P3: toNumber(row[colIndex + 3]),
    P4: toNumber(row[colIndex + 4]),
    P5: toNumber(row[colIndex + 5]),
    P6: toNumber(row[colIndex + 6])
  };
}

function normalizeOfficeProductTitle(value) {
  const raw = asString(value).replace(/\s+/g, ' ').trim();
  if (!/^TARIFA\s+Lov/i.test(raw) || !/OFI/i.test(raw)) return null;
  return raw
    .replace(/^TARIFA\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLovTitle(value) {
  return asString(value).replace(/^TARIFA\s+/i, '').replace(/\s+/g, ' ').trim();
}

function buildLoviluz3Periods(row, startIndex) {
  return {
    P1: toNumber(row[startIndex + 0]),
    P2: toNumber(row[startIndex + 1]),
    P3: toNumber(row[startIndex + 2]),
    P4: toNumber(row[startIndex + 3]),
    P5: toNumber(row[startIndex + 4]),
    P6: toNumber(row[startIndex + 5])
  };
}

function parseEuroAmount(value) {
  let raw = asString(value).replace(/\s+/g, '').replace('€', '');
  if (!raw) return null;
  if (/,\d{3}$/.test(raw) && !raw.includes('.')) {
    raw = raw.replace(',', '');
  } else {
    raw = raw.replace(/\./g, '').replace(',', '.');
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMwhRange(value) {
  const raw = normalizeForMatch(value).replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  const moreThanMatch = raw.match(/^MAS DE\s+(\d+(?:[.,]\d+)?)$/);
  if (moreThanMatch) {
    return {
      desde: Number((Number(moreThanMatch[1].replace(',', '.')) * 1000 + 0.01).toFixed(2)),
      hasta: null
    };
  }

  const rangeMatch = raw.match(/^(\d+(?:[.,]\d+)?)\s+A\s+(\d+(?:[.,]\d+)?)$/);
  if (!rangeMatch) return null;

  const fromMwh = Number(rangeMatch[1].replace(',', '.'));
  const toMwh = Number(rangeMatch[2].replace(',', '.'));
  if (!Number.isFinite(fromMwh) || !Number.isFinite(toMwh)) return null;
  return {
    desde: fromMwh <= 0 ? 0 : Number((fromMwh * 1000 + 0.01).toFixed(2)),
    hasta: Number((toMwh * 1000).toFixed(2))
  };
}

function isOfficeTariffHeader(value, productName) {
  const raw = asString(value).replace(/\s+/g, ' ').trim().toUpperCase();
  if (!/^[23]\.0T\s+LOV/.test(raw)) return false;
  const compactRaw = raw.replace(/\s+/g, ' ');
  const compactName = productName.replace(/^LOV\s+/, 'LOV ');
  return compactRaw.includes(compactName);
}

function getOfficeTariffType(value) {
  const raw = asString(value).toUpperCase();
  if (/^2\.0T/.test(raw)) return '2.0TD';
  if (/^3\.0T/.test(raw)) return '3.0TD';
  return null;
}

function normalizeForMatch(value) {
  return asString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function findSections(rows) {
  const sections = [];
  for (let index = 0; index < rows.length; index += 1) {
    const title = normalizeSectionTitle(rows[index]?.[3]);
    if (!title) continue;
    sections.push({ rowIndex: index, productName: title });
  }
  return sections;
}

function buildSectionTariffs(section, rows, fileName, effectiveDate) {
  const tariffs = [];
  const powerHeaderRow = findNextRow(rows, section.rowIndex + 1, (row) => /2\.0T\s+Lov/i.test(asString(row?.[0])));
  const energyHeaderRow = findNextRow(rows, powerHeaderRow + 1, (row) => /2\.0T\s+Lov/i.test(asString(row?.[0])) && /P3/i.test(asString(row?.[3])));

  if (powerHeaderRow === -1 || energyHeaderRow === -1) return tariffs;

  const powerValuesRow = rows[powerHeaderRow + 2] || [];
  const energyValuesRow = rows[energyHeaderRow + 1] || [];

  const leftTariff = build2_0TDTariff(section.productName, powerValuesRow, energyValuesRow, fileName, effectiveDate);
  if (leftTariff) tariffs.push(leftTariff);

  const hasThreePointZero = /3\.0T\s+Lov/i.test(asString(rows[powerHeaderRow]?.[6])) && /3\.0T\s+Lov/i.test(asString(rows[energyHeaderRow]?.[6]));
  if (hasThreePointZero) {
    const rightTariff = build3_0TDTariff(section.productName, powerValuesRow, energyValuesRow, fileName, effectiveDate);
    if (rightTariff) tariffs.push(rightTariff);
  }

  return tariffs;
}

function build2_0TDTariff(productName, powerValuesRow, energyValuesRow, fileName, effectiveDate) {
  const periodosPotencia = {
    P1: toNumber(powerValuesRow[1]),
    P2: toNumber(powerValuesRow[2]),
    P3: null
  };
  const periodosConsumo = {
    P1: toNumber(energyValuesRow[1]),
    P2: toNumber(energyValuesRow[2]),
    P3: toNumber(energyValuesRow[3])
  };
  if (!hasValues(periodosPotencia) || !hasValues(periodosConsumo)) return null;

  return {
    comercializadora: LOVILUZ_SUPPLIER,
    tipoTarifa: '2.0TD',
    nombreProducto: productName,
    periodosConsumo,
    periodosPotencia,
    sourceFile: fileName,
    effectiveDate,
    ...get2_0TDLimits(productName)
  };
}

function build3_0TDTariff(productName, powerValuesRow, energyValuesRow, fileName, effectiveDate) {
  const periodosPotencia = {
    P1: toNumber(powerValuesRow[7]),
    P2: toNumber(powerValuesRow[8]),
    P3: toNumber(powerValuesRow[9]),
    P4: toNumber(powerValuesRow[10]),
    P5: toNumber(powerValuesRow[11]),
    P6: toNumber(powerValuesRow[12])
  };
  const periodosConsumo = {
    P1: toNumber(energyValuesRow[7]),
    P2: toNumber(energyValuesRow[8]),
    P3: toNumber(energyValuesRow[9]),
    P4: toNumber(energyValuesRow[10]),
    P5: toNumber(energyValuesRow[11]),
    P6: toNumber(energyValuesRow[12])
  };
  if (!hasValues(periodosPotencia) || !hasValues(periodosConsumo)) return null;

  return {
    comercializadora: LOVILUZ_SUPPLIER,
    tipoTarifa: '3.0TD',
    nombreProducto: productName,
    periodosConsumo,
    periodosPotencia,
    sourceFile: fileName,
    effectiveDate
  };
}

function get2_0TDLimits(productName) {
  return PRODUCT_LIMITS_2_0TD[productName] ? { ...PRODUCT_LIMITS_2_0TD[productName] } : {};
}

function normalizeSectionTitle(value) {
  const raw = asString(value).replace(/\s+/g, ' ').trim();
  if (!/^TARIFAS?\s+Lov/i.test(raw)) return null;
  if (/LOVILUZ/i.test(raw) && /FIJAS/i.test(raw)) return null;
  return raw
    .replace(/^TARIFAS?\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEffectiveDate(rows) {
  for (const row of rows || []) {
    for (const cell of row || []) {
      const parsed = parseDateCell(cell);
      if (parsed) return parsed;
    }
  }
  return null;
}

function parseDateCell(value) {
  const raw = asString(value).trim();
  if (!raw) return null;
  const match = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (!day || !month || !year) return null;
  return `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function findNextRow(rows, startIndex, predicate) {
  for (let index = startIndex; index < rows.length; index += 1) {
    if (predicate(rows[index] || [], index)) return index;
  }
  return -1;
}

function hasValues(periods) {
  return Object.values(periods || {}).some((value) => value !== null && value !== undefined && Number.isFinite(value));
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const normalized = String(value).trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function asString(value) {
  return value === null || value === undefined ? '' : String(value);
}

module.exports = {
  isLoviluzWorkbook,
  parseLoviluzWorkbook
};
