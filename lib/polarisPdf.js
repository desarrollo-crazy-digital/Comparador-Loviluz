const { PDFParse } = require('pdf-parse');

const KNOWN_PRODUCTS = ['PREMIUM', 'AHORRO', 'OPTIMA', 'POLAR'];
const MONTHS = {
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

function isPolarisTariffPdf(fileName = '', mimeType = '') {
  const normalizedName = String(fileName || '').toLowerCase();
  const normalizedMime = String(mimeType || '').toLowerCase();
  const isPdf = normalizedName.endsWith('.pdf') || normalizedMime.includes('pdf');
  if (!isPdf) return false;
  if (!normalizedName.includes('td')) return false;
  return KNOWN_PRODUCTS.some((product) => normalizedName.includes(product.toLowerCase()));
}

async function parsePolarisTariffPdf(buffer, { fileName = '' } = {}) {
  const parser = new PDFParse({ data: buffer });
  try {
    const { text } = await parser.getText();
    const normalizedText = String(text || '');
    const tipoTarifa = extractTariffType(normalizedText, fileName);
    const nombreProducto = extractProductName(normalizedText, fileName);
    const effectiveDate = extractEffectiveDate(normalizedText);
    const decimals = extractUsefulDecimals(normalizedText);

    let tarifa;
    if (tipoTarifa === '2.0TD') {
      tarifa = build2Dot0Tariff({ decimals, nombreProducto, fileName });
    } else if (tipoTarifa === '3.0TD') {
      tarifa = build3Dot0Tariff({ decimals, nombreProducto });
    } else {
      throw new Error('PDF de Polaris no soportado: solo se admiten 2.0TD y 3.0TD');
    }

    return {
      comercializadora: 'POLARIS',
      source: 'polaris-pdf',
      ...(effectiveDate ? { effectiveDate } : {}),
      tarifas: [tarifa]
    };
  } finally {
    await parser.destroy();
  }
}

function extractTariffType(text, fileName) {
  const source = `${text}\n${fileName}`;
  const match = source.match(/\b([236]\.0TD|[236]\.1TD)\b/i);
  if (!match) throw new Error('No se pudo identificar la tarifa del PDF de Polaris');
  return match[1].toUpperCase();
}

function extractProductName(text, fileName) {
  const source = `${text}\n${fileName}`.toUpperCase();
  const product = KNOWN_PRODUCTS.find((item) => new RegExp(`\\b${item}\\b`, 'i').test(source));
  if (!product) throw new Error('No se pudo identificar el producto del PDF de Polaris');
  const is24H = /\b24\s*H\b/i.test(source);
  return is24H ? `${product} 24H` : product;
}

function extractEffectiveDate(text) {
  const match = String(text || '').match(/hasta el\s+(\d{1,2})\s+de\s+([a-záéíóú]+)\s+del\s+(\d{4})/i);
  if (!match) return null;
  const day = String(Number.parseInt(match[1], 10)).padStart(2, '0');
  const monthKey = match[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const month = MONTHS[monthKey];
  if (!month) return null;
  return `${match[3]}-${month}-${day}`;
}

function extractUsefulDecimals(text) {
  return (String(text || '').match(/\d+,\d+/g) || [])
    .map(toNumber)
    .filter((value) => Number.isFinite(value))
    .filter((value) => value !== 5.112696 && value !== 6.979247);
}

function build2Dot0Tariff({ decimals, nombreProducto, fileName }) {
  if (decimals.length < 3) {
    throw new Error('No se pudieron extraer los precios 2.0TD de Polaris');
  }

  const [singleEnergyPrice, powerP1, powerP2] = decimals;
  const tariff = {
    comercializadora: 'POLARIS',
    tipoTarifa: '2.0TD',
    nombreProducto,
    periodosConsumo: {
      P1: singleEnergyPrice,
      P2: singleEnergyPrice,
      P3: singleEnergyPrice
    },
    periodosPotencia: {
      P1: powerP1,
      P2: powerP2,
      P3: null
    }
  };

  const normalizedName = String(fileName || '').toLowerCase();
  if (normalizedName.includes('+ 10kw') || normalizedName.includes('+10kw') || normalizedName.includes('> 10kw')) {
    tariff.potenciaMin = 10.01;
    tariff.potenciaMax = 15;
  }

  return tariff;
}

function build3Dot0Tariff({ decimals, nombreProducto }) {
  if (decimals.length < 12) {
    throw new Error('No se pudieron extraer los precios 3.0TD de Polaris');
  }

  const power = decimals.slice(0, 6);
  const is24H = /\b24H\b/i.test(String(nombreProducto || ''));
  const energy = is24H && Number.isFinite(decimals[12])
    ? Array(6).fill(decimals[12])
    : decimals.slice(6, 12);
  return {
    comercializadora: 'POLARIS',
    tipoTarifa: '3.0TD',
    nombreProducto,
    periodosConsumo: {
      P1: energy[0],
      P2: energy[1],
      P3: energy[2],
      P4: energy[3],
      P5: energy[4],
      P6: energy[5]
    },
    periodosPotencia: {
      P1: power[0],
      P2: power[1],
      P3: power[2],
      P4: power[3],
      P5: power[4],
      P6: power[5]
    }
  };
}

function toNumber(value) {
  return Number.parseFloat(String(value || '').replace(',', '.'));
}

module.exports = {
  isPolarisTariffPdf,
  parsePolarisTariffPdf
};
