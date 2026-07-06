const { PDFParse } = require('pdf-parse');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GEMINI_FALLBACK_MODELS = String(process.env.GEMINI_FALLBACK_MODELS || 'gemini-2.5-flash-lite')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function getGeminiModelCandidates() {
  const seen = new Set();
  const out = [];
  [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS].forEach((model) => {
    if (!model || seen.has(model)) return;
    seen.add(model);
    out.push(model);
  });
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  let fileName = 'factura.pdf';
  let mimeType = 'application/pdf';
  try {
    if (!GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY en el servidor');
    const payload = JSON.parse(event.body || '{}');
    ({ fileName = 'factura.pdf', mimeType = 'application/pdf' } = payload);
    const { base64 } = payload;
    if (!base64) throw new Error('Archivo no recibido');

    const buffer = Buffer.from(base64, 'base64');
    const pdfText = await extractPdfText(buffer, { fileName, mimeType });
    const geminiPayload = buildGeminiPayload({ fileName, mimeType, base64 });
    const rawResult = await callGemini(geminiPayload);
    const result = applyPdfTextHints(rawResult, pdfText);
    const completeness = evaluateExtractionCompleteness(result);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extracted: result, completeness })
    };
  } catch (err) {
    const status = err.status || 500;
    console.error('[extraer-factura] Error procesando factura', {
      fileName,
      mimeType,
      status,
      message: err.message || 'Error interno',
      model: err.model || null,
      incomplete: Boolean(err.incomplete),
      geminiMeta: err.geminiMeta || null,
      rawSnippet: err.rawSnippet || null
    });
    return { statusCode: status, body: JSON.stringify({ error: err.message || 'Error interno' }) };
  }
};

function buildGeminiPayload({ fileName, mimeType, base64 }) {
  const prompt = [
    'Eres un extractor de datos de facturas de electricidad o gas en España.',
    'Lee todas las páginas de la factura. Devuelve SOLO un JSON con estos campos (usa 0 cuando no haya dato):',
    '{',
    ' "energyType": "electricidad|gas",',
    ' "tariffType": "2.0TD|3.0TD|6.1TD|GAS",',
    ' "region": "PENINSULA|BALEARES|CANARIAS|CEUTA|MELILLA",',
    ' "clientName": "", "address": "", "cups": "",',
    ' "billingDays": 0, "currentBill": 0, "cae": 0,',
    ' "consumption": {"P1":0,"P2":0,"P3":0,"P4":0,"P5":0,"P6":0},',
    ' "power": {"P1":0,"P2":0,"P3":0,"P4":0,"P5":0,"P6":0},',
    ' "equipmentRental": 0, "otherCosts": 0, "discountEnergy": 0, "discountPower": 0,',
    ' "reactiveEnergy": 0, "excessPower": 0, "socialBonus": 0, "surpluses": 0,',
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
    '- Cada columna de la tabla de la factura corresponds strictly to its period: Periodo 1 -> P1, Periodo 2 -> P2, Periodo 3 -> P3, Periodo 4 -> P4, Periodo 5 -> P5, Periodo 6 -> P6.',
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
    'CUPS: Si el CUPS parece terminar en "OF" (letra O + F), es un error. Debe ser "0F" (CERO + F).',
    'ENERGÍA REACTIVA: El campo reactiveEnergy debe contener SOLO el IMPORTE EN EUROS (€) por penalización de reactiva, NO la cantidad de kVArh ni el consumo en kWh. Si solo ves kVArh/kWh sin importe en euros, pon 0.',
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
      temperature: 0.2,
      responseMimeType: 'application/json',
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

async function extractPdfText(buffer, { fileName = '', mimeType = '' } = {}) {
  const normalizedName = String(fileName).toLowerCase();
  const normalizedMime = String(mimeType).toLowerCase();
  const isPdf = normalizedName.endsWith('.pdf') || normalizedMime.includes('pdf');
  if (!isPdf || !buffer?.length) return '';

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return String(result?.text || '');
  } catch (_) {
    return '';
  } finally {
    try { await parser.destroy(); } catch (_) {}
  }
}

function extractPowerHintsFromText(text, tariffType) {
  if (!text || !tariffType) return {};
  const periods = tariffType === '2.0TD'
    ? ['P1', 'P2']
    : (tariffType === '3.0TD' || tariffType === '6.1TD')
      ? ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']
      : [];
  if (!periods.length) return {};

  const hints = {};
  const lines = String(text)
    .replace(/\u00a0/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (const line of lines) {
    if (!/kW\b/i.test(line) || !/P[1-6]/i.test(line)) continue;
    const periodMatch = line.match(/\bP([1-6])\b/i);
    if (!periodMatch) continue;
    const period = `P${periodMatch[1]}`;
    if (!periods.includes(period) || hints[period] !== undefined) continue;

    const kwMatches = Array.from(line.matchAll(/([0-9]+(?:[.,][0-9]+)?)\s*kW\b/gi))
      .map((match) => parseLooseNumber(match[1]))
      .filter((value) => value !== null && value > 0);

    if (kwMatches.length > 0) hints[period] = kwMatches[0];
  }

  return hints;
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
    const value = parseLooseNumber(next[period]);
    if (value === null) return;
    if ((tariffType === '2.0TD' && value > 15) || value > 100) {
      next[period] = 0;
      return;
    }
    next[period] = value;
  });

  return next;
}

function applyPdfTextHints(extracted, pdfText) {
  if (!extracted || typeof extracted !== 'object') return extracted;
  const tariffType = String(extracted?.tariffType ?? '').trim().toUpperCase();
  if (!tariffType || !pdfText) {
    return {
      ...extracted,
      power: sanitizePowerPeriods(extracted?.power, tariffType)
    };
  }

  const hintedPower = extractPowerHintsFromText(pdfText, tariffType);
  const currentPower = sanitizePowerPeriods(extracted?.power, tariffType) || {};
  const mergedPower = { ...currentPower };
  Object.entries(hintedPower).forEach(([period, value]) => {
    mergedPower[period] = value;
  });

  return {
    ...extracted,
    power: mergedPower
  };
}

async function callGemini(payload) {
  const models = getGeminiModelCandidates();
  const maxOverloadRetries = 3;
  const maxIncompleteRetries = 2;
  let lastErr = null;
  let bestPartial = null;

  for (const model of models) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${GEMINI_API_KEY}`;
    let overloadAttempt = 0;
    let modelProcessed = false;

    while (overloadAttempt <= maxOverloadRetries) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let msg = `Gemini error ${res.status}`;
        try { const err = await res.json(); msg = err.error?.message || msg; } catch (_) {}

        const overload = res.status === 429 || res.status === 503 || /overloaded|quota|rate/i.test(msg);
        if (overload && overloadAttempt < maxOverloadRetries) {
          const delayMs = 1500 * Math.pow(2, overloadAttempt);
          await new Promise(r => setTimeout(r, delayMs));
          lastErr = Object.assign(new Error(msg), { status: res.status, model });
          overloadAttempt++;
          continue;
        }

        lastErr = Object.assign(
          new Error(/overloaded/i.test(msg) ? 'Gemini está saturado. Intenta de nuevo en unos segundos.' : msg),
          { status: res.status, model }
        );
        break;
      }

      let incompleteAttempt = 0;
      while (incompleteAttempt <= maxIncompleteRetries) {
        let json;
        if (incompleteAttempt === 0) {
          json = await res.json();
        } else {
          const retryRes = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!retryRes.ok) {
            let msg = `Gemini error ${retryRes.status}`;
            try { const err = await retryRes.json(); msg = err.error?.message || msg; } catch (_) {}
            lastErr = Object.assign(new Error(msg), { status: retryRes.status, model });
            break;
          }
          json = await retryRes.json();
        }

        const textPart = (json?.candidates?.[0]?.content?.parts || [])
          .map((part) => part?.text)
          .find(Boolean);
        if (!textPart) {
          lastErr = buildGeminiNoContentError(json, model);
          break;
        }

        let parsed;
        try {
          parsed = parseGeminiJson(textPart);
        } catch (error) {
          lastErr = Object.assign(error, { status: error.status || 502, model });
          break;
        }

        const quality = evaluateExtractionCompleteness(parsed);
        if (quality.complete) return parsed;

        if (!bestPartial || quality.score > bestPartial.score) {
          bestPartial = { result: parsed, score: quality.score, model, reason: quality.reason };
        }

        lastErr = Object.assign(
          new Error(`Extracción incompleta con ${model}: ${quality.reason}`),
          { status: 422, model, incomplete: true }
        );
        incompleteAttempt++;
      }

      modelProcessed = true;
      break;
    }

    if (modelProcessed) continue;
  }

  if (bestPartial && bestPartial.result) return bestPartial.result;
  if (lastErr) throw lastErr;
  const error = new Error('Gemini está saturado. Intenta de nuevo en unos segundos.');
  error.status = 503;
  throw error;
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
  const minConsumption = tariffType === '2.0TD' ? 2 : 4;
  const minPower = tariffType === '2.0TD' ? 2 : 4;
  const cae = parseLooseNumber(extracted?.cae);
  const checks = [
    billingDays > 0,
    currentBill !== null && Math.abs(currentBill) > 0,
    filledConsumption >= minConsumption,
    filledPower >= minPower,
    cae !== null && cae > 0
  ];
  const passed = checks.filter(Boolean).length;
  return {
    complete: passed >= 4,
    score: passed / checks.length,
    reason: passed >= 4 ? '' : 'Faltan datos de electricidad o factura'
  };
}

function parseGeminiJson(text) {
    if (!text || typeof text !== 'string') throw new Error('Respuesta vacía de Gemini');
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();

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
        const error = new Error(`No se pudo interpretar la respuesta de Gemini${err?.message ? `: ${err.message}` : ''}`);
        error.status = 502;
        error.rawSnippet = cleaned.slice(0, 400);
        throw error;
    }
}

function buildGeminiNoContentError(json, model) {
  const finishReason = String(json?.candidates?.[0]?.finishReason || '').trim();
  const blockReason = String(json?.promptFeedback?.blockReason || '').trim();
  const blockReasonMessage = String(json?.promptFeedback?.blockReasonMessage || '').trim();
  const message = blockReason
    ? `Gemini bloqueó la lectura del PDF (${blockReason}${blockReasonMessage ? `: ${blockReasonMessage}` : ''}).`
    : finishReason
      ? `Gemini no devolvió contenido (${finishReason}).`
      : 'Gemini no devolvió contenido';
  return Object.assign(new Error(message), {
    status: 502,
    model,
    geminiMeta: {
      finishReason: finishReason || null,
      blockReason: blockReason || null,
      blockReasonMessage: blockReasonMessage || null
    }
  });
}
