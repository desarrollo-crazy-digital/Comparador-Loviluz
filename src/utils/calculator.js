
export function calculateProposal(formData, tarifas, comisionesData, comercialesData, agentId) {
    if (!tarifas || !formData) return [];

    const parseNumber = (value, fallback = 0) => {
        if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
        const raw = (value ?? '').toString().trim();
        if (!raw) return fallback;
        // Soporta formatos ES: "1.234,56", "123,45", "32.000", y símbolos de moneda
        let cleaned = raw.replace(/[^\d,.\-\s]/g, '').replace(/\s+/g, '');
        const hasComma = cleaned.includes(',');
        const hasDot = cleaned.includes('.');

        if (hasComma && hasDot) {
            // "1.234,56" -> "1234.56"
            cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        } else if (hasComma && !hasDot) {
            // "123,45" -> "123.45"
            cleaned = cleaned.replace(',', '.');
        } else if (!hasComma && hasDot) {
            // Could be decimal ("0.147") or thousands ("32.000")
            const thousandLike = /^\-?\d{1,3}(\.\d{3})+$/.test(cleaned);
            if (thousandLike) {
                const intPart = cleaned.replace(/^\-/, '').split('.')[0] || '';
                // Heurística: si la parte entera NO es 0, suele ser separador de miles (4.800 -> 4800, 32.000 -> 32000).
                // Caso típico de precios: 0.147 debe mantenerse como decimal.
                if (intPart !== '0') cleaned = cleaned.replace(/\./g, '');
            }
        }

        const num = Number.parseFloat(cleaned);
        return Number.isFinite(num) ? num : fallback;
    };

    const normalizeText = (value) => {
        return (value ?? '')
            .toString()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    };

    const findKeyInsensitive = (obj, key) => {
        const keys = Object.keys(obj || {});
        const target = (key || '').toString().trim().toLowerCase();
        return keys.find(k => (k || '').toString().trim().toLowerCase() === target) || null;
    };

    const productVariantCode = (value) => {
        const match = normalizeText(value).match(/^(?:[236]\s+)?([vls])\s*(\d+)\b/);
        return match ? `${match[1]}${match[2]}` : null;
    };

    const isEnergyGreenProduct = (value) => normalizeText(value).includes('energia verde');

    const loviluzCommissionVariants = (productName) => {
        const productNorm = normalizeText(productName);
        const variants = new Set([productNorm]);
        if (productNorm.includes('sin ssaa')) {
            variants.add(productNorm.replace(/sin ssaa/g, 'con ssaa'));
        }
        if (productNorm.includes('con ssaa')) {
            variants.add(productNorm.replace(/con ssaa/g, 'sin ssaa'));
        }
        return [...variants];
    };

    const normalizeLoviluzProductRoot = (productName) => {
        return normalizeText(productName)
            .replace(/^tarifa\s+/g, '')
            .replace(/\b(ssaa\s+fuera|ssaa\s+no\s+incluidos|sin\s+ssaa|con\s+ssaa|unica|periodos|incluidos|no\s+incluidos)\b/g, ' ')
            .replace(/\b(periodic|index)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };

    const productVariantCode = (value) => {
        const match = normalizeText(value).match(/^(?:[236]\s+)?([vls])\s*(\d+)\b/);
        return match ? `${match[1]}${match[2]}` : null;
    };

    const findProductCommission = (products, productName, supplier) => {
        if (!products || typeof products !== 'object') return null;
        if (Object.prototype.hasOwnProperty.call(products, productName)) return products[productName];

        const productNorm = normalizeText(productName);
        const candidates = Object.keys(products)
            .map((key) => ({ key, norm: normalizeText(key) }))
            .filter((item) => item.norm);

        const exact = candidates.find((item) => item.norm === productNorm);
        if (exact) return products[exact.key];

        const variantCode = productVariantCode(productName);
        if (variantCode) {
            const byVariant = candidates.filter((item) => productVariantCode(item.key) === variantCode);
            const selected = byVariant.sort((a, b) => a.norm.length - b.norm.length)[0];
            if (selected) return products[selected.key];
        }

        const supplierUpper = (supplier || '').toString().trim().toUpperCase();
        if (supplierUpper === 'LOVILUZ') {
            const productRoot = normalizeLoviluzProductRoot(productName);
            const rootMatch = candidates.find((item) => normalizeLoviluzProductRoot(item.key) === productRoot);
            if (rootMatch) return products[rootMatch.key];
            for (const variant of loviluzCommissionVariants(productName)) {
                const lovMatch = candidates.find((item) => item.norm === variant);
                if (lovMatch) return products[lovMatch.key];
            }
        }

        if (supplierUpper === 'CANALUZ' || supplierUpper === 'LOCALUZ') {
            if (variantCode) {
                const byVariant = candidates.filter((item) => productVariantCode(item.key) === variantCode);
                const sameGreenFlag = byVariant.filter((item) => isEnergyGreenProduct(item.key) === isEnergyGreenProduct(productName));
                const selected = (sameGreenFlag.length ? sameGreenFlag : byVariant)
                    .sort((a, b) => a.norm.length - b.norm.length)[0];
                if (selected) return products[selected.key];
            }
        }

        const contains = candidates
            .filter((item) => productNorm.includes(item.norm) || item.norm.includes(productNorm))
            .sort((a, b) => b.norm.length - a.norm.length)[0];
        return contains ? products[contains.key] : null;
    };

    const supplierKeyVariants = (supplier) => {
        const raw = (supplier || '').toString().trim();
        const up = raw.toUpperCase();
        const variants = new Set();
        if (raw) variants.add(raw);
        if (up) variants.add(up);
        if (up === 'GREENING') variants.add('GREENING ENERGY');
        if (up === 'GREENING ENERGY') variants.add('GREENING');
        if (up === 'TOTAL') variants.add('TOTAL ENERGIES');
        if (up === 'TOTAL ENERGIES') variants.add('TOTAL');
        if (up === 'CANALUZ') variants.add('LOCALUZ');
        if (up === 'LOCALUZ') variants.add('CANALUZ');
        return [...variants];
    };

    const normalizeClientSegment = (clientType) => {
        const raw = (clientType || '').toString().trim().toLowerCase();
        const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (!normalized || ['todos', 'todas', 'all', 'global', 'general', 'sin filtro', 'sin-filtro'].includes(normalized)) return 'todos';
        if (normalized === 'hogar' || normalized === 'home' || normalized === 'residencial' || normalized === 'residential') return 'residencial';
        if (normalized === 'autonomo' || normalized === 'autonomous' || normalized === 'freelance') return 'autonomo';
        if (normalized === 'pyme' || normalized === 'pymes' || normalized === 'empresa' || normalized === 'empresas' || normalized === 'business') return 'pyme';
        return normalized;
    };

    const normalizeOfferSegment = (value) => {
        const raw = (value || '').toString().trim().toLowerCase();
        const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (!normalized) return null;
        if (['general', 'todos', 'todas', 'all', 'mixto', 'mix'].includes(normalized)) return 'general';
        if (['hogar', 'residencial', 'residential', 'domestico', 'domestica'].includes(normalized)) return 'residencial';
        if (['autonomo', 'freelance'].includes(normalized)) return 'autonomo';
        if (['pyme', 'pymes', 'empresa', 'empresas', 'business', 'negocio', 'negocios'].includes(normalized)) return 'pyme';
        return null;
    };

    const collectExplicitSegments = (...configs) => {
        const fieldNames = ['segmento', 'segmentos', 'segment', 'segments', 'clientSegment', 'clientSegments', 'tipoCliente', 'tiposCliente'];
        const segments = new Set();
        for (const cfg of configs) {
            if (!cfg || typeof cfg !== 'object') continue;
            for (const field of fieldNames) {
                const raw = cfg[field];
                const values = Array.isArray(raw)
                    ? raw
                    : (typeof raw === 'string' ? raw.split(/[,|/]+/) : [raw]);
                for (const value of values) {
                    const segment = normalizeOfferSegment(value);
                    if (segment) segments.add(segment);
                }
            }
        }
        return segments;
    };

    const inferOfferSegments = (supplier, productName = '') => {
        const supplierKey = (supplier || '').toString().trim().toUpperCase();
        const productKey = (productName || '').toString().trim().toUpperCase();

        if (productKey.includes('HOGAR')) return new Set(['residencial']);
        if (supplierKey === 'TOTAL RESIDENCIAL') return new Set(['residencial']);
        if (supplierKey === 'TOTAL ENERGIES' || supplierKey === 'TOTAL') return new Set(['pyme']);

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
    };

    const isSegmentAllowed = (clientSegment, offerSegments) => {
        const target = normalizeClientSegment(clientSegment);
        if (target === 'todos') return true;
        if (!offerSegments || offerSegments.size === 0 || offerSegments.has('general')) return true;
        return offerSegments.has(target);
    };

    const isOfferAllowedForClientType = (clientType, supplier, productName = '', productConfig = null) => {
        const explicitSegments = collectExplicitSegments(productConfig);
        const offerSegments = explicitSegments.size ? explicitSegments : inferOfferSegments(supplier, productName);
        return isSegmentAllowed(clientType, offerSegments);
    };

    const getFacilConsumptionLimitKwh = (tariffTypeValue, productName) => {
        const name = (productName || '').toString().toUpperCase();
        if (!name.includes('FACIL')) return null;
        if (name.includes('FACIL ON')) return 5000;
        const tariff = (tariffTypeValue || '').toString().trim().toUpperCase();
        if (tariff === '2.0TD') return 30000;
        if (tariff === '3.0TD') return 50000;
        return null;
    };

    const IVA_PENINSULA = 0.21;
    const IVA_PENINSULA_HOGAR = 0.10;   // 10% IVA reducido residencial
    const IVA_BALEARES = 0.21;
    const IVA_BALEARES_HOGAR = 0.10;    // 10% IVA reducido residencial
    const IVA_CANARIAS = 0.00;
    const IVA_CEUTA = 0.01;
    const IVA_MELILLA = 0.01;
    const ELEC_TAX_STD = 0.051126963;   // 5,1126963%
    const ELEC_TAX_HOGAR_LOW = 0.005;   // 0,5% para hogar con potencia ≤ 10kW

    const isHogar = normalizeClientSegment(formData.clientType) === 'residencial';

    let currentVAT = isHogar ? IVA_PENINSULA_HOGAR : IVA_PENINSULA;
    if(formData.region === 'CANARIAS') currentVAT = IVA_CANARIAS;
    if(formData.region === 'CEUTA') currentVAT = IVA_CEUTA;
    if(formData.region === 'MELILLA') currentVAT = IVA_MELILLA;
    if(formData.region === 'BALEARES') currentVAT = isHogar ? IVA_BALEARES_HOGAR : IVA_BALEARES;

    // Si los datos vienen de un PDF, los impuestos extraídos de la factura tienen prioridad.
    // Para entrada manual (sin PDF) pdfVatRate/pdfElectricityTaxRate serán 0/null → se usan los hardcodeados.
    const _pdfVat = parseNumber(formData.pdfVatRate, 0);
    const _pdfElec = parseNumber(formData.pdfElectricityTaxRate, 0);
    if (_pdfVat > 0) currentVAT = _pdfVat;

    const tariffType = (formData.tariffType || "2.0TD").toString().trim();
    const isGas = formData.energyType === 'gas';

    // Parse inputs
    const consumption = isGas 
        ? { p1: parseNumber(formData.gasMonthlyConsumption, 0) }
        : {
            p1: parseNumber(formData.consumptionP1, 0),
            p2: parseNumber(formData.consumptionP2, 0),
            p3: parseNumber(formData.consumptionP3, 0),
            p4: parseNumber(formData.consumptionP4, 0),
            p5: parseNumber(formData.consumptionP5, 0),
            p6: parseNumber(formData.consumptionP6, 0)
        };

    const power = isGas
        ? {} 
        : {
            p1: parseNumber(formData.potenciaP1, 0),
            p2: parseNumber(formData.potenciaP2, 0),
            p3: parseNumber(formData.potenciaP3, 0),
            p4: parseNumber(formData.potenciaP4, 0),
            p5: parseNumber(formData.potenciaP5, 0),
            p6: parseNumber(formData.potenciaP6, 0)
        };
    const maxInputPower = isGas ? 0 : Math.max(...Object.values(power).map(v => parseNumber(v, 0)), 0);

    const diasFactura = Math.max(1, Math.round(parseNumber(formData.billingDays, 30)));
    const currentBill = parseNumber(formData.currentBill, 0);
    const alqEquipos = parseNumber(formData.equipmentRental, 0);
    const otrosCostes = parseNumber(formData.otherCosts, 0);
    const bonoSocial = parseNumber(formData.socialBonus, 0);
    const excesos = parseNumber(formData.excessPower, 0);
    const reactiva = parseNumber(formData.reactiveEnergy, 0);
    const excedentes = parseNumber(formData.surpluses, 0);

    let annualConsumption = parseNumber(formData.cae, 0);
    if (!(annualConsumption > 0)) {
        if (isGas) {
            const periodConsumption = consumption.p1 || 0;
            annualConsumption = periodConsumption * (365 / diasFactura);
        } else {
            const periodConsumption =
                (consumption.p1 || 0) +
                (consumption.p2 || 0) +
                (consumption.p3 || 0) +
                (consumption.p4 || 0) +
                (consumption.p5 || 0) +
                (consumption.p6 || 0);
            annualConsumption = periodConsumption * (365 / diasFactura);
        }
    }

    // Find agent multiplier
    // Data structure: "AgentID": { "SUPPLIER": multiplier, ... }
    const agentIdNorm = (agentId || '').toString().trim();
    const agentKey = (comercialesData && agentIdNorm) ? findKeyInsensitive(comercialesData, agentIdNorm) : null;
    const agentMultipliers = (comercialesData && agentKey) ? comercialesData[agentKey] : null;

    // Filter relevant tariffs
    const relevantTariffs = tarifas.filter(t => {
        const match = t.tipo === (isGas ? 'GAS' : 'LUZ') && 
                      t.tarifa === (isGas ? formData.gasTariffBand : tariffType) &&
                      t.activo;
        return match;
    });

    // Regional supplier filtering (block certain suppliers per region)
    const REGIONAL_BLOCKS = {
        CANARIAS: ['GREENING ENERGY', 'GREENING', 'IGNIS', 'CANALUZ', 'LOCALUZ', 'TOTAL ENERGIES', 'TOTAL'],
        BALEARES: ['GREENING ENERGY', 'GREENING', 'IGNIS', 'CANALUZ', 'LOCALUZ', 'TOTAL ENERGIES', 'TOTAL'],
        CEUTA: ['GREENING ENERGY', 'GREENING', 'IGNIS', 'POLARIS', 'LOGOS', 'TOTAL ENERGIES', 'TOTAL'],
        MELILLA: ['GREENING ENERGY', 'GREENING', 'IGNIS', 'POLARIS', 'LOGOS', 'TOTAL ENERGIES', 'TOTAL']
    };

    const currentRegion = (formData.region || 'PENINSULA').toUpperCase();
    const blockedSuppliers = REGIONAL_BLOCKS[currentRegion] || [];
    
    const regionFilteredTariffs = relevantTariffs.filter(t => {
        if (blockedSuppliers.includes((t.supplier || '').toUpperCase())) return false;
        const minPower = (t?.potenciaMin !== undefined && t?.potenciaMin !== null) ? parseNumber(t.potenciaMin, NaN) : NaN;
        const maxPower = (t?.potenciaMax !== undefined && t?.potenciaMax !== null) ? parseNumber(t.potenciaMax, NaN) : NaN;
        if (Number.isFinite(minPower) && maxInputPower < minPower) return false;
        if (Number.isFinite(maxPower) && maxInputPower > maxPower) return false;
        return true;
    });

    // Mirror backend energy adjustment rules so frontend and API rank offers consistently.
    const ENERGY_ADJUSTMENTS = {
        'TOTAL ENERGIES': { prefixes: { 'SOUL': { mode: 'factor', value: 0.085 } } },
        'IGNIS': { prefixes: { 'TERRA AIR': { mode: 'factor', value: 0.085 } } },
        'LOGOS': { contains: { 'LITE': { mode: 'factor', value: 0.085 } } },
        'ACCIONA': { default: { mode: 'factor', value: 0.085 } },
        // CANALUZ: The per-kWh energy add is only applied for non-SSAA products.
        // Products with 'SIN SSAA' in their name receive a separate SSAA charge calculated
        // via the formula: ((totalKwh / 1000) * CANALUZ_SSAA_PRICE_PER_MWH).
        // Products with 'CON SSAA' or no SSAA mention have no extra charge.
        'CANALUZ': {
            default: { mode: 'add', value: 0.025 }
        },
        'LOVILUZ': {
            products: {
                'LOV VERANO V UNICA SSAA NO INCLUIDOS': { mode: 'add', value: 0.0149 },
                'LOV ME V UNICA SSAA NO INCLUIDOS': { mode: 'add', value: 0.0149 },
                'LOV ON V UNICA SSAA NO INCLUIDOS': { mode: 'add', value: 0.0149 },
                'LOV PLUS V UNICA SSAA NO INCLUIDOS': { mode: 'add', value: 0.0149 },
                'LOV US V SOLAR UNICA SSAA NO INCLUIDOS': { mode: 'add', value: 0.0049 },
                'LOV VERANO V PERIODOS SSAA NO INCLUIDOS': { mode: 'add', value: 0.02 },
                'LOV ME V PERIODOS SSAA NO INCLUIDOS': { mode: 'add', value: 0.02 },
                'LOV ON V PERIODOS SSAA NO INCLUIDOS': { mode: 'add', value: 0.02 },
                'LOV PLUS V PERIODOS SSAA NO INCLUIDOS': { mode: 'add', value: 0.02 }
            },
            default: { mode: 'add', value: 0 }
        }
    };

    // Precio mensual de los Servicios de Ajuste (SSAA) de Canaluz en €/MWh.
    // Se utiliza exclusivamente cuando el nombre del producto contiene 'SIN SSAA'.
    const CANALUZ_SSAA_PRICE_PER_MWH = 23.1; // €/MWh — valor por defecto especificado en requisitos

    const calculatedOffers = regionFilteredTariffs.map(offer => {
        let energyCost = 0;
        let powerCost = 0;
        let pricingConsumo = {};
        let pricingPotencia = {};
        const precios = offer?.precios || {};
        const productName = (offer.productName || offer.nombre || '').toString().trim();
        if (!isOfferAllowedForClientType(formData.clientType, offer.supplier, productName, offer)) return null;
        const facilLimit = getFacilConsumptionLimitKwh(tariffType, productName);
        if (facilLimit && annualConsumption > facilLimit) return null;

        // Check if this offer needs energy adjustment
        let energyAdjustment = { mode: 'add', value: 0 };
        const supplierUpper = (offer.supplier || '').toUpperCase();
        const productNameUpper = productName.toUpperCase();
        
        if (ENERGY_ADJUSTMENTS[supplierUpper]) {
            const adjustmentConfig = ENERGY_ADJUSTMENTS[supplierUpper];
            const products = adjustmentConfig.products || {};
            if (products[productNameUpper]) {
                energyAdjustment = products[productNameUpper];
            }
            const prefixes = adjustmentConfig.prefixes || {};
            if (!Number(energyAdjustment?.value || 0)) {
                for (const [prefix, adjustment] of Object.entries(prefixes)) {
                    if (productNameUpper.startsWith(prefix.toUpperCase())) {
                        energyAdjustment = adjustment;
                        break;
                    }
                }
            }
            const contains = adjustmentConfig.contains || {};
            if (!Number(energyAdjustment?.value || 0)) {
                for (const [fragment, adjustment] of Object.entries(contains)) {
                    if (productNameUpper.includes(fragment.toUpperCase())) {
                        energyAdjustment = adjustment;
                        break;
                    }
                }
            }
            if ((!energyAdjustment || !Number(energyAdjustment.value || 0)) && adjustmentConfig.default) {
                energyAdjustment = adjustmentConfig.default;
            }
        }

        // Determines whether this offer's adjustment must be shown as a separate
        // "Ajustes de Servicios" line instead of being baked into the per-kWh price.
        // Applies to: SOUL (Total Energies), TERRA AIR (IGNIS), and CANALUZ offers that
        // are NOT SIN SSAA (CON SSAA products include SSAA in price, no extra line).
        const SEPARATE_SERVICE_ADJUSTMENT_SUPPLIERS = new Set([
            'TOTAL ENERGIES', 'IGNIS', 'LOVILUZ'
        ]);

        // For CANALUZ: the energy per-kWh adjustment is only applied when the product
        // does NOT indicate 'SIN SSAA'. When it is SIN SSAA, the SSAA cost is computed
        // separately below using the MWh formula; the per-kWh add must be suppressed.
        const isCanaluzSinSSAA = supplierUpper === 'CANALUZ' && /(?:sin|s\/)\s*ssaa/i.test(productName);
        const isCanaluzConSSAA = supplierUpper === 'CANALUZ' && !isCanaluzSinSSAA;

        // If this is a Canaluz SIN SSAA product, zero-out the energy adjustment so it
        // isn't baked into the per-kWh price — the SSAA line will be added explicitly.
        if (isCanaluzSinSSAA) {
            energyAdjustment = { mode: 'add', value: 0 };
        }

        const separateServiceAdjustment = SEPARATE_SERVICE_ADJUSTMENT_SUPPLIERS.has(supplierUpper) ||
            (supplierUpper === 'CANALUZ' && isCanaluzSinSSAA);

        let serviceAdjustmentCost = 0; // Accumulated adjustment shown as separate line

        // Keeps the base price intact. If the supplier needs a separate service line,
        // we accumulate the adjustment into serviceAdjustmentCost without mutating the
        // per-kWh price shown to the user.
        const applyAdjustedPrice = (basePrice, kwh = 0) => {
            const numericBase = Number(basePrice);
            const mode = (energyAdjustment?.mode || 'add').toString().toLowerCase();
            const value = Number(energyAdjustment?.value) || 0;
            if (!value) return numericBase;
            if (separateServiceAdjustment) {
                const adjustmentPerKwh = mode === 'factor' ? numericBase * value : value;
                serviceAdjustmentCost += adjustmentPerKwh * kwh;
                return numericBase; // Display price shown to user
            }
            return mode === 'factor' ? numericBase * (1 + value) : numericBase + value;
        };

        if (isGas) {
            // GAS Calculation
            const priceVar = parseNumber(precios.variable ?? offer.terminoVariableKwh, 0);
            const priceFix = parseNumber(precios.fijo ?? offer.terminoFijoDiario, 0); // Daily fixed

            energyCost = consumption.p1 * priceVar;
            powerCost = priceFix * diasFactura;

        } else {
            // ELECTRICITY Calculation
            // Energy - Only use periods that exist in the tariff
            const energia = precios.energia || offer.periodosConsumo || offer.consumo;
            if (energia && typeof energia === 'object') {
                // Iterate only over the periods defined in the tariff
                Object.keys(energia).forEach(periodKey => {
                    const basePrice = Number(energia[periodKey]);
                    if (basePrice && basePrice > 0) {
                        const consumptionKey = periodKey.toLowerCase();
                        const kwh = consumption[consumptionKey] || 0;
                        const displayPrice = applyAdjustedPrice(basePrice, kwh);

                        energyCost += kwh * displayPrice;
                        pricingConsumo[periodKey] = displayPrice;
                    }
                });
            } else if (precios.uniqueEnergy) {
                // Flat rate
                const totalKwh = Object.values(consumption).reduce((a,b)=>a+b, 0);
                const basePrice = parseNumber(precios.uniqueEnergy, 0);
                const displayPrice = applyAdjustedPrice(basePrice, totalKwh);
                energyCost = totalKwh * displayPrice;
                pricingConsumo['Flat'] = displayPrice;
            }

            // Power - Only use periods that exist in the tariff
            const potencia = precios.potencia || offer.periodosPotencia || offer.potencia;
            if (potencia && typeof potencia === 'object') {
                Object.keys(potencia).forEach(periodKey => {
                    const priceDaily = potencia[periodKey];
                    // Skip null or undefined prices
                    if (priceDaily !== null && priceDaily !== undefined && priceDaily > 0) {
                        const powerKey = periodKey.toLowerCase();
                        const kw = power[powerKey] || 0;
                        
                        // Price is already daily (€/kW/día), just multiply by kW and days
                        powerCost += kw * Number(priceDaily) * diasFactura;
                        pricingPotencia[periodKey] = Number(priceDaily);
                    }
                });
            }
        }

        // ── Canaluz SSAA charge ────────────────────────────────────────────────────────
        // Rule: Apply ONLY when the product name contains 'SIN SSAA' (case-insensitive).
        // Formula: ((sum of all consumption kWh P1-P6) / 1000) * CANALUZ_SSAA_PRICE_PER_MWH
        // For products with 'CON SSAA' or no SSAA mention, this cost is forced to 0.00 €.
        if (isCanaluzSinSSAA && !isGas) {
            const totalKwh = (consumption.p1 || 0) + (consumption.p2 || 0) + (consumption.p3 || 0) +
                             (consumption.p4 || 0) + (consumption.p5 || 0) + (consumption.p6 || 0);
            serviceAdjustmentCost = (totalKwh / 1000) * CANALUZ_SSAA_PRICE_PER_MWH;
        } else if (isCanaluzConSSAA) {
            // CON SSAA: SSAA already embedded in the tariff price — no extra charge.
            serviceAdjustmentCost = 0;
        }
        // ─────────────────────────────────────────────────────────────────────────────

        // Subtotal — serviceAdjustmentCost is included in the taxable base but shown separately
        const subtotal = (energyCost + serviceAdjustmentCost + powerCost + alqEquipos + otrosCostes + bonoSocial + excesos + reactiva) - excedentes;

        // Tax
        const stdElecTaxRate = (isHogar && maxInputPower <= 10) ? ELEC_TAX_HOGAR_LOW : ELEC_TAX_STD;
        const baseElecTaxRate = isGas ? 0 : stdElecTaxRate;
        // Si hay impuesto eléctrico extraído del PDF, tiene prioridad sobre el hardcodeado.
        const electricityTaxRate = (_pdfElec > 0 && !isGas) ? _pdfElec : baseElecTaxRate;
        const electricityTax = isGas ? 0.00234 * consumption.p1 : (energyCost + serviceAdjustmentCost + powerCost) * electricityTaxRate;

        // Total
        const taxableBase = subtotal + electricityTax;
        const vatAmount = taxableBase * currentVAT;
        const total = taxableBase + vatAmount;

        const savings = currentBill - total;
        const annualSavings = (savings / diasFactura) * 365;

        // --- Commission Logic ---
        let commission = 0;
        
        // 1. Identify Supplier & Product in comisiones.json
        // Structure: comisiones[Supplier].tarifas[TariffType][ProductName] -> { ... bloques: [...] }
        const supplierKeyMatch = comisionesData
            ? supplierKeyVariants(offer.supplier).map(v => findKeyInsensitive(comisionesData, v)).find(Boolean)
            : null;
        const supplierData = (comisionesData && supplierKeyMatch) ? comisionesData[supplierKeyMatch] : null;
        let productComms = null;

        if (supplierData && supplierData.tarifas && supplierData.tarifas[tariffType]) {
            const specificProducts = supplierData.tarifas[tariffType];
            productComms = findProductCommission(specificProducts, productName, supplierKeyMatch || offer.supplier);
        }
        if (!productComms && supplierData && supplierData.productos) {
            // Fallback for suppliers that define products without tariff nesting (e.g. ENDESA)
            const specificProducts = supplierData.productos;
            productComms = findProductCommission(specificProducts, productName, supplierKeyMatch || offer.supplier);
        }

        // 2. Calculate Base Commission
        if (productComms) {
            const limit = Number(productComms.limite_consumo)
            // Fixed commission
            if (productComms.tipo === 'fija' && Number.isFinite(Number(productComms.comision))) {
                commission = Number(productComms.comision);
            } else if (productComms.tipo === 'ajuste') {
                // Comisión = ajuste de servicio acumulado durante el cálculo, anualizado
                commission = serviceAdjustmentCost * (365 / diasFactura);
            } else if (productComms.tipo === 'formula' && productComms.criterio === 'consumo_formula') {
                const base = Number(productComms.base) || 0;
                const factor = Number(productComms.factor) || 0;
                if (Number.isFinite(limit) && limit > 0 && annualConsumption <= limit) {
                    commission = base;
                } else {
                    commission = base + factor * Math.floor(annualConsumption / 1000);
                }
            } else {
                if (Number.isFinite(limit) && limit > 0 && annualConsumption > limit) {
                    commission = 0
                } else if (productComms.bloques) {
                    // Check criteria (consumo vs potencia vs potencia_consumo)
                    const criteria = productComms.criterio || 'consumo'; // Default to consumption blocks

                    if (criteria === 'potencia_consumo') {
                        // Logic for IGNIS style: Max Power -> Consumption Block
                        const maxPower = Math.max(...Object.values(power).map(v => Number(v) || 0));
                        
                        // Outer block by Power
                        const powerBlock = productComms.bloques.find(b => {
                            const from = b.desde !== null ? b.desde : 0;
                            const to = b.hasta !== null ? b.hasta : Infinity;
                            return maxPower > from && maxPower <= to;
                        });

                        if (powerBlock && powerBlock.bloques_consumo) {
                            // Inner block by Consumption
                            const consumBlock = powerBlock.bloques_consumo.find(cb => {
                                const cFrom = cb.desde !== null ? cb.desde : 0;
                                const cTo = cb.hasta !== null ? cb.hasta : Infinity;
                                return annualConsumption > cFrom && annualConsumption <= cTo;
                            });
                            if (consumBlock) {
                                commission = consumBlock.comision;
                            } else {
                                const lastBlock = powerBlock.bloques_consumo[powerBlock.bloques_consumo.length - 1];
                                if (lastBlock) {
                                    const maxLimit = lastBlock.hasta !== null ? lastBlock.hasta : Infinity;
                                    if (annualConsumption > maxLimit) {
                                        commission = lastBlock.comision;
                                    }
                                }
                            }
                        }
                    } else if (criteria === 'potencia') {
                        // Blocks based on max power
                        const maxPower = Math.max(...Object.values(power).map(v => Number(v) || 0));
                        const block = productComms.bloques.find(b => {
                            const from = b.desde !== null ? b.desde : 0;
                            const to = b.hasta !== null ? b.hasta : Infinity;
                            return maxPower > from && maxPower <= to;
                        });
                        if (block) {
                            commission = block.comision;
                        } else {
                            const lastBlock = productComms.bloques[productComms.bloques.length - 1];
                            if (lastBlock) {
                                const maxLimit = lastBlock.hasta !== null ? lastBlock.hasta : Infinity;
                                if (maxPower > maxLimit) {
                                    commission = lastBlock.comision;
                                }
                            }
                        }
                    } else {
                        // Standard 'consumo' blocks
                        const block = productComms.bloques.find(b => {
                            const from = b.desde !== null ? b.desde : 0;
                            const to = b.hasta !== null ? b.hasta : Infinity;
                            return annualConsumption > from && annualConsumption <= to;
                        });
                        if (block) {
                            commission = block.comision;
                        } else {
                            const lastBlock = productComms.bloques[productComms.bloques.length - 1];
                            if (lastBlock) {
                                const maxLimit = lastBlock.hasta !== null ? lastBlock.hasta : Infinity;
                                if (annualConsumption > maxLimit) {
                                    commission = lastBlock.comision;
                                }
                            }
                        }
                    }
                } else if (Number.isFinite(Number(productComms.comision))) {
                    commission = Number(productComms.comision);
                }
            }
        }

        // 3. Apply Commercial Multiplier
        let multiplier = 0; // Default a 0 si el comercial no está autorizado para esa compañía
        // Based on commerciales.json, if not present might mean 0 commission.
        if (agentMultipliers) {
            // Check for explicit supplier key
            const agentSupplierMatch = supplierKeyVariants(offer.supplier)
                .map(v => findKeyInsensitive(agentMultipliers, v))
                .find(Boolean);
            if (agentSupplierMatch && agentMultipliers[agentSupplierMatch] !== undefined) {
                multiplier = agentMultipliers[agentSupplierMatch];
            } else {
                // Check for 'generic' or fallback keys if any?
                // Assuming explicit listing. If not in list, multiplier 0.
                multiplier = 0; 
            }
        }
        
        commission = parseNumber(commission, 0) * parseNumber(multiplier, 0);


        return {
            ...offer,
            productName,
            total,
            savings,
            annualSavings,
            monthlySavings: savings, // Monthly savings (same as savings since currentBill is monthly)
            savingsPercent: (savings > 0 && currentBill > 0) ? ((savings / currentBill) * 100).toFixed(1) : '0.0',
            details: {
                energyCost,
                serviceAdjustmentAmount: serviceAdjustmentCost || 0,
                serviceAdjustmentLabel: serviceAdjustmentCost > 0 ? 'Ajustes de servicio' : '',
                powerCost,
                equipmentRental: alqEquipos,
                otherCosts: otrosCostes,
                socialBonus: bonoSocial,
                excessPower: excesos,
                reactiveEnergy: reactiva,
                surpluses: excedentes,
                subtotal,
                electricityTax,
                vatAmount,
                vatRate: currentVAT
            },
            pricingConsumo,
            pricingPotencia,
            commission: parseNumber(commission, 0)
        };

    });

    // Filter out offers with no savings (must save money to show)
    const validOffers = calculatedOffers.filter(Boolean);
    const profitableOffers = currentBill > 0 ? validOffers.filter(offer => offer.savings > 0) : validOffers;

    // Sort by Savings (Descending)
    return profitableOffers.sort((a, b) => b.savings - a.savings);
}
