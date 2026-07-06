import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseIgnisWorkbook } = require('../lib/ignisWorkbook.js');
const { isIgnisFacilPdf, parseIgnisFacilPdf } = require('../lib/ignisPdf.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dataPath = path.join(repoRoot, 'api', 'data-private', 'tarifas.v2.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const filePaths = args.filter((arg) => arg !== '--dry-run');

if (!filePaths.length) {
  console.error('Uso: node scripts/update-ignis-prices.mjs [--dry-run] <excel-ignis.xlsx> [...mas.xlsx]');
  process.exit(1);
}

const tarifasData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const stats = {
  files: 0,
  extracted: 0,
  matchedProducts: new Set(),
  changedFields: 0,
  unchangedFields: 0,
  skippedFields: 0,
  notFound: [],
  unsupported: []
};
const touchedSuppliers = new Map();

for (const inputPath of filePaths) {
  const absolutePath = path.resolve(inputPath);
  const fileName = path.basename(absolutePath);
  const buffer = fs.readFileSync(absolutePath);
  const parsed = await parseIgnisInput(buffer, { fileName });
  stats.files += 1;
  stats.extracted += parsed.tarifas.length;

  for (const tariff of parsed.tarifas) {
    if ((tariff.comercializadora || '').toUpperCase() !== 'IGNIS') continue;

    const tipoTarifa = tariff.tipoTarifa;
    const supplierBlock = tarifasData[tipoTarifa]?.IGNIS;
    if (!supplierBlock || !Array.isArray(supplierBlock.productos)) {
      stats.unsupported.push(`${tipoTarifa} - ${tariff.nombreProducto} (${fileName})`);
      continue;
    }

    const existing = supplierBlock.productos.find((product) => {
      return normalizeName(product.nombre) === normalizeName(tariff.nombreProducto);
    });
    if (!existing) {
      stats.notFound.push(`${tipoTarifa} - ${tariff.nombreProducto} (${fileName})`);
      continue;
    }

    const beforeChangedFields = stats.changedFields;
    updatePeriodGroup(existing, tariff, 'periodosConsumo', stats);
    updatePeriodGroup(existing, tariff, 'periodosPotencia', stats);

    if (stats.changedFields > beforeChangedFields) {
      const productKey = `${tipoTarifa}::${existing.nombre}`;
      stats.matchedProducts.add(productKey);
      const date = tariff.effectiveDate || parsed.effectiveDate || extractDateFromFileName(fileName) || new Date().toISOString().slice(0, 10);
      const supplierKey = `${tipoTarifa}::IGNIS`;
      const previous = touchedSuppliers.get(supplierKey);
      touchedSuppliers.set(supplierKey, previous && previous > date ? previous : date);
    }
  }
}

for (const [supplierKey, date] of touchedSuppliers.entries()) {
  const [tipoTarifa, comercializadora] = supplierKey.split('::');
  const supplierBlock = tarifasData[tipoTarifa]?.[comercializadora];
  if (!supplierBlock) continue;
  if (!supplierBlock.metadata) supplierBlock.metadata = {};
  const currentDate = supplierBlock.metadata.ultimaActualizacion;
  supplierBlock.metadata.ultimaActualizacion = currentDate && currentDate > date ? currentDate : date;
}

if (!dryRun) {
  fs.writeFileSync(dataPath, `${JSON.stringify(tarifasData, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({
  dryRun,
  files: stats.files,
  extractedTariffs: stats.extracted,
  changedProducts: stats.matchedProducts.size,
  changedFields: stats.changedFields,
  unchangedFields: stats.unchangedFields,
  skippedFields: stats.skippedFields,
  notFound: stats.notFound.length,
  unsupported: stats.unsupported.length,
  notFoundSample: stats.notFound.slice(0, 20),
  unsupportedSample: stats.unsupported.slice(0, 20)
}, null, 2));

function updatePeriodGroup(existing, tariff, groupKey, stats) {
  const incoming = tariff[groupKey] || {};
  const target = existing[groupKey];
  if (!target || typeof target !== 'object') {
    stats.skippedFields += Object.keys(incoming).length;
    return;
  }

  for (const [period, newValue] of Object.entries(incoming)) {
    if (newValue === null || newValue === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(target, period)) {
      stats.skippedFields += 1;
      continue;
    }
    if (target[period] === newValue) {
      stats.unchangedFields += 1;
      continue;
    }
    target[period] = newValue;
    stats.changedFields += 1;
  }
}

async function parseIgnisInput(buffer, { fileName }) {
  if (isIgnisFacilPdf(fileName, 'application/pdf')) {
    return parseIgnisFacilPdf(buffer, { fileName });
  }
  return parseIgnisWorkbook(buffer, { fileName });
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractDateFromFileName(fileName = '') {
  const match = String(fileName).match(/(\d{1,2})[.-](\d{1,2})[.-](\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
