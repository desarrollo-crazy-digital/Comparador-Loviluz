import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseEleiaS2026Workbook } = require('../lib/eleiaS2026Workbook.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const electricDataPath = path.join(repoRoot, 'api', 'data-private', 'tarifas.v2.json');
const gasDataPath = path.join(repoRoot, 'api', 'data-private', 'tarifas-gas.v2.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const filePaths = args.filter((arg) => arg !== '--dry-run');

if (!filePaths.length) {
  console.error('Uso: node scripts/update-eleia-s2026-prices.mjs [--dry-run] <excel-electricidad.xlsx> <excel-gas.xlsx>');
  process.exit(1);
}

const electricData = JSON.parse(fs.readFileSync(electricDataPath, 'utf8'));
const gasData = JSON.parse(fs.readFileSync(gasDataPath, 'utf8'));
const stats = {
  dryRun,
  files: 0,
  extractedTariffs: 0,
  changedProducts: new Set(),
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
  const parsed = parseEleiaS2026Workbook(buffer, { fileName });
  stats.files += 1;
  stats.extractedTariffs += parsed.tarifas.length;

  for (const tariff of parsed.tarifas) {
    if ((tariff.comercializadora || '').toUpperCase() !== 'ELEIA') continue;
    if (tariff.tipoTarifa === 'GAS') {
      updateGasTariff(gasData, tariff, fileName, stats, touchedSuppliers);
    } else {
      updateElectricTariff(electricData, tariff, fileName, stats, touchedSuppliers);
    }
  }
}

for (const [key, date] of touchedSuppliers.entries()) {
  const [fileKey, tipoTarifa, comercializadora] = key.split('::');
  const supplierBlock = fileKey === 'gas'
    ? gasData.GAS?.[comercializadora]
    : electricData[tipoTarifa]?.[comercializadora];
  if (!supplierBlock) continue;
  if (!supplierBlock.metadata) supplierBlock.metadata = {};
  const currentDate = supplierBlock.metadata.ultimaActualizacion;
  supplierBlock.metadata.ultimaActualizacion = currentDate && currentDate > date ? currentDate : date;
}

if (!dryRun) {
  fs.writeFileSync(electricDataPath, `${JSON.stringify(electricData, null, 2)}\n`, 'utf8');
  fs.writeFileSync(gasDataPath, `${JSON.stringify(gasData, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({
  dryRun,
  files: stats.files,
  extractedTariffs: stats.extractedTariffs,
  changedProducts: stats.changedProducts.size,
  changedFields: stats.changedFields,
  unchangedFields: stats.unchangedFields,
  skippedFields: stats.skippedFields,
  notFound: stats.notFound.length,
  unsupported: stats.unsupported.length,
  notFoundSample: stats.notFound.slice(0, 30),
  unsupportedSample: stats.unsupported.slice(0, 30)
}, null, 2));

function updateElectricTariff(data, tariff, fileName, stats, touchedSuppliers) {
  const tipoTarifa = tariff.tipoTarifa;
  const supplierBlock = data[tipoTarifa]?.ELEIA;
  if (!supplierBlock || !Array.isArray(supplierBlock.productos)) {
    stats.unsupported.push(`${tipoTarifa} - ${tariff.nombreProducto} (${fileName})`);
    return;
  }

  const existing = supplierBlock.productos.find((product) => {
    return normalizeName(product.nombre) === normalizeName(tariff.nombreProducto);
  });
  if (!existing) {
    stats.notFound.push(`${tipoTarifa} - ${tariff.nombreProducto} (${fileName})`);
    return;
  }

  const beforeChangedFields = stats.changedFields;
  updatePeriodGroup(existing, tariff, 'periodosConsumo', stats);
  updatePeriodGroup(existing, tariff, 'periodosPotencia', stats);
  if (stats.changedFields > beforeChangedFields) {
    stats.changedProducts.add(`${tipoTarifa}::ELEIA::${existing.nombre}`);
    markTouched(touchedSuppliers, `electric::${tipoTarifa}::ELEIA`, tariff.effectiveDate);
  }
}

function updateGasTariff(data, tariff, fileName, stats, touchedSuppliers) {
  const supplierBlock = data.GAS?.ELEIA;
  if (!supplierBlock || !Array.isArray(supplierBlock.productos)) {
    stats.unsupported.push(`GAS - ${tariff.nombreProducto} (${fileName})`);
    return;
  }

  const existing = supplierBlock.productos.find((product) => {
    return normalizeName(product.nombre) === normalizeName(tariff.nombreProducto);
  });
  if (!existing) {
    stats.notFound.push(`GAS - ${tariff.nombreProducto} (${fileName})`);
    return;
  }

  const beforeChangedFields = stats.changedFields;
  updateScalar(existing, 'terminoFijoDiario', tariff.terminoFijoDiario, stats);
  updateScalar(existing, 'terminoVariableKwh', tariff.terminoVariableKwh, stats);
  if (stats.changedFields > beforeChangedFields) {
    stats.changedProducts.add(`GAS::ELEIA::${existing.nombre}`);
    markTouched(touchedSuppliers, 'gas::GAS::ELEIA', tariff.effectiveDate);
  }
}

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
    updateScalar(target, period, newValue, stats);
  }
}

function updateScalar(target, field, newValue, stats) {
  if (newValue === null || newValue === undefined) return;
  if (!Object.prototype.hasOwnProperty.call(target, field)) {
    stats.skippedFields += 1;
    return;
  }
  if (target[field] === newValue) {
    stats.unchangedFields += 1;
    return;
  }
  target[field] = newValue;
  stats.changedFields += 1;
}

function markTouched(touchedSuppliers, key, effectiveDate) {
  const date = effectiveDate || new Date().toISOString().slice(0, 10);
  const previous = touchedSuppliers.get(key);
  touchedSuppliers.set(key, previous && previous > date ? previous : date);
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}
