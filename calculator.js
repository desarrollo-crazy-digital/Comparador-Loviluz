// Core cálculo de tarifas en backend (reutilizable en server.js y Vercel API)
const fs = require('fs');
const path = require('path');

const ELECTRICITY_TAX_STD = 0.051126963; // 5,1126963%
const ELECTRICITY_TAX_HOGAR_LOW = 0.051126963;  // 5,1126963% (revertido de 0,5% reducido)
const VAT_PENINSULA = 0.21;
const VAT_PENINSULA_HOGAR = 0.21;          // 21% IVA residencial (revertido de 10% reducido)
const VAT_CANARIAS_LOW = 0.0;
const VAT_CANARIAS_HIGH = 0.03;
const VAT_BALEARES = 0.21;
const VAT_BALEARES_HOGAR = 0.21;           // 21% IVA residencial Baleares (revertido de 10% reducido)
const VAT_IPSI_CEUTA_MELILLA = 0.01;

function getTaxRates(region, maxPotencia = 0) {
    const reg = (region || '').toUpperCase();
    const lowPower = maxPotencia <= 10; // ≤10 kW → IVA reducido (10%), >10 kW → IVA general (21%)
    if (reg === 'CANARIAS') {
        const vat = lowPower ? VAT_CANARIAS_LOW : VAT_CANARIAS_HIGH;
        return { electricityTax: ELECTRICITY_TAX_STD, vat };
    }
    if (reg === 'CEUTA' || reg === 'MELILLA' || reg === 'CEUTA_MELILLA') {
        return { electricityTax: ELECTRICITY_TAX_STD, vat: VAT_IPSI_CEUTA_MELILLA };
    }
    if (reg === 'BALEARES') {
        const elecTax = lowPower ? ELECTRICITY_TAX_HOGAR_LOW : ELECTRICITY_TAX_STD;
        const vat = lowPower ? VAT_BALEARES_HOGAR : VAT_BALEARES;
        return { electricityTax: elecTax, vat };
    }
    // PENINSULA (default)
    const elecTax = lowPower ? ELECTRICITY_TAX_HOGAR_LOW : ELECTRICITY_TAX_STD;
    const vat = lowPower ? VAT_PENINSULA_HOGAR : VAT_PENINSULA;
    return { electricityTax: elecTax, vat };
}
const SUPPLIER_ALIASES = {
    'GREENING ENERGY': 'GREENING',
    'GREENING': 'GREENING ENERGY',
    'CANALUZ': 'LOCALUZ',
    'LOCALUZ': 'CANALUZ'
};

const SUPPLIER_FILTER_REGION_GROUPS = {
    PENINSULA: 'PENINSULA',
    BALEARES: 'BALEARES_CANARIAS',
    CANARIAS: 'BALEARES_CANARIAS',
    BALEARES_CANARIAS: 'BALEARES_CANARIAS',
    CEUTA: 'CEUTA_MELILLA',
    MELILLA: 'CEUTA_MELILLA',
    CEUTA_MELILLA: 'CEUTA_MELILLA'
};

const ALLOWED_SUPPLIERS_BY_TARIFF_AND_REGION = {
    '2.0TD': {
        PENINSULA: ['ACCIONA', 'CANALUZ', 'ELEIA', 'ENDESA', 'GREENING ENERGY', 'IGNIS', 'LOGOS', 'LOVILUZ', 'NATURGY', 'REPSOL', 'TOTAL ENERGIES', 'TOTAL RESIDENCIAL'],
        BALEARES_CANARIAS: ['ACCIONA', 'CANALUZ','ELEIA', 'ENDESA', 'LOGOS', 'LOVILUZ', 'NATURGY', 'TOTAL RESIDENCIAL'],
        CEUTA_MELILLA: ['ACCIONA', 'CANALUZ', 'ELEIA', 'ENDESA', 'LOVILUZ', 'NATURGY', 'TOTAL RESIDENCIAL']
    },
    '3.0TD': {
        PENINSULA: ['ACCIONA', 'CANALUZ', 'ELEIA', 'GREENING ENERGY', 'IGNIS', 'LOGOS', 'LOVILUZ', 'NATURGY', 'POLARIS', 'REPSOL', 'TOTAL ENERGIES'],
        BALEARES_CANARIAS: ['ACCIONA', 'CANALUZ','ELEIA', 'LOGOS', 'LOVILUZ', 'NATURGY'],
        CEUTA_MELILLA: ['ACCIONA', 'CANALUZ', 'ELEIA', 'LOVILUZ', 'NATURGY']
    },
    '6.1TD': {
        PENINSULA: ['ACCIONA', 'CANALUZ', 'ELEIA', 'GREENING ENERGY', 'IGNIS', 'LOGOS', 'NATURGY', 'REPSOL', 'TOTAL ENERGIES'],
        BALEARES_CANARIAS: ['ACCIONA', 'CANALUZ','ELEIA', 'LOGOS', 'NATURGY'],
        CEUTA_MELILLA: ['ACCIONA', 'CANALUZ', 'ELEIA', 'NATURGY']
    }
};

const SEGMENT_FIELD_NAMES = [
    'segmento',
    'segmentos',
    'segment',
    'segments',
    'clientSegment',
    'clientSegments',
    'tipoCliente',
    'tiposCliente'
];

function supplierKeyVariantsUpper(supplier) {
    const raw = (supplier || '').toString().trim();
    const up = raw.toUpperCase();
    const variants = new Set();
    if (up) variants.add(up);
    if (up === 'GREENING') variants.add('GREENING ENERGY');
    if (up === 'GREENING ENERGY') variants.add('GREENING');
    if (up === 'TOTAL') variants.add('TOTAL ENERGIES');
    if (up === 'TOTAL ENERGIES') variants.add('TOTAL');
    if (up === 'CANALUZ') variants.add('LOCALUZ');
    if (up === 'LOCALUZ') variants.add('CANALUZ');
    return variants;
}

function buildAllowedSupplierSet(suppliers) {
    const set = new Set();
    (suppliers || []).forEach((s) => {
        supplierKeyVariantsUpper(s).forEach(v => set.add(v));
    });
    return set;
}

function getSupplierFilterAllowedSet(tariffType, region) {
    const tariffKey = (tariffType || '').toString().trim().toUpperCase();
    const regKey = normalizeRegion(region);
    const group = SUPPLIER_FILTER_REGION_GROUPS[regKey] || 'PENINSULA';
    const cfg = ALLOWED_SUPPLIERS_BY_TARIFF_AND_REGION[tariffKey];
    if (!cfg || !cfg[group]) return null;
    return buildAllowedSupplierSet(cfg[group]);
}

function normalizeClientSegment(clientType) {
    const raw = (clientType || '').toString().trim().toLowerCase();
    const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!normalized || ['todos', 'todas', 'all', 'global', 'general', 'sin filtro', 'sin-filtro'].includes(normalized)) return 'todos';
    if (normalized === 'hogar' || normalized === 'home' || normalized === 'residencial' || normalized === 'residential') return 'residencial';
    if (normalized === 'autonomo' || normalized === 'autonomous' || normalized === 'freelance') return 'autonomo';
    if (normalized === 'pyme' || normalized === 'pymes' || normalized === 'empresa' || normalized === 'empresas' || normalized === 'business') return 'pyme';
    return normalized;
}

function normalizeOfferSegment(value) {
    const raw = (value || '').toString().trim().toLowerCase();
    const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!normalized) return null;
    if (['general', 'todos', 'todas', 'all', 'mixto', 'mix'].includes(normalized)) return 'general';
    if (['hogar', 'residencial', 'residential', 'domestico', 'domestica'].includes(normalized)) return 'residencial';
    if (['autonomo', 'freelance'].includes(normalized)) return 'autonomo';
    if (['pyme', 'pymes', 'empresa', 'empresas', 'business', 'negocio', 'negocios'].includes(normalized)) return 'pyme';
    return null;
}

function collectExplicitSegments(...configs) {
    const segments = new Set();
    for (const cfg of configs) {
        if (!cfg || typeof cfg !== 'object') continue;
        for (const field of SEGMENT_FIELD_NAMES) {
            const raw = cfg[field];
            const values = Array.isArray(raw)
                ? raw
                : (typeof raw === 'string' ? raw.split(/[,\|/]+/) : [raw]);
            for (const value of values) {
                const segment = normalizeOfferSegment(value);
                if (segment) segments.add(segment);
            }
        }
    }
    return segments;
}

function inferOfferSegments(supplier, productName = '') {
    const supplierKey = (supplier || '').toString().trim().toUpperCase();
    const productKey = (productName || '').toString().trim().toUpperCase();

    if (productKey.includes('HOGAR')) return new Set(['residencial']);
    if (supplierKey === 'TOTAL RESIDENCIAL') return new Set(['residencial']);

    if (supplierKey === 'NATURGY') {
        const isResidential =
            productKey === 'TARIFA POR USO' ||
            productKey === 'TARIFA POR USO LUZ' ||
            productKey === 'TARIFA NOCHE LUZ ECO' ||
            productKey.startsWith('TARIFA POR USO RL');
        if (isResidential) return new Set(['residencial']);
        if (productKey.startsWith('FIJO LUZ')) return new Set(['pyme']);
    }

    if (supplierKey === 'LOGOS') {
        if (productKey.includes('PYME') || productKey.includes('LITE')) return new Set(['pyme']);
    }

    if (supplierKey === 'LOVILUZ' && productKey.includes('OFI')) return new Set(['general']);
    if (supplierKey === 'REPSOL' && productKey.includes('NEGOCIO')) return new Set(['pyme']);

    return new Set(['general']);
}

function isSegmentAllowed(clientSegment, offerSegments) {
    const target = normalizeClientSegment(clientSegment);
    if (target === 'todos') return true;
    if (!offerSegments || offerSegments.size === 0 || offerSegments.has('general')) return true;
    return offerSegments.has(target);
}

function isOfferAllowedForClientType(clientType, supplier, productName = '', productConfig = null, supplierConfig = null) {
    const productSegments = collectExplicitSegments(productConfig);
    const supplierSegments = collectExplicitSegments(supplierConfig);
    const offerSegments = productSegments.size
        ? productSegments
        : (supplierSegments.size ? supplierSegments : inferOfferSegments(supplier, productName));
    return isSegmentAllowed(clientType, offerSegments);
}

let TARIFFS_DATA = null;
let TARIFFS_GAS_DATA = null;
let COMISIONES_DATA = null;
let COMERCIALES_DATA = null;
let AJUSTES_DATA = null;

function loadJSONOnce(file) {
    // Preferir siempre las copias más recientes bajo api/data-private; el resto son fallback
    const candidates = [
        path.join(__dirname, 'api', 'data-private', file), // datos actualizados (dev/prod)
        path.join(__dirname, 'api', 'data', file),         // compatibilidad antigua
        path.join(__dirname, 'data-private', file),        // bundle function (includeFiles)
        path.join(__dirname, 'data', file),                // compat anterior
        path.join(__dirname, file),                        // junto al código
        path.join(process.cwd(), file)                     // entorno local (root)
    ];
    for (const fullPath of candidates) {
        if (fs.existsSync(fullPath)) {
            try {
                return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            } catch (err) {
                const e = new Error(`No se pudo parsear ${file} (JSON invalido)`);
                e.cause = err;
                e.path = fullPath;
                throw e;
            }
        }
    }
    const e = new Error(`No se encontro el archivo ${file} en ninguna ruta conocida`);
    e.paths = candidates;
    throw e;
}

function ensureDataLoaded() {
    // Cargar siempre las versiones minificadas actualizadas de la raíz
    if (!TARIFFS_DATA) TARIFFS_DATA = loadJSONOnce('tarifas.v2.json');
    if (!TARIFFS_GAS_DATA) {
        try {
            TARIFFS_GAS_DATA = loadJSONOnce('tarifas-gas.v2.json');
        } catch (_) {
            TARIFFS_GAS_DATA = null;
        }
    }
    if (!COMISIONES_DATA) COMISIONES_DATA = loadJSONOnce('comisiones.json');
    if (!COMERCIALES_DATA) COMERCIALES_DATA = loadJSONOnce('comerciales.json');
    // Ajustes pueden cambiar sin redeploy (en local) o entre invocaciones (serverless)
    try {
        AJUSTES_DATA = loadJSONOnce('ajustes.json');
    } catch (_) {
        AJUSTES_DATA = { energiaPorKwh: {} };
    }
}

function ensureCommercialsLoaded() {
    if (!COMERCIALES_DATA) COMERCIALES_DATA = loadJSONOnce('comerciales.json');
}

function matchesTariffRestriction(rawList, tariffType) {
    if (!Array.isArray(rawList) || rawList.length === 0) return true;
    const tariffKey = (tariffType || '').toString().trim().toUpperCase();
    if (!tariffKey) return false;
    return rawList.some(item => (item || '').toString().trim().toUpperCase() === tariffKey);
}

function normalizeEnergyAdjustment(rawAdjustment, tariffType) {
    const zero = { mode: 'add', value: 0, adjustments: [] };
    if (typeof rawAdjustment === 'number') {
        const value = Number(rawAdjustment) || 0;
        return value ? { mode: 'add', value, adjustments: [{ mode: 'add', value }] } : zero;
    }
    if (!rawAdjustment || typeof rawAdjustment !== 'object') return zero;

    if (Array.isArray(rawAdjustment.tariffTypes) && !matchesTariffRestriction(rawAdjustment.tariffTypes, tariffType)) {
        return zero;
    }
    if (Array.isArray(rawAdjustment.excludeTariffTypes) && matchesTariffRestriction(rawAdjustment.excludeTariffTypes, tariffType)) {
        return zero;
    }

    if (Array.isArray(rawAdjustment.adjustments)) {
        const adjustments = rawAdjustment.adjustments
            .map(item => normalizeSingleEnergyAdjustment(item, tariffType))
            .filter(item => item && Number(item.value));
        if (!adjustments.length) return zero;
        if (adjustments.length === 1) return { ...adjustments[0], adjustments };
        return {
            mode: 'composite',
            value: adjustments.reduce((sum, item) => sum + (item.mode === 'fixed_monthly' ? item.value : 0), 0),
            adjustments
        };
    }

    const single = normalizeSingleEnergyAdjustment(rawAdjustment, tariffType);
    if (!single || !Number(single.value)) return zero;
    return { ...single, adjustments: [single] };
}

function normalizeSingleEnergyAdjustment(rawAdjustment, tariffType) {
    if (typeof rawAdjustment === 'number') {
        const value = Number(rawAdjustment) || 0;
        return value ? { mode: 'add', value } : null;
    }
    if (!rawAdjustment || typeof rawAdjustment !== 'object') return null;

    if (Array.isArray(rawAdjustment.tariffTypes) && !matchesTariffRestriction(rawAdjustment.tariffTypes, tariffType)) {
        return null;
    }
    if (Array.isArray(rawAdjustment.excludeTariffTypes) && matchesTariffRestriction(rawAdjustment.excludeTariffTypes, tariffType)) {
        return null;
    }

    const mode = (rawAdjustment.mode || rawAdjustment.type || '').toString().trim().toLowerCase();
    const rawValue = rawAdjustment.value !== undefined ? rawAdjustment.value : rawAdjustment.monthlyAmount;
    const value = Number(rawValue);
    if ((mode === 'factor' || mode === 'mul' || mode === 'multiply') && Number.isFinite(value)) return { mode: 'factor', value };
    if ((mode === 'add' || mode === 'sum') && Number.isFinite(value)) return { mode: 'add', value };
    if ((mode === 'fixed_monthly' || mode === 'monthly' || mode === 'fixed-monthly') && Number.isFinite(value)) {
        return { mode: 'fixed_monthly', value };
    }
    return null;
}

function getNormalizedAdjustmentList(adjustment) {
    if (!adjustment || typeof adjustment !== 'object') return [];
    if (Array.isArray(adjustment.adjustments)) return adjustment.adjustments.filter(item => item && Number(item.value));
    if (Number(adjustment.value)) return [{ mode: adjustment.mode || 'add', value: Number(adjustment.value) || 0 }];
    return [];
}

function getEnergyAdjustmentConfig(supplier, productName, tariffType) {
    const supplierKey = (supplier || '').toUpperCase();
    const productKey = (productName || '').toUpperCase();
    const cfg = AJUSTES_DATA && AJUSTES_DATA.energiaPorKwh ? AJUSTES_DATA.energiaPorKwh[supplierKey] : null;
    if (!cfg) return { mode: 'add', value: 0, adjustments: [] };
    if (typeof cfg === 'number') return normalizeEnergyAdjustment(cfg, tariffType);
    const products = cfg.products || {};
    for (const [name, raw] of Object.entries(products)) {
        if ((name || '').toString().trim().toUpperCase() !== productKey) continue;
        return normalizeEnergyAdjustment(raw, tariffType);
    }
    const prefixes = cfg.prefixes || {};
    for (const [prefix, raw] of Object.entries(prefixes)) {
        if (!productKey.startsWith((prefix || '').toUpperCase())) continue;
        return normalizeEnergyAdjustment(raw, tariffType);
    }
    const contains = cfg.contains || {};
    for (const [fragment, raw] of Object.entries(contains)) {
        if (!productKey.includes((fragment || '').toUpperCase())) continue;
        return normalizeEnergyAdjustment(raw, tariffType);
    }
    return normalizeEnergyAdjustment(cfg.default, tariffType);
}

function applyEnergyAdjustment(consumo, adjustment) {
    if (!consumo || typeof consumo !== 'object') return consumo;
    const out = { ...consumo };
    const adjustments = getNormalizedAdjustmentList(adjustment);
    if (!adjustments.length) return consumo;
    for (const adj of adjustments) {
        const mode = (adj.mode || 'add').toString().toLowerCase();
        const value = Number(adj.value) || 0;
        if (!value || mode === 'fixed_monthly') continue;
        for (const k of Object.keys(out)) {
            const v = out[k];
            if (typeof v !== 'number') continue;
            if (mode === 'factor') out[k] = Number((out[k] * (1 + value)).toFixed(6));
            else out[k] = Number((out[k] + value).toFixed(6));
        }
    }
    return out;
}

function getEnergyPeriodsForTariff(tariffType) {
    const t = (tariffType || '').toString().trim().toUpperCase();
    return t === '2.0TD' ? ['P1', 'P2', 'P3'] : ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
}

function calculateEnergyCostFromPrices(formData, consumoPrices, tariffType) {
    let energyCost = 0;
    const periods = getEnergyPeriodsForTariff(tariffType);
    for (const p of periods) {
        const kwh = parseFloat(formData[`consumption${p}`] || 0) || 0;
        const price = consumoPrices && typeof consumoPrices === 'object' ? consumoPrices[p] : null;
        if (typeof price === 'number' && Number.isFinite(price) && price > 0) energyCost += kwh * price;
    }
    return energyCost;
}

// Suppliers for which the energy adjustment (factor/add) must be shown as a separate
// "Ajustes de Servicios" line rather than baked into the per-kWh display price.
const SEPARATE_SERVICE_ADJUSTMENT_SUPPLIERS = new Set([
    'TOTAL ENERGIES', 'IGNIS', 'CANALUZ', 'LOVILUZ'
]);

function calculateServiceAdjustmentAmount(formData, consumoPrices, adjustment, tariffType, supplier) {
    let amount = 0;
    const adjustments = getNormalizedAdjustmentList(adjustment);
    if (!adjustments.length) return 0;
    const billingDays = Math.max(1, parseFloat(formData?.billingDays) || 30);
    const supplierUpper = (supplier || '').toString().trim().toUpperCase();
    const separateAdjustment = SEPARATE_SERVICE_ADJUSTMENT_SUPPLIERS.has(supplierUpper) ||
        (supplierUpper === 'CANALUZ' && isCanaluzSinSSAA);
    for (const adj of adjustments) {
        const mode = (adj.mode || 'add').toString().toLowerCase();
        const value = Number(adj.value) || 0;
        if (!value) continue;
        if (mode === 'fixed_monthly') {
            amount += value * (billingDays / 30);
        } else if (separateAdjustment && consumoPrices && typeof consumoPrices === 'object') {
            const periods = getEnergyPeriodsForTariff(tariffType);
            for (const p of periods) {
                const kwh = parseFloat(formData[`consumption${p}`] || 0) || 0;
                const basePrice = consumoPrices[p];
                if (typeof basePrice === 'number' && Number.isFinite(basePrice) && basePrice > 0 && kwh > 0) {
                    if (mode === 'factor') amount += basePrice * value * kwh;
                    else if (mode === 'add') amount += value * kwh;
                }
            }
        }
    }
    return amount;
}

function getServiceAdjustmentLabel(supplier, productName, adjustment) {
    const adjustments = getNormalizedAdjustmentList(adjustment);
    const supplierKey = (supplier || '').toString().trim().toUpperCase();
    const productKey = (productName || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

    const hasFixedMonthly = adjustments.some((adj) => (adj.mode || '').toString().toLowerCase() === 'fixed_monthly' && Number(adj.value));
    const hasSeparableFactor = SEPARATE_SERVICE_ADJUSTMENT_SUPPLIERS.has(supplierKey) &&
        adjustments.some((adj) => (adj.mode || '').toString().toLowerCase() !== 'fixed_monthly' && Number(adj.value));

    if (!hasFixedMonthly && !hasSeparableFactor) return '';

    return 'Ajustes de servicio';
}

function normalizeRegion(region) {
    const reg = (region || 'PENINSULA').toString().toUpperCase();
    return reg;
}

function pickRegionalValue(map, region) {
    if (!map || typeof map !== 'object') return null;
    const reg = normalizeRegion(region);
    if (map[reg]) return map[reg];
    if ((reg === 'CEUTA' || reg === 'MELILLA') && map.CEUTA_MELILLA) return map.CEUTA_MELILLA;
    if (reg === 'CEUTA_MELILLA') {
        if (map.CEUTA_MELILLA) return map.CEUTA_MELILLA;
        if (map.CEUTA) return map.CEUTA;
        if (map.MELILLA) return map.MELILLA;
        if (map.PENINSULA) return map.PENINSULA;
    }
    if (map.PENINSULA) return map.PENINSULA;
    return null;
}

function getFacilConsumptionRule(tariffType, productName) {
    const name = (productName || '').toString().toUpperCase();
    if (!name.includes('FACIL')) return null;
    if (name.includes('FACIL ON')) return { limit: 5000, inclusive: false };
    const tariff = (tariffType || '').toString().trim().toUpperCase();
    if (tariff === '2.0TD') return { limit: 30000, inclusive: true };
    if (tariff === '3.0TD') return { limit: 50000, inclusive: false };
    return null;
}

function exceedsFacilConsumptionRule(consumoAnual, tariffType, productName) {
    const rule = getFacilConsumptionRule(tariffType, productName);
    if (!rule || !Number.isFinite(Number(rule.limit))) return false;
    const limit = Number(rule.limit);
    return rule.inclusive ? consumoAnual > limit : consumoAnual >= limit;
}

function getConsumoForRegion(entry, region) {
    if (!entry || typeof entry !== 'object') return null;
    const base = entry.periodosConsumo || entry.consumo || null;
    const byRegion = entry.periodosConsumoPorRegion || entry.consumoPorRegion || null;
    const picked = pickRegionalValue(byRegion, region);
    return picked && typeof picked === 'object' ? picked : base;
}

function getPotenciaForRegion(entry, region) {
    if (!entry || typeof entry !== 'object') return null;
    const base = entry.periodosPotencia || entry.potencia || null;
    const byRegion = entry.periodosPotenciaPorRegion || entry.potenciaPorRegion || null;
    const picked = pickRegionalValue(byRegion, region);
    return picked && typeof picked === 'object' ? picked : base;
}

function getComisionPorBloque(bloques, valor) {
    for (const bloque of bloques) {
        const desde = (bloque.desde !== undefined && bloque.desde !== null) ? bloque.desde : 0;
        const hasta = (bloque.hasta !== undefined && bloque.hasta !== null) ? bloque.hasta : Infinity;
        if (valor >= desde && valor <= hasta) {
            if (typeof bloque.comision !== 'undefined') return bloque.comision || 0;
            if (bloque.bloques_consumo) return getComisionPorBloque(bloque.bloques_consumo, valor);
        }
    }
    const ultimoBloque = bloques[bloques.length - 1];
    if (ultimoBloque) {
        const limiteMax = (ultimoBloque.hasta !== undefined && ultimoBloque.hasta !== null) ? ultimoBloque.hasta : Infinity;
        if (valor > limiteMax) {
            return ultimoBloque.comision || 0;
        }
    }
    return 0;
}

function normalizeText(value) {
    return (value ?? '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function productVariantCode(value) {
    const match = normalizeText(value).match(/^(?:[236]\s+)?([vls])\s*(\d+)\b/);
    return match ? `${match[1]}${match[2]}` : null;
}

function isEnergyGreenProduct(value) {
    return normalizeText(value).includes('energia verde');
}

function loviluzCommissionVariants(productName) {
    const productNorm = normalizeText(productName);
    const variants = new Set([productNorm]);
    if (productNorm.includes('sin ssaa')) {
        variants.add(productNorm.replace(/sin ssaa/g, 'con ssaa'));
    }
    if (productNorm.includes('con ssaa')) {
        variants.add(productNorm.replace(/con ssaa/g, 'sin ssaa'));
    }
    return [...variants];
}

function normalizeLoviluzProductRoot(productName) {
    const raw = normalizeText(productName)
        .replace(/^tarifa\s+/g, '')
        .replace(/^lov\s+/g, 'lov ')
        .replace(/\b(ssaa\s+fuera|ssaa\s+no\s+incluidos|sin\s+ssaa|con\s+ssaa|unica|periodos|incluidos|no\s+incluidos)\b/g, ' ')
        .replace(/\b(periodic|index)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return raw;
}

function productVariantCode(productName) {
    const normalized = normalizeText(productName);
    const match = normalized.match(/^(?:[236]\s+)?([vls])\s*(\d+)\b/);
    return match ? `${match[1]}${match[2]}` : null;
}

function findCommissionProductKey(products, productName, supplier) {
    if (!products || typeof products !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(products, productName)) return productName;

    const productNorm = normalizeText(productName);
    const candidates = Object.keys(products)
        .map((key) => ({ key, norm: normalizeText(key) }))
        .filter((item) => item.norm);

    const exact = candidates.find((item) => item.norm === productNorm);
    if (exact) return exact.key;

    const variantCode = productVariantCode(productName);
    if (variantCode) {
        const byVariant = candidates.filter((item) => productVariantCode(item.key) === variantCode);
        const selected = byVariant.sort((a, b) => a.norm.length - b.norm.length)[0];
        if (selected) return selected.key;
    }

    const supplierUpper = (supplier || '').toString().trim().toUpperCase();
    if (supplierUpper === 'LOVILUZ') {
        const productRoot = normalizeLoviluzProductRoot(productName);
        const rootMatch = candidates.find((item) => normalizeLoviluzProductRoot(item.key) === productRoot);
        if (rootMatch) return rootMatch.key;
        for (const variant of loviluzCommissionVariants(productName)) {
            const lovMatch = candidates.find((item) => item.norm === variant);
            if (lovMatch) return lovMatch.key;
        }
    }
    if (supplierUpper === 'CANALUZ' || supplierUpper === 'LOCALUZ') {
        if (variantCode) {
            const byVariant = candidates.filter((item) => productVariantCode(item.key) === variantCode);
            const sameGreenFlag = byVariant.filter((item) => isEnergyGreenProduct(item.key) === isEnergyGreenProduct(productName));
            const selected = (sameGreenFlag.length ? sameGreenFlag : byVariant)
                .sort((a, b) => a.norm.length - b.norm.length)[0];
            if (selected) return selected.key;
        }
    }

    const contains = candidates
        .filter((item) => productNorm.includes(item.norm) || item.norm.includes(productNorm))
        .sort((a, b) => b.norm.length - a.norm.length)[0];
    return contains ? contains.key : null;
}

function findCommissionSupplierKey(supplier) {
    if (!COMISIONES_DATA) return null;
    const raw = (supplier || '').toString().trim();
    const upper = raw.toUpperCase();
    const variants = [raw, upper, SUPPLIER_ALIASES[upper]].filter(Boolean);
    return variants.find((key) => Object.prototype.hasOwnProperty.call(COMISIONES_DATA, key)) || null;
}

function hasCommissionProduct(supplier, productName, tariffType) {
    const supplierKey = findCommissionSupplierKey(supplier);
    if (!supplierKey) return false;
    const supplierComisiones = COMISIONES_DATA[supplierKey];
    if (supplierComisiones.tarifas && tariffType) {
        const tarifaComisiones = supplierComisiones.tarifas[tariffType];
        if (findCommissionProductKey(tarifaComisiones, productName, supplierKey)) return true;
    }
    if (findCommissionProductKey(supplierComisiones.productos, productName, supplierKey)) return true;
    return false;
}

function getComision(supplier, productName, totalConsumoAnual, potenciaP1, tariffType) {
    const supplierKey = findCommissionSupplierKey(supplier);
    if (!supplierKey) return 0;
    const supplierComisiones = COMISIONES_DATA[supplierKey];

    if (supplierComisiones.tarifas && tariffType) {
        const tarifaComisiones = supplierComisiones.tarifas[tariffType];
        const productKey = findCommissionProductKey(tarifaComisiones, productName, supplierKey);
        if (tarifaComisiones && productKey) {
            const productoConfig = tarifaComisiones[productKey];
            const limiteConsumo = Number(productoConfig.limite_consumo);
            if (productoConfig.tipo === 'fija') {
                return productoConfig.comision || 0;
            } else if (productoConfig.tipo === 'ajuste') {
                const serviceAdjustment = getEnergyAdjustmentConfig(supplier, productName, tariffType);
                const adjValue = serviceAdjustment && serviceAdjustment.value ? Number(serviceAdjustment.value) : 0;
                return totalConsumoAnual * adjValue;
            } else if (productoConfig.tipo === 'formula' && productoConfig.criterio === 'consumo_formula') {
                if (Number.isFinite(limiteConsumo) && limiteConsumo > 0 && totalConsumoAnual <= limiteConsumo) {
                    return productoConfig.base;
                }
                return productoConfig.base + Math.floor(totalConsumoAnual / 1000) * productoConfig.factor;
            } else if (Number.isFinite(limiteConsumo) && limiteConsumo > 0 && totalConsumoAnual > limiteConsumo) {
                return 0;
            } else if (productoConfig.tipo === 'variable' && productoConfig.bloques) {
                const criterio = productoConfig.criterio || 'consumo';
                if (criterio === 'potencia_consumo') {
                    const bloquePotencia = productoConfig.bloques.find(bloque => {
                        const desde = (bloque.desde !== undefined && bloque.desde !== null) ? bloque.desde : 0;
                        const hasta = (bloque.hasta !== undefined && bloque.hasta !== null) ? bloque.hasta : Infinity;
                        return potenciaP1 >= desde && potenciaP1 <= hasta;
                    });
                    if (bloquePotencia && bloquePotencia.bloques_consumo) {
                        return getComisionPorBloque(bloquePotencia.bloques_consumo, totalConsumoAnual);
                    }
                    return 0;
                }
                const valor = criterio === 'potencia' ? potenciaP1 : totalConsumoAnual;
                return getComisionPorBloque(productoConfig.bloques, valor);
            }
        }
    }

    const productKey = findCommissionProductKey(supplierComisiones.productos, productName, supplierKey);
    if (supplierComisiones.productos && productKey) {
        const productoConfig = supplierComisiones.productos[productKey];
        const limiteConsumo = Number(productoConfig?.limite_consumo);
        if (typeof productoConfig === 'object' && productoConfig.tipo) {
            if (productoConfig.tipo === 'fija') return productoConfig.comision || 0;
            if (productoConfig.tipo === 'ajuste') {
                const serviceAdjustment = getEnergyAdjustmentConfig(supplier, productName, tariffType);
                const adjValue = serviceAdjustment && serviceAdjustment.value ? Number(serviceAdjustment.value) : 0;
                return totalConsumoAnual * adjValue;
            }
            if (productoConfig.tipo === 'formula' && productoConfig.criterio === 'consumo_formula') {
                if (Number.isFinite(limiteConsumo) && limiteConsumo > 0 && totalConsumoAnual <= limiteConsumo) {
                    return productoConfig.base;
                }
                return productoConfig.base + Math.floor(totalConsumoAnual / 1000) * productoConfig.factor;
            } else if (Number.isFinite(limiteConsumo) && limiteConsumo > 0 && totalConsumoAnual > limiteConsumo) {
                return 0;
            } else if (productoConfig.tipo === 'variable' && productoConfig.bloques) {
                const criterio = productoConfig.criterio || 'consumo';
                if (criterio === 'potencia_consumo') {
                    const bloquePotencia = productoConfig.bloques.find(bloque => {
                        const desde = bloque.desde || 0;
                        const hasta = bloque.hasta;
                        return potenciaP1 >= desde && (hasta === null || potenciaP1 <= hasta);
                    });
                    if (bloquePotencia && bloquePotencia.bloques_consumo) {
                        return getComisionPorBloque(bloquePotencia.bloques_consumo, totalConsumoAnual);
                    }
                    return 0;
                }
                const valor = criterio === 'potencia' ? potenciaP1 : totalConsumoAnual;
                return getComisionPorBloque(productoConfig.bloques, valor);
            }
        } else if (typeof productoConfig === 'number') {
            return productoConfig;
        }
    }

    if (supplierComisiones.tipo === 'fija') return supplierComisiones.default || 0;
    if (supplierComisiones.tipo === 'variable' && supplierComisiones.bloques) {
        const criterio = supplierComisiones.criterio || 'consumo';
        const valor = criterio === 'potencia' ? potenciaP1 : totalConsumoAnual;
        return getComisionPorBloque(supplierComisiones.bloques, valor);
    }
    return 0;
}

function getComisionPersonalizada(porcentajes, supplier, ...args) {
    if (!porcentajes) return 0;
    const supplierKey = (supplier || '').toString().trim();
    const alias = SUPPLIER_ALIASES[supplierKey];

    const hasSupplier = Object.prototype.hasOwnProperty.call(porcentajes, supplierKey);
    const hasAlias = alias && Object.prototype.hasOwnProperty.call(porcentajes, alias);
    const porcentaje = hasSupplier ? porcentajes[supplierKey] : (hasAlias ? porcentajes[alias] : 0);
    if (porcentaje === 0) return 0;

    const base = getComision(supplier, ...args);
    const supplierUpper = supplierKey.toUpperCase();
    const adjusted = (base * porcentaje);
    return Math.max(0, adjusted);
}

function calculateBill(formData, tariff) {
    const tariffType = formData.tariffType;
    const periods_consumo = tariffType === "2.0TD" ? ["P1", "P2", "P3"] : ["P1", "P2", "P3", "P4", "P5", "P6"];
    const periods_potencia = tariffType === "2.0TD" ? ["P1", "P2"] : ["P1", "P2", "P3", "P4", "P5", "P6"];
    const potValues = periods_potencia.map(p => parseFloat(formData[`potencia${p}`] || 0));
    const maxPotencia = Math.max(...potValues, 0);
    const taxes = getTaxRates(formData.region, maxPotencia, formData.clientType);

    // Si los datos vienen de un PDF, usamos los impuestos leídos de la propia factura.
    // Si son datos manuales (sin PDF), pdfVatRate y pdfElectricityTaxRate serán nulos/0
    // y se mantienen los valores hardcodeados de getTaxRates().
    const _pdfVat = parseFloat(formData.pdfVatRate);
    const _pdfElec = parseFloat(formData.pdfElectricityTaxRate);
    const effectiveVat = (Number.isFinite(_pdfVat) && _pdfVat > 0) ? _pdfVat : taxes.vat;
    const effectiveElecTax = (Number.isFinite(_pdfElec) && _pdfElec > 0) ? _pdfElec : taxes.electricityTax;

    let energyCost = 0;
    periods_consumo.forEach(p => {
        const consumption = parseFloat(formData[`consumption${p}`] || 0);
        const price = tariff.consumo[p];
        if (price) energyCost += consumption * price;
    });

    let powerCost = 0;
    periods_potencia.forEach(p => {
        const power = parseFloat(formData[`potencia${p}`] || 0);
        const pricePerDay = tariff.potencia[p];
        if (pricePerDay) powerCost += power * pricePerDay * parseInt(formData.billingDays);
    });

    // Descuentos de la comercializadora actual NO deben aplicarse a nuevas ofertas.
    // Solo mantenemos "excedentes" (surpluses) como descuento recurrente potencial.
    const discountEnergy = 0;
    const discountPower = 0;
    const reactiveEnergy = Math.max(0, parseFloat(formData.reactiveEnergy || 0));
    const excessPower = Math.max(0, parseFloat(formData.excessPower || 0));
    const serviceAdjustmentAmount = Math.max(0, parseFloat(tariff.serviceAdjustmentAmount || 0));
    // Excedentes (solar) vienen como importe en euros que reduce la factura.
    // Aceptamos valores negativos (como en algunas facturas) pero lo tratamos como descuento.
    const surpluses = Math.max(0, Math.abs(parseFloat(formData.surpluses || 0)));

    const subtotal = (
        energyCost +
        powerCost +
        reactiveEnergy +
        excessPower +
        serviceAdjustmentAmount +
        parseFloat(formData.equipmentRental || 0) +
        parseFloat(formData.otherCosts || 0) -
        surpluses
    );
    const electricityTax = subtotal * effectiveElecTax;
    const taxableBase = subtotal + electricityTax;
    const vatAmount = taxableBase * effectiveVat;
    const total = taxableBase + vatAmount;
    const savings = parseFloat(formData.currentBill) - total;

    const billingDays = parseInt(formData.billingDays) || 30;
    const dailySavings = savings / billingDays;
    const annualSavings = dailySavings * 365;

    return {
        energyCost,
        powerCost,
        discounts: { energy: discountEnergy, power: discountPower },
        extras: { reactiveEnergy, excessPower },
        serviceAdjustmentAmount,
        serviceAdjustmentLabel: tariff.serviceAdjustmentLabel || '',
        equipmentRental: parseFloat(formData.equipmentRental || 0),
        otherCosts: parseFloat(formData.otherCosts || 0),
        electricityTax,
        vat: vatAmount,
        vatRate: effectiveVat,
        electricityTaxRate: effectiveElecTax,
        subtotal,
        taxableBase,
        total,
        savings,
        savingsPercent: (savings / parseFloat(formData.currentBill)) * 100,
        monthlySavings: savings,
        annualSavings: annualSavings
    };
}

function calculateGasBill(formData, product) {
    // product: { terminoFijoDiario, terminoVariableKwh, band, nombre }
    const consumptionKwh = parseFloat(formData.gasMonthlyConsumption || 0) || 0;
    const billingDays = parseInt(formData.billingDays) || 30;
    const fixedDaily = Number(product.terminoFijoDiario) || 0;
    const variableKwh = Number(product.terminoVariableKwh) || 0;

    const energyCost = consumptionKwh * variableKwh;
    const powerCost = fixedDaily * billingDays; // fixed term for gas (€/day)

    const equipmentRental = parseFloat(formData.equipmentRental || 0) || 0;
    const otherCosts = parseFloat(formData.otherCosts || 0) || 0;

    const subtotal = energyCost + powerCost + equipmentRental + otherCosts;

    // Impuesto hidrocarburos (aprox). Se modela como "electricityTax" para reutilizar el desglose.
    const hydrocarbonTax = 0.00234 * consumptionKwh;

    const taxes = getTaxRates(formData.region, 0, formData.clientType);
    // Gas: usa el IVA del PDF si fue extraído, o el hardcodeado en caso contrario.
    const _pdfVatGas = parseFloat(formData.pdfVatRate);
    const effectiveVatGas = (Number.isFinite(_pdfVatGas) && _pdfVatGas > 0) ? _pdfVatGas : taxes.vat;
    const taxableBase = subtotal + hydrocarbonTax;
    const vatAmount = taxableBase * effectiveVatGas;
    const total = taxableBase + vatAmount;
    const savings = parseFloat(formData.currentBill || 0) - total;

    const dailySavings = savings / billingDays;
    const annualSavings = dailySavings * 365;

    return {
        energyCost,
        powerCost,
        discounts: { energy: 0, power: 0 },
        extras: { reactiveEnergy: 0, excessPower: 0 },
        equipmentRental,
        otherCosts,
        electricityTax: hydrocarbonTax,
        vat: vatAmount,
        vatRate: effectiveVatGas,
        electricityTaxRate: taxes.electricityTax,
        subtotal,
        taxableBase,
        total,
        savings,
        savingsPercent: (parseFloat(formData.currentBill || 0) > 0) ? (savings / parseFloat(formData.currentBill)) * 100 : 0,
        monthlySavings: savings,
        annualSavings
    };
}

function calculateComparison(formData, porcentajes, sortMode = 'savings') {
    const results = [];
    const typeBlock = TARIFFS_DATA[formData.tariffType] || {};
    const consumoAnual = parseFloat(formData.cae) || 0;
    const potenciaValues = Object.keys(formData)
        .filter(k => k.startsWith('potencia'))
        .map(k => parseFloat(formData[k]) || 0);
    const maxPotencia = Math.max(...potenciaValues, 0);

    const allowedSuppliers = getSupplierFilterAllowedSet(formData.tariffType, formData.region);

    for (const supplier of Object.keys(typeBlock)) {
        if (allowedSuppliers) {
            const supplierVariants = supplierKeyVariantsUpper(supplier);
            const isAllowed = [...supplierVariants].some(v => allowedSuppliers.has(v));
            if (!isAllowed) continue;
        }
        const supplierKey = supplier.toString().trim().toUpperCase();
        const alias = SUPPLIER_ALIASES[supplierKey];
        const hasSupplier = porcentajes && Object.prototype.hasOwnProperty.call(porcentajes, supplierKey);
        const hasAlias = porcentajes && alias && Object.prototype.hasOwnProperty.call(porcentajes, alias);
        const porcentaje = porcentajes ? (hasSupplier ? porcentajes[supplierKey] : (hasAlias ? porcentajes[alias] : 0)) : 0;
        if (porcentaje === 0) continue;

        const supplierData = typeBlock[supplier] || {};
        if (supplierData.activo === false) continue;
        const productos = supplierData.productos;
        if (Array.isArray(productos)) {
            productos.forEach(prod => {
                if (prod.activo === false) return;
                const prodName = (prod && (prod.nombre || prod.name)) ? String(prod.nombre || prod.name) : '';
                if (!isOfferAllowedForClientType(formData.clientType, supplier, prodName, prod, supplierData)) return;
                if (exceedsFacilConsumptionRule(consumoAnual, formData.tariffType, prodName)) return;

                const potenciaMin = (prod && prod.potenciaMin !== undefined && prod.potenciaMin !== null) ? parseFloat(prod.potenciaMin) : null;
                const potenciaMax = (prod && prod.potenciaMax !== undefined && prod.potenciaMax !== null) ? parseFloat(prod.potenciaMax) : null;
                if (potenciaMin !== null && !Number.isNaN(potenciaMin) && maxPotencia < potenciaMin) return;
                if (potenciaMax !== null && !Number.isNaN(potenciaMax) && maxPotencia > potenciaMax) return;

                const consumoAnualMin = (prod && prod.consumoAnualMin !== undefined && prod.consumoAnualMin !== null) ? parseFloat(prod.consumoAnualMin) : null;
                const consumoAnualMax = (prod && prod.consumoAnualMax !== undefined && prod.consumoAnualMax !== null) ? parseFloat(prod.consumoAnualMax) : null;
                if (consumoAnualMin !== null && !Number.isNaN(consumoAnualMin) && consumoAnual < consumoAnualMin) return;
                if (consumoAnualMax !== null && !Number.isNaN(consumoAnualMax) && consumoAnual > consumoAnualMax) return;

                const consumo = getConsumoForRegion(prod, formData.region);
                const potencia = getPotenciaForRegion(prod, formData.region);
                if (!consumo || !potencia) return;
                let potenciaP1 = 0;
                if (potencia && typeof potencia === 'object' && potencia.P1 !== undefined) {
                    potenciaP1 = parseFloat(potencia.P1) || 0;
                } else if (typeof potencia === 'number') {
                    potenciaP1 = potencia;
                }
                // Keep original name resolution for display
                const prodNameFinal = prodName || 'Producto';
                const supplierUpper = supplier.toString().trim().toUpperCase();
                const isCanaluzSinSSAA = supplierUpper === 'CANALUZ' && /(?:sin|s\/)\s*ssaa/i.test(prodNameFinal);
                let serviceAdjustment = getEnergyAdjustmentConfig(supplier, prodNameFinal, formData.tariffType);
                if (isCanaluzSinSSAA) serviceAdjustment = { mode: 'add', value: 0, adjustments: [] };
                const pricingConsumoBase = consumo;
                const separateAdjustment = SEPARATE_SERVICE_ADJUSTMENT_SUPPLIERS.has(supplierUpper);
                // For display: show base price per kWh; adjustment shown as separate line
                const pricingConsumoDisplay = separateAdjustment ? pricingConsumoBase : applyEnergyAdjustment(pricingConsumoBase, serviceAdjustment);
                const consumoForBill = separateAdjustment ? pricingConsumoBase : applyEnergyAdjustment(pricingConsumoBase, serviceAdjustment);
                let serviceAdjustmentAmountForBill = separateAdjustment
                    ? calculateServiceAdjustmentAmount(formData, pricingConsumoBase, serviceAdjustment, formData.tariffType, supplier)
                    : calculateServiceAdjustmentAmount(formData, pricingConsumoBase, serviceAdjustment, formData.tariffType, null);
                if (isCanaluzSinSSAA) {
                    const periods = getEnergyPeriodsForTariff(formData.tariffType);
                    const totalKwh = periods.reduce((s, p) => s + (parseFloat(formData[`consumption${p}`]) || 0), 0);
                    serviceAdjustmentAmountForBill = (totalKwh / 1000) * 23.1;
                }
                const serviceAdjustmentLabel = isCanaluzSinSSAA ? 'Ajustes de servicio' : getServiceAdjustmentLabel(supplier, prodNameFinal, serviceAdjustment);
                const serviceAdjustmentAmount = serviceAdjustmentAmountForBill;
                const energyCostBase = calculateEnergyCostFromPrices(formData, pricingConsumoBase, formData.tariffType);
                const calc = calculateBill(formData, { consumo: consumoForBill, potencia, serviceAdjustmentAmount: serviceAdjustmentAmountForBill, serviceAdjustmentLabel });
                const comision = getComisionPersonalizada(porcentajes, supplier, prodNameFinal, consumoAnual, maxPotencia, formData.tariffType);
                results.push({
                    supplier,
                    productName: prodNameFinal,
                    pricingConsumo: pricingConsumoDisplay,
                    pricingConsumoBase,
                    serviceAdjustmentMode: serviceAdjustment.mode,
                    serviceAdjustmentValue: serviceAdjustment.value,
                    serviceAdjustmentAmount,
                    serviceAdjustmentLabel,
                    energyCostBase,
                    pricingPotencia: potencia,
                    comision: comision,
                    comisionAmount: comision,
                    ...calc
                });
            });
        } else if (productos && typeof productos === 'object') {
            for (const productName of Object.keys(productos)) {
                const item = productos[productName];
                if (item && item.activo === false) continue;
                if (!isOfferAllowedForClientType(formData.clientType, supplier, productName, item, supplierData)) continue;
                if (exceedsFacilConsumptionRule(consumoAnual, formData.tariffType, productName)) continue;
                const potenciaMin = (item && item.potenciaMin !== undefined && item.potenciaMin !== null) ? parseFloat(item.potenciaMin) : null;
                const potenciaMax = (item && item.potenciaMax !== undefined && item.potenciaMax !== null) ? parseFloat(item.potenciaMax) : null;
                if (potenciaMin !== null && !Number.isNaN(potenciaMin) && maxPotencia < potenciaMin) continue;
                if (potenciaMax !== null && !Number.isNaN(potenciaMax) && maxPotencia > potenciaMax) continue;

                const consumoAnualMin = (item && item.consumoAnualMin !== undefined && item.consumoAnualMin !== null) ? parseFloat(item.consumoAnualMin) : null;
                const consumoAnualMax = (item && item.consumoAnualMax !== undefined && item.consumoAnualMax !== null) ? parseFloat(item.consumoAnualMax) : null;
                if (consumoAnualMin !== null && !Number.isNaN(consumoAnualMin) && consumoAnual < consumoAnualMin) continue;
                if (consumoAnualMax !== null && !Number.isNaN(consumoAnualMax) && consumoAnual > consumoAnualMax) continue;

                const consumo = getConsumoForRegion(item, formData.region);
                const potencia = getPotenciaForRegion(item, formData.region);
                if (!consumo || !potencia) continue;
                let potenciaP1 = 0;
                if (potencia && typeof potencia === 'object' && potencia.P1 !== undefined) {
                    potenciaP1 = parseFloat(potencia.P1) || 0;
                } else if (typeof potencia === 'number') {
                    potenciaP1 = potencia;
                }
                const supplierUpperInner = supplier.toString().trim().toUpperCase();
                const isCanaluzSinSSAAInner = supplierUpperInner === 'CANALUZ' && /(?:sin|s\/)\s*ssaa/i.test(productName);
                let serviceAdjustmentInner = getEnergyAdjustmentConfig(supplier, productName, formData.tariffType);
                if (isCanaluzSinSSAAInner) serviceAdjustmentInner = { mode: 'add', value: 0, adjustments: [] };
                const pricingConsumoBase = consumo;
                const separateAdjustmentInner = SEPARATE_SERVICE_ADJUSTMENT_SUPPLIERS.has(supplierUpperInner) ||
                    (supplierUpperInner === 'CANALUZ' && isCanaluzSinSSAAInner);
                const pricingConsumoDisplayInner = separateAdjustmentInner ? pricingConsumoBase : applyEnergyAdjustment(pricingConsumoBase, serviceAdjustmentInner);
                const consumoForBillInner = separateAdjustmentInner ? pricingConsumoBase : applyEnergyAdjustment(pricingConsumoBase, serviceAdjustmentInner);
                let serviceAdjustmentAmountForBillInner = separateAdjustmentInner
                    ? calculateServiceAdjustmentAmount(formData, pricingConsumoBase, serviceAdjustmentInner, formData.tariffType, supplier)
                    : calculateServiceAdjustmentAmount(formData, pricingConsumoBase, serviceAdjustmentInner, formData.tariffType, null);
                if (isCanaluzSinSSAAInner) {
                    const periods = getEnergyPeriodsForTariff(formData.tariffType);
                    const totalKwh = periods.reduce((s, p) => s + (parseFloat(formData[`consumption${p}`]) || 0), 0);
                    serviceAdjustmentAmountForBillInner = (totalKwh / 1000) * 23.1;
                }
                const serviceAdjustmentLabelInner = isCanaluzSinSSAAInner ? 'Ajustes de servicio' : getServiceAdjustmentLabel(supplier, productName, serviceAdjustmentInner);
                const serviceAdjustmentAmountInner = serviceAdjustmentAmountForBillInner;
                const energyCostBase = calculateEnergyCostFromPrices(formData, pricingConsumoBase, formData.tariffType);
                const calc = calculateBill(formData, { consumo: consumoForBillInner, potencia, serviceAdjustmentAmount: serviceAdjustmentAmountForBillInner, serviceAdjustmentLabel: serviceAdjustmentLabelInner });
                const comision = getComisionPersonalizada(porcentajes, supplier, productName, consumoAnual, maxPotencia, formData.tariffType);
                results.push({
                    supplier,
                    productName,
                    pricingConsumo: pricingConsumoDisplayInner,
                    pricingConsumoBase,
                    serviceAdjustmentMode: serviceAdjustmentInner.mode,
                    serviceAdjustmentValue: serviceAdjustmentInner.value,
                    serviceAdjustmentAmount: serviceAdjustmentAmountInner,
                    serviceAdjustmentLabel: serviceAdjustmentLabelInner,
                    energyCostBase,
                    pricingPotencia: potencia,
                    comision: comision,
                    comisionAmount: comision,
                    ...calc
                });
            }
        }
    }

    if (sortMode === 'commission') {
        results.sort((a, b) => {
            const diffComision = b.comisionAmount - a.comisionAmount;
            if (Math.abs(diffComision) > 0.01) return diffComision;
            return b.savings - a.savings;
        });
    } else {
        results.sort((a, b) => b.savings - a.savings);
    }

    return results;
}

function calculateComparisonGas(formData, porcentajes, sortMode = 'savings') {
    const results = [];
    const root = TARIFFS_GAS_DATA && (TARIFFS_GAS_DATA.GAS || TARIFFS_GAS_DATA.gas);
    if (!root || typeof root !== 'object') return results;

    const regionKey = normalizeRegion(formData.region);

    const normalizeGasBand = (value) => {
        const raw = String(value ?? '').trim().toUpperCase();
        if (!raw) return null;
        const compact = raw.replace(/\s+/g, '');
        const m = compact.match(/^RL0*([1-5])$/) || compact.match(/^RLO*([1-5])$/);
        if (m) return `RL${m[1]}`;
        const m2 = raw.match(/R\s*L\s*0*([1-5])/i);
        if (m2) return `RL${m2[1]}`;
        const m3 = raw.match(/^0*([1-5])$/);
        if (m3) return `RL${m3[1]}`;
        return null;
    };

    const normalizeGasProductName = (name, bandToken) => {
        const base = String(name || '').trim();
        const band = normalizeGasBand(bandToken) || 'RL2';
        if (!base) return band;
        const replaced = base.replace(/R\s*L\s*0*([1-5])/ig, (_, d) => `RL${d}`);
        const finalName = replaced.replace(/\s+/g, ' ').trim();
        if (/RL[1-5]\b/i.test(finalName)) return finalName;
        return `${finalName} ${band}`.trim();
    };
    const stripGasBandSuffix = (name) => {
        const raw = String(name || '').trim();
        if (!raw) return raw;
        const compact = raw.replace(/\s+/g, ' ');
        return compact.replace(/\s+R\s*L\s*0*([1-5])\s*$/i, '').trim();
    };

    const band = normalizeGasBand(formData.gasTariffBand) || 'RL2';
    const consumoAnual = parseFloat(formData.cae) || 0;
    const billingDays = parseInt(formData.billingDays) || 30;
    const periodConsumption = parseFloat(formData.gasMonthlyConsumption || 0) || 0;
    const consumoAnualFallback = periodConsumption * (365 / Math.max(1, billingDays));
    const consumoAnualEffective = consumoAnual > 0 ? consumoAnual : consumoAnualFallback;

    for (const supplier of Object.keys(root)) {
        const supplierKey = supplier.toString().trim().toUpperCase();
        const alias = SUPPLIER_ALIASES[supplierKey];
        const hasSupplier = porcentajes && Object.prototype.hasOwnProperty.call(porcentajes, supplierKey);
        const hasAlias = porcentajes && alias && Object.prototype.hasOwnProperty.call(porcentajes, alias);
        const porcentaje = porcentajes ? (hasSupplier ? porcentajes[supplierKey] : (hasAlias ? porcentajes[alias] : 0)) : 0;
        if (porcentaje === 0) continue;

        const supplierData = root[supplier] || {};
        if (supplierData.activo === false) continue;
        const productos = Array.isArray(supplierData.productos) ? supplierData.productos : [];
        for (const prod of productos) {
            if (!prod) continue;
            if (prod.activo === false) continue;
            const prodBand = normalizeGasBand(prod.band) || '';
            if (prodBand && prodBand !== band) continue;
            const baseName = prod.nombre || prod.name || 'Producto gas';
            const productNameWithBand = normalizeGasProductName(baseName, prodBand || band);
            const productName = stripGasBandSuffix(productNameWithBand);
            if (!isOfferAllowedForClientType(formData.clientType, supplier, productName, prod, supplierData)) continue;
            const commissionProductName = hasCommissionProduct(supplier, productNameWithBand, 'GAS')
                ? productNameWithBand
                : productName;
            const calc = calculateGasBill(formData, prod);
            const comision = getComisionPersonalizada(
                porcentajes,
                supplier,
                commissionProductName,
                consumoAnualEffective,
                0,
                'GAS'
            );
            results.push({
                supplier,
                productName,
                gasBand: prodBand || band,
                fixedDaily: Number(prod.terminoFijoDiario) || 0,
                variableKwh: Number(prod.terminoVariableKwh) || 0,
                pricingConsumo: { variable: Number(prod.terminoVariableKwh) || 0 },
                pricingPotencia: { fijo: Number(prod.terminoFijoDiario) || 0 },
                comision,
                comisionAmount: comision,
                ...calc
            });
        }
    }

    if (sortMode === 'commission') {
        results.sort((a, b) => {
            const diffComision = b.comisionAmount - a.comisionAmount;
            if (Math.abs(diffComision) > 0.01) return diffComision;
            return b.savings - a.savings;
        });
    } else {
        results.sort((a, b) => b.savings - a.savings);
    }
    return results;
}

function calculateForRequest(body) {
    ensureDataLoaded();
    const { codigoComercial, sortMode = 'savings', ...formData } = body || {};
    if (!codigoComercial) {
        const error = new Error('Código comercial requerido');
        error.status = 401;
        throw error;
    }

    const validation = validateCommercialCode(codigoComercial);
    const matchKey = validation?.code || null;
    const porcentajes = matchKey ? COMERCIALES_DATA[matchKey] : null;
    if (!porcentajes) {
        const error = new Error('Código comercial no autorizado');
        error.status = 401;
        throw error;
    }

    const consumoAnual = parseFloat(formData.cae);
    if (!Number.isFinite(consumoAnual) || consumoAnual <= 0) {
        const error = new Error('Debes introducir el Consumo Anual (kWh) para calcular (las comisiones dependen de este dato).');
        error.status = 400;
        throw error;
    }

    const effectiveSortMode = sortMode;
    const energyType = (formData.energyType || '').toString().toLowerCase();
    const isGas = energyType === 'gas';
    const tariffType = (formData.tariffType || '').toString().trim().toUpperCase();
    if (!isGas) {
        const consumptionPeriods = tariffType === '2.0TD'
            ? ['P1', 'P2', 'P3']
            : ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
        const totalPeriodConsumption = consumptionPeriods.reduce((sum, p) => {
            const value = parseFloat(formData[`consumption${p}`]);
            return sum + (Number.isFinite(value) ? value : 0);
        }, 0);
        if (totalPeriodConsumption <= 0) {
            const error = new Error('Debes introducir el consumo del periodo por P1/P2/P3. El Cons. Anual solo se usa para límites y comisiones, no para calcular la factura mensual.');
            error.status = 400;
            throw error;
        }
        if (tariffType === '2.0TD') {
            const potenciaP1 = parseFloat(formData.potenciaP1);
            const potenciaP2 = parseFloat(formData.potenciaP2);
            const maxPot = Math.max(Number.isFinite(potenciaP1) ? potenciaP1 : 0, Number.isFinite(potenciaP2) ? potenciaP2 : 0);
            if (maxPot > 15) {
                const error = new Error('Para tarifa 2.0TD la potencia debe ser ≤ 15 kW. Si tienes > 15 kW, usa 3.0TD.');
                error.status = 400;
                throw error;
            }
        }
        if (tariffType === '3.0TD') {
            const potenciaP6 = parseFloat(formData.potenciaP6);
            if (!Number.isFinite(potenciaP6) || potenciaP6 <= 15) {
                const error = new Error('Para tarifa 3.0TD debe haber al menos P6 > 15 kW.');
                error.status = 400;
                throw error;
            }
        }
    }
    const results = isGas ? calculateComparisonGas(formData, porcentajes, effectiveSortMode) : calculateComparison(formData, porcentajes, effectiveSortMode);

    return { results };
}

module.exports = { calculateForRequest };

function validateCommercialCode(code) {
    // Validación no debe depender de tarifas/comisiones: en serverless evita fallos por bundles incompletos.
    ensureCommercialsLoaded();
    if (!code) return null;
    const normalizedCode = code.toString().trim();
    if (!normalizedCode) return null;
    const isSecretaryCode = /-\d+$/.test(normalizedCode);
    const baseCode = isSecretaryCode ? normalizedCode.replace(/-\d+$/, '') : normalizedCode;

    const keys = Object.keys(COMERCIALES_DATA || {});
    const findKeyInsensitive = (value) => keys.find(k => k.toLowerCase() === value.toLowerCase()) || null;

    let matchKey = isSecretaryCode ? (findKeyInsensitive(baseCode) || findKeyInsensitive(normalizedCode)) : findKeyInsensitive(normalizedCode);
    if (!matchKey) {
        // Si comerciales.json se editó en caliente, reintentar con recarga para evitar caché obsoleta.
        COMERCIALES_DATA = loadJSONOnce('comerciales.json');
        const refreshedKeys = Object.keys(COMERCIALES_DATA || {});
        const findRefreshed = (value) => refreshedKeys.find(k => k.toLowerCase() === value.toLowerCase()) || null;
        matchKey = isSecretaryCode ? (findRefreshed(baseCode) || findRefreshed(normalizedCode)) : findRefreshed(normalizedCode);
    }
    if (!matchKey) return null;
    return { code: matchKey, secretary: isSecretaryCode };
}

module.exports.validateCommercialCode = validateCommercialCode;
