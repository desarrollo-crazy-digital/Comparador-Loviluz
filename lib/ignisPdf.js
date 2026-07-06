const { PDFParse } = require('pdf-parse');

function isIgnisFacilPdf(fileName = '', mimeType = '') {
  const normalizedName = String(fileName).toLowerCase();
  const normalizedMime = String(mimeType).toLowerCase();
  const isPdf = normalizedName.endsWith('.pdf') || normalizedMime.includes('pdf');
  if (!isPdf) return false;
  return normalizedName.includes('facil') || normalizedName.includes('fácil');
}

async function parseIgnisFacilPdf(buffer, { fileName = '' } = {}) {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    const text = String(result?.text || '');
    const precios = extractPrices(text);
    const effectiveDate = extractEffectiveDate(text);

    return {
      comercializadora: 'IGNIS',
      source: 'ignis-facil-pdf',
      effectiveDate,
      tarifas: [
        build2Dot0Tariff('TERRA SOLID FACIL', precios.solid.facil2, fileName, effectiveDate),
        build2Dot0Tariff('TERRA SOLID FACIL ON', precios.solid.facilOn2, fileName, effectiveDate),
        build3Dot0Tariff('TERRA SOLID FACIL', precios.solid.facil3, fileName, effectiveDate),
        build2Dot0Tariff('TERRA AIR FACIL', precios.air.facil2, fileName, effectiveDate),
        build2Dot0Tariff('TERRA AIR FACIL ON', precios.air.facilOn2, fileName, effectiveDate),
        build3Dot0Tariff('TERRA AIR FACIL', precios.air.facil3, fileName, effectiveDate)
      ]
    };
  } finally {
    await parser.destroy();
  }
}

function extractPrices(text) {
  const normalized = text.replace(/\s+/g, ' ');
  const solidBlock = extractProductBlock(normalized, /TERRA SOLID F[ÁA]CIL y TERRA SOLID F[ÁA]CIL ON/i);
  const airBlock = extractProductBlock(normalized, /TERRA AIR F[ÁA]CIL y TERRA AIR F[ÁA]CIL ON/i);

  if (!solidBlock || !airBlock) {
    throw new Error('No se pudieron extraer los precios de FÁCIL/FÁCIL ON del PDF');
  }

  return {
    solid: solidBlock,
    air: airBlock
  };
}

function extractProductBlock(text, headingRe) {
  const headingMatch = text.match(headingRe);
  if (!headingMatch) return null;
  const block = text.slice(headingMatch.index, headingMatch.index + 900);
  const energyMatch = block.match(/Precio Energ[ií]a\s+([0-9.,]+)€\/kWh\s+([0-9.,]+)€\/kWh\s+([0-9.,]+)€\/kWh/i);
  const powerMatch = block.match(/Precio Potencia\s+([0-9.,]+)€\/kW d[ií]a\s+([0-9.,]+)€\/kW d[ií]a\s+([0-9.,]+)€\/kW d[ií]a/i);
  if (!energyMatch || !powerMatch) return null;
  return {
    facil2: { energy: toNumber(energyMatch[1]), power: toNumber(powerMatch[1]) },
    facilOn2: { energy: toNumber(energyMatch[2]), power: toNumber(powerMatch[2]) },
    facil3: { energy: toNumber(energyMatch[3]), power: toNumber(powerMatch[3]) }
  };
}

function build2Dot0Tariff(nombreProducto, prices, fileName, effectiveDate) {
  return {
    comercializadora: 'IGNIS',
    tipoTarifa: '2.0TD',
    nombreProducto,
    periodosConsumo: repeatValue(prices.energy, ['P1', 'P2', 'P3']),
    periodosPotencia: repeatValue(prices.power, ['P1', 'P2']),
    sourceFile: fileName,
    effectiveDate
  };
}

function build3Dot0Tariff(nombreProducto, prices, fileName, effectiveDate) {
  return {
    comercializadora: 'IGNIS',
    tipoTarifa: '3.0TD',
    nombreProducto,
    periodosConsumo: repeatValue(prices.energy, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']),
    periodosPotencia: repeatValue(prices.power, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']),
    sourceFile: fileName,
    effectiveDate
  };
}

function repeatValue(value, periods) {
  return Object.fromEntries(periods.map(period => [period, value]));
}

function toNumber(value) {
  const normalized = String(value).trim().replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Valor numérico inválido: ${value}`);
  }
  return parsed;
}

function extractEffectiveDate(text) {
  const monthMap = {
    enero: '01',
    febrero: '02',
    marzo: '03',
    abril: '04',
    mayo: '05',
    junio: '06',
    julio: '07',
    agosto: '08',
    septiembre: '09',
    setiembre: '09',
    octubre: '10',
    noviembre: '11',
    diciembre: '12'
  };
  const match = String(text || '').match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(\d{4})\b/i);
  if (!match) return null;
  const month = monthMap[match[1].toLowerCase()];
  return month ? `${match[2]}-${month}-01` : null;
}

module.exports = {
  isIgnisFacilPdf,
  parseIgnisFacilPdf
};
