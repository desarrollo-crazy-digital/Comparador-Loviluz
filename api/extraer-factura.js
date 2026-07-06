/**
 * Vercel Serverless Function: /api/extraer-factura
 * Recibe { fileName, mimeType, base64 } y devuelve { extracted }
 *
 * Estrategia anti-saturación:
 *  1. Modelo principal: gemini-2.0-flash (2000 RPM paid tier, pool estable)
 *  2. Fallback 1: gemini-2.5-flash-lite (pool distinto, calidad similar)
 *  3. Fallback 2: gemini-2.5-flash (modelo más capaz, última opción)
 *
 * Si un modelo devuelve 503/429: un solo retry corto y salto al siguiente.
 * Reintentar al mismo modelo cuando Google reporta "high demand" no ayuda,
 * porque la saturación global no se desatasca en segundos.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODELS = String(
    process.env.GEMINI_FALLBACK_MODELS || 'gemini-2.5-flash-lite,gemini-2.5-flash'
)
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

// Timeout por llamada individual a Gemini.
// Respuestas reales medidas: 3-8s. 20s cubre el peor caso y deja margen para 3 modelos.
const CALL_TIMEOUT_MS = 20_000;

// Un único retry corto por modelo: si Google da 503, salta al siguiente modelo YA.
const MAX_OVERLOAD_RETRIES = 1;
const OVERLOAD_BACKOFF_MS = 500;

function sanitizeErrorMessage(err) {
    const status = err.status || 500;
    if (status === 429 || (err.incomplete && status === 422)) {
        return 'No se pudo leer la factura. Inténtalo de nuevo en unos segundos.';
    }
    if (status === 502 || status === 503) {
        return 'No se pudo procesar la factura. Inténtalo de nuevo.';
    }
    if (err.message === 'Archivo no recibido') return err.message;
    if (err.message === 'Configuración del servidor incompleta') return err.message;
    return 'No se pudo leer la factura. Asegúrate de subir un PDF válido e inténtalo de nuevo.';
}

function getModelCandidates() {
    const seen = new Set();
    const out = [];
    [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS].forEach((model) => {
        if (!model || seen.has(model)) return;
        seen.add(model);
        out.push(model);
    });
    return out;
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    const requestId = Math.random().toString(36).slice(2, 10);
    let fileName = 'factura.pdf';
    let mimeType = 'application/pdf';
    const t0 = Date.now();
    try {
        if (!GEMINI_API_KEY) throw new Error('Configuración del servidor incompleta');
        ({ fileName = 'factura.pdf', mimeType = 'application/pdf' } = req.body || {});
        const { base64 } = req.body || {};
        if (!base64) throw new Error('Archivo no recibido');

        const payload = buildGeminiPayload({ fileName, mimeType, base64 });
        const result = await callGemini(payload, requestId);
        const sanitized = {
            ...result,
            power: sanitizePowerPeriods(result?.power, String(result?.tariffType ?? '').trim().toUpperCase())
        };
        const completeness = evaluateExtractionCompleteness(sanitized);
        console.log(`[extraer-factura] req=${requestId} OK total_ms=${Date.now() - t0} complete=${completeness.complete}`);
        res.status(200).json({ extracted: sanitized, completeness });
    } catch (err) {
        const status = err.status || 500;
        console.error(`[extraer-factura] req=${requestId} FAIL total_ms=${Date.now() - t0} status=${status} msg="${err.message || 'Error interno'}" model=${err.model || 'N/A'} incomplete=${Boolean(err.incomplete)}`);
        res.status(status).json({ error: sanitizeErrorMessage(err) });
    }
};

function buildGeminiPayload({ fileName, mimeType, base64 }) {
    const prompt = [
        'Eres un extractor de datos de facturas de electricidad o gas en España.',
        'Lee todas las páginas de la factura. Devuelve SOLO un JSON con estos campos (usa 0 cuando no haya dato):',
        '{',
        ' "energyType": "electricidad|gas",',
        ' "tariffType": "2.0TD|3.0TD|6.1TD|GAS",',
        ' "region": "PENINSULA|BALEARES|CANARIAS|CEUTA_MELILLA",',
        ' "clientName": "", "address": "", "cups": "",',
        ' "billingDays": 0, "currentBill": 0, "cae": 0,',
        ' "consumption": {"P1":0,"P2":0,"P3":0,"P4":0,"P5":0,"P6":0},',
        ' "power": {"P1":0,"P2":0,"P3":0,"P4":0,"P5":0,"P6":0},',
        ' "equipmentRental": 0, "otherCosts": 0, "discountEnergy": 0, "discountPower": 0,',
        ' "reactiveEnergy": 0, "excessPower": 0, "socialBonus": 0,',
        ' "surpluses": 0,',
        ' "vatRate": 0, "electricityTaxRate": 0,',
        ' "gasMonthlyConsumption": 0, "gasFixedDaily": 0, "gasVariableKwh": 0, "gasTariffBand": "RL1|RL2|RL3|RL4|RL5"',
        '}',
        'REGLA DE FORMATO JSON: Asegúrate de que todas las cadenas de texto del JSON (como address, clientName, etc.) estén en una sola línea, sin saltos de línea reales (si hay un salto de línea en la factura original, reemplázalo por un espacio en el JSON) y escapa adecuadamente las comillas dobles si las hubiera, para evitar errores al parsear el JSON.',
        'REGLAS CRÍTICAS DE CLASIFICACIÓN DE TARIFA (tariffType):',
        '1. PROHIBICIÓN DE 2.0TD CON 6 PERIODOS: Si la factura contiene referencias a los periodos P4, P5, P6 o muestra una tabla con columnas para Periodo 4, Periodo 5 o Periodo 6 (incluso si los valores bajo los periodos P1, P2, P3 están vacíos/en blanco), queda TERMINANTEMENTE PROHIBIDO clasificarla como "2.0TD". Debe ser "6.1TD" o "3.0TD".',
        '2. DETECCIÓN 3.0TD vs 6.1TD BASADA EN PÉRDIDAS: Si la factura tiene 6 periodos (P1-P6) y no se especifica de manera directa "3.0TD" o "6.1TD" en el texto:',
        '   - Revisa los valores de los coeficientes de pérdidas (fila "Perd", "Pérdidas" o "Coeficiente de pérdidas"). Si estos coeficientes para los periodos son bajos (del orden de 1,02 a 1,09 o entre 2% y 9% de pérdidas), cataloga la tarifa en tariffType estrictamente como "6.1TD" (Alta Tensión).',
        '   - Si los coeficientes son altos (del orden de 1,10 a 1,16 o superiores), catalógala como "3.0TD" (Baja Tensión).',
        '   - En caso de no haber datos de pérdidas, si ves potencias contratadas superiores a 15 kW en media/alta tensión o se intuye tarifa de alta tensión, usa "6.1TD".',
        'MAPEO CRÍTICO DE COLUMNAS PARA CONSUMO Y POTENCIA (P1 a P6):',
        '- Cada columna de la tabla de la factura corresponde estrictamente a su periodo: Periodo 1 -> P1, Periodo 2 -> P2, Periodo 3 -> P3, Periodo 4 -> P4, Periodo 5 -> P5, Periodo 6 -> P6.',
        '- Si una columna o celda está vacía, en blanco, o no contiene ningún número impreso en la factura, significa que el valor para ese periodo es 0. Debes poner 0 en su clave correspondiente del JSON.',
        '- Queda TERMINANTEMENTE PROHIBIDO desplazar, compactar o desordenar las columnas. Por ejemplo, si en la factura las columnas de Periodo 1, Periodo 2 y Periodo 3 están vacías o en blanco en la tabla, y los periodos 4, 5 y 6 muestran los números 437, 279 y 728:',
        '  * DEBES devolver en el JSON: P1: 0, P2: 0, P3: 0, P4: 437, P5: 279, P6: 728.',
        '  * NUNCA pongas 437 en P1, ni desplaces ninguno de los siguientes valores a periodos inferiores.',
        'REGLAS ADICIONALES DE EXTRACCIÓN DE CONSUMO POR PERIODOS:',
        '1. NUNCA sumes los consumos de diferentes periodos para poner el total en P1. Debes extraer los consumos individuales de cada periodo (P1/P2/P3 para 2.0TD; P1-P6 para 3.0TD/6.1TD).',
        '2. RECORRE TODAS LAS PÁGINAS del documento. La primera página suele mostrar un "resumen" o un consumo total (ej. "Consumo de electricidad: 320 kWh"), pero el desglose detallado está en las páginas interiores (en la sección de "Detalle de la Factura" -> "Término de energía" o "Peajes y Cargos", o en la sección de "Lecturas" / "Lecturas y Consumos" / "Información del consumo eléctrico" al final de la factura). Es OBLIGATORIO buscar y extraer el desglose por periodos (Punta, Llano, Valle o P1, P2, P3).',
        '3. En las facturas de Endesa (Endesa Energía o Energía XXI), Naturgy, Iberdrola, TotalEnergies, Repsol y otras, los consumos de cada periodo se muestran detallados en dos sitios principales:',
        '   a) En la tabla de "Lecturas" o "Información del consumo eléctrico" al final de la factura. Esta tabla tiene filas como "Punta", "Llano", "Valle" (o P1, P2, P3) y una columna de "Consumo" o "Diferencia de lecturas" en kWh. Extrae esos valores individuales: Punta -> P1, Llano -> P2, Valle -> P3.',
        '   b) En el desglose de conceptos facturados (habitualmente bajo el epígrafe "Peajes de acceso", "Peajes y cargos" o "Importe por energía consumida"), donde se detalla el coste de la potencia y la energía por periodos Punta, Llano, Valle (o P1, P2, P3). Busca el número de kWh facturado en cada una de estas líneas y asígnalo a su periodo correspondiente.',
        '4. PROHIBICIÓN DE AGRUPACIÓN LAZA: No uses el atajo de colocar el consumo total en P1 si existe un desglose de periodos en alguna otra página del documento. Solo en el caso excepcional de que la factura NO contenga absolutamente ningún desglose de periodos en ninguna de sus páginas (por ejemplo, en tarifas planas puras no reguladas que omitan toda información de peajes), podrás colocar el consumo total en P1 y dejar P2 y P3 a 0. Si hay desglose, úsalo.',
        'REGLAS ADICIONALES DE POTENCIA:',
        '- En power devuelve SOLO la potencia contratada en kW de cada periodo. Nunca devuelvas el precio en €/kW día, el importe en euros, ni cálculos intermedios.',
        '- ATENCIÓN POTENCIA 2.0TD: Si en la factura aparece "Pot. P3" o potencia Valle, y la tarifa es 2.0TD, colócala en power.P2 (ya que 2.0TD solo tiene P1 y P2 en potencia).',
        '- Ejemplo: si ves "Término potencia P1 13,150 kW x 28 días x 0,122973 €/kW día", entonces power.P1 = 13.15.',
        'OTRAS REGLAS DE EXTRACCIÓN:',
        'Gas: rellena gasMonthlyConsumption (kWh del periodo), gasVariableKwh (€/kWh del término variable) y gasFixedDaily (€/día). Deja consumo/potencia en 0.',
        'Incluye billingDays, currentBill (TOTAL con impuestos e IVA), equipmentRental (alquiler de equipos) y socialBonus (€ por factura).',
        'IMPORTANTE: currentBill debe conservar el signo. Si el total es un abono/crédito y aparece en negativo (con "-" o como abono), devuelve currentBill como número negativo. Ejemplo: si ves "-1.516,92 €" devuelve -1516.92.',
        'Devuelve importes como números JSON (no texto), sin separadores de miles y con punto decimal.',
        'NO extraigas ni infieras discountEnergy, discountPower, reactiveEnergy ni excessPower: devuelve esos 4 campos siempre en 0 (se informan manualmente en el formulario).',
        'EXCEDENTES (SOLAR): El campo surpluses debe contener SOLO el IMPORTE EN EUROS (€) que se DESCUENTA por excedentes/compensación (aparece como importe negativo o descuento). Devuelve el valor en positivo; el comparador lo restará. Si solo ves kWh excedentarios sin importe, pon 0.',
        'No metas en surpluses descuentos comerciales/promocionales (porcentaje, fidelización, etc.). Solo compensación real por excedentes solares.',
        'En otherCosts pon SOLO otros conceptos distintos de alquileres, impuestos, IVA, tasas o recargos regulados. No pongas impuestos ni IVA dentro de otherCosts; esos ya van incluidos dentro de currentBill.',
        'IMPUESTOS: Extrae el porcentaje real de IVA que aparece en la factura como número decimal (p.ej. si aparece "10%" → vatRate=0.10, si aparece "21%" → vatRate=0.21). Extrae también el porcentaje del Impuesto Eléctrico (también llamado Impuesto especial sobre la electricidad) como número decimal (p.ej. si aparece "5,1126963%" → electricityTaxRate=0.051126963, si aparece "0,5%" → electricityTaxRate=0.005). Si el porcentaje no aparece explícitamente en la factura, pon 0 en ese campo.',
        'No incluyas texto fuera del JSON.',
        `Archivo de referencia: ${fileName || 'factura'}.`
    ].join('\n');

    return {
        contents: [
            {
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: mimeType || 'application/pdf', data: base64 } }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            // 8192 evita truncamiento observado por tokens de pensamiento (thoughtsTokenCount) en gemini-2.5-flash
            maxOutputTokens: 8192
        }
    };
}

function parseLooseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    let normalized = raw.replace(/\s+/g, '');
    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');
    if (hasComma && hasDot) {
        normalized = normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
            ? normalized.replace(/\./g, '').replace(',', '.')
            : normalized.replace(/,/g, '');
    } else if (hasComma) {
        normalized = normalized.replace(',', '.');
    }
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
}

function sanitizePowerPeriods(power, tariffType) {
    if (!power || typeof power !== 'object') return power;
    const next = { ...power };
    const periods = tariffType === '2.0TD'
        ? ['P1', 'P2']
        : (tariffType === '3.0TD' || tariffType === '6.1TD')
            ? ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
            : [];

    periods.forEach((period) => {
        let value = parseLooseNumber(next[period]);
        
        // Map P3 to P2 for 2.0TD if P2 is empty and P3 has value
        if (tariffType === '2.0TD' && period === 'P2' && (value === null || value === 0)) {
            const p3Value = parseLooseNumber(power['P3']);
            if (p3Value !== null && p3Value > 0) {
                value = p3Value;
            }
        }

        if (value === null) return;
        // 2.0TD no puede superar 15 kW; además evitamos números absurdos por LLM.
        if ((tariffType === '2.0TD' && value > 15) || value > 100) {
            next[period] = 0;
            return;
        }
        next[period] = value;
    });

    return next;
}

function countPositivePeriods(periods, keys) {
    if (!periods || typeof periods !== 'object') return 0;
    return keys.reduce((count, key) => {
        const value = parseLooseNumber(periods[key]);
        return count + ((value !== null && Math.abs(value) > 0) ? 1 : 0);
    }, 0);
}

function evaluateExtractionCompleteness(extracted) {
    const rawEnergyType = String(extracted?.energyType ?? '').trim().toLowerCase();
    const energyType = rawEnergyType === 'gas'
        ? 'gas'
        : (rawEnergyType.startsWith('elec') ? 'electricidad' : null);
    const billingDays = parseLooseNumber(extracted?.billingDays);
    const currentBill = parseLooseNumber(extracted?.currentBill);

    if (!energyType) return { complete: false, score: 0, reason: 'El tipo de energía (luz/gas) no pudo ser detectado.' };

    if (energyType === 'gas') {
        const gasMonthlyConsumption = parseLooseNumber(extracted?.gasMonthlyConsumption);
        const gasFixedDaily = parseLooseNumber(extracted?.gasFixedDaily);
        const gasVariableKwh = parseLooseNumber(extracted?.gasVariableKwh);
        const gasTariffBand = String(extracted?.gasTariffBand ?? '').trim().toUpperCase();
        const checks = [
            billingDays > 0,
            currentBill !== null && Math.abs(currentBill) > 0,
            gasMonthlyConsumption !== null && gasMonthlyConsumption > 0,
            gasFixedDaily !== null && gasFixedDaily > 0,
            gasVariableKwh !== null && gasVariableKwh > 0,
            /^RL[1-5]$/.test(gasTariffBand)
        ];
        const passed = checks.filter(Boolean).length;
        return {
            complete: passed >= 5,
            score: passed / checks.length,
            reason: passed >= 5 ? '' : 'Faltan datos de gas o factura'
        };
    }

    const tariffType = String(extracted?.tariffType ?? '').trim().toUpperCase();
    const periods = tariffType === '2.0TD'
        ? { consumption: ['P1', 'P2', 'P3'], power: ['P1', 'P2'] }
        : ((tariffType === '3.0TD' || tariffType === '6.1TD')
            ? { consumption: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'], power: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] }
            : null);

    if (!periods) return { complete: false, score: 0.3, reason: 'tariffType ausente o inválido' };

    const filledConsumption = countPositivePeriods(extracted?.consumption, periods.consumption);
    const filledPower = countPositivePeriods(extracted?.power, periods.power);
    // 2.0TD: 2 periodos de consumo y 2 de potencia.
    // 3.0TD / 6.1TD: 3 periodos de consumo válidos en la mayoría de facturas
    // (raramente 4), pero potencia sí se contrata en los 6 periodos.
    const minConsumption = tariffType === '2.0TD' ? 2 : 3;
    const minPower = tariffType === '2.0TD' ? 2 : 4;
    // CAE ya no se exige como criterio de completeness: muchas facturas reales
    // (comunidades, 3.0TD, etc.) no lo traen. El usuario lo informa manualmente si hace falta.
    const checks = [
        billingDays > 0,
        currentBill !== null && Math.abs(currentBill) > 0,
        filledConsumption >= minConsumption,
        filledPower >= minPower
    ];
    const passed = checks.filter(Boolean).length;
    return {
        complete: passed >= 4,
        score: passed / checks.length,
        reason: passed >= 4 ? '' : 'Faltan datos de electricidad o factura'
    };
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// Ejecuta una llamada a un modelo concreto. Devuelve { parsed, quality } si OK,
// o lanza error con .status e .isOverload para que el orquestador decida.
async function callSingleModel(model, payload, requestId) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${GEMINI_API_KEY}`;
    const t0 = Date.now();

    let res;
    try {
        res = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }, CALL_TIMEOUT_MS);
    } catch (fetchErr) {
        const isTimeout = fetchErr?.name === 'AbortError';
        console.warn(`[extraer-factura] req=${requestId} model=${model} NETWORK ms=${Date.now() - t0} ${isTimeout ? 'TIMEOUT' : fetchErr.message}`);
        throw Object.assign(new Error(isTimeout ? 'Tiempo de espera agotado' : 'Error de red'), {
            status: 503,
            isOverload: true,
            model
        });
    }

    const latency = Date.now() - t0;

    if (!res.ok) {
        let msg = `Error ${res.status}`;
        try { const err = await res.json(); msg = err?.error?.message || msg; } catch (_) {}
        const isOverload = res.status === 429 || res.status === 503 || /overloaded|high demand|quota|rate/i.test(msg);
        console.warn(`[extraer-factura] req=${requestId} model=${model} HTTP_ERROR status=${res.status} ms=${latency} isOverload=${isOverload} msg="${msg}"`);
        throw Object.assign(new Error(isOverload ? 'Servicio saturado' : msg), {
            status: res.status,
            isOverload,
            model
        });
    }

    const json = await res.json();
    const textPart = (json?.candidates?.[0]?.content?.parts || [])
        .map((p) => p?.text)
        .find(Boolean);

    if (!textPart) {
        const finishReason = String(json?.candidates?.[0]?.finishReason || '').trim();
        const blockReason = String(json?.promptFeedback?.blockReason || '').trim();
        console.warn(`[extraer-factura] req=${requestId} model=${model} NO_CONTENT ms=${latency} finish=${finishReason} block=${blockReason}`);
        throw Object.assign(
            new Error(blockReason ? `Lectura bloqueada (${blockReason})` : `Sin contenido (${finishReason || 'desconocido'})`),
            { status: 502, model }
        );
    }

    let parsed;
    try {
        parsed = parseGeminiJson(textPart);
    } catch (parseErr) {
        console.warn(`[extraer-factura] req=${requestId} model=${model} PARSE_FAIL ms=${latency} msg="${parseErr.message}"`);
        throw Object.assign(parseErr, { status: 502, model });
    }

    const quality = evaluateExtractionCompleteness(parsed);
    console.log(`[extraer-factura] req=${requestId} model=${model} OK ms=${latency} score=${quality.score.toFixed(2)} complete=${quality.complete}`);
    return { parsed, quality };
}

// Orquestador: prueba todos los modelos en cascada.
// Por cada modelo, hasta MAX_OVERLOAD_RETRIES reintentos rápidos si hay saturación.
// Devuelve el primer resultado completo, o el mejor parcial si ninguno es completo.
async function callGemini(payload, requestId) {
    const models = getModelCandidates();
    if (!models.length) {
        const err = new Error('Configuración del servidor incompleta');
        err.status = 500;
        throw err;
    }

    let lastErr = null;
    let bestPartial = null;

    for (const model of models) {
        let overloadAttempt = 0;

        while (overloadAttempt <= MAX_OVERLOAD_RETRIES) {
            try {
                const { parsed, quality } = await callSingleModel(model, payload, requestId);

                if (quality.complete) return parsed;

                // Resultado parcial: guardar el mejor y pasar al siguiente modelo
                if (!bestPartial || quality.score > bestPartial.score) {
                    bestPartial = { result: parsed, score: quality.score, model };
                }
                lastErr = Object.assign(
                    new Error(`Extracción incompleta: ${quality.reason}`),
                    { status: 422, model, incomplete: true }
                );
                break; // no retries por incompleto, salta al siguiente modelo
            } catch (err) {
                lastErr = err;
                const retryable = err.isOverload && overloadAttempt < MAX_OVERLOAD_RETRIES;
                if (retryable) {
                    await new Promise((r) => setTimeout(r, OVERLOAD_BACKOFF_MS));
                    overloadAttempt++;
                    continue;
                }
                break; // error no recuperable → siguiente modelo
            }
        }
    }

    // Ningún modelo devolvió resultado completo. Si hay parcial, devolverlo.
    if (bestPartial?.result) {
        console.log(`[extraer-factura] req=${requestId} FALLBACK_PARTIAL model=${bestPartial.model} score=${bestPartial.score.toFixed(2)}`);
        return bestPartial.result;
    }
    if (lastErr) throw lastErr;
    const error = new Error('Servicio saturado');
    error.status = 503;
    throw error;
}

function removeNewlinesInJsonValues(jsonStr) {
    const chars = [];
    let inString = false;
    let escape = false;
    for (const char of jsonStr) {
        if (char === '"' && !escape) {
            inString = !inString;
        }
        if (char === '\\' && inString) {
            escape = !escape;
        } else {
            escape = false;
        }

        if ((char === '\n' || char === '\r') && inString) {
            chars.push(' ');
        } else {
            chars.push(char);
        }
    }
    return chars.join('');
}

function parseGeminiJson(text) {
    if (!text || typeof text !== 'string') throw new Error('Respuesta vacía del servicio');
    let cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    cleaned = removeNewlinesInJsonValues(cleaned);

    function normalizeMap(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.length > 0 ? normalizeMap(obj[0]) : {};
        const normalized = {};
        for (const key of Object.keys(obj)) {
            const camelKey = key.replace(/([-_][a-z])/gi, ($1) => $1.toUpperCase().replace('-', '').replace('_', ''));
            let finalKey = camelKey;
            if (/^(tipoEnergia|energy|tipo_energia|energia)$/i.test(key)) finalKey = 'energyType';
            if (/^(tipoTarifa|tarifa|tariff)$/i.test(key)) finalKey = 'tariffType';
            if (/^(diasFacturacion|dias|diasFacturados|billing_days)$/i.test(key)) finalKey = 'billingDays';
            if (/^(totalFactura|total|importeTotal|current_bill)$/i.test(key)) finalKey = 'currentBill';
            normalized[finalKey] = typeof obj[key] === 'object' && !Array.isArray(obj[key]) ? normalizeMap(obj[key]) : obj[key];
        }
        return normalized;
    }

    try {
        const parsed = JSON.parse(cleaned);
        return normalizeMap(parsed);
    } catch (err) {
        try {
            const match = cleaned.match(/\{[\s\S]*\}/);
            if (match) return normalizeMap(JSON.parse(match[0]));
        } catch (_) {}
        const error = new Error(`Respuesta del servicio no válida${err?.message ? `: ${err.message}` : ''}`);
        error.status = 502;
        throw error;
    }
}
