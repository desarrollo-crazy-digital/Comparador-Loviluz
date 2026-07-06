#!/usr/bin/env node
/**
 * Test multi-modelo Gemini con la factura de ejemplo.
 *
 * Prueba cada modelo candidato midiendo:
 *  - Latencia (ms)
 *  - Status HTTP
 *  - Si devuelve JSON parseable
 *  - Completeness score (mismos criterios que la API real)
 *  - Coste estimado en tokens
 *  - Errores concretos (rate limit, saturación, timeout...)
 *
 * Uso:
 *   node scripts/test-gemini-models.mjs
 *
 * Requisitos: GOOGLE_API_KEY (o GEMINI_API_KEY) en .env
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// --- Cargar .env manualmente (sin dotenv) ---
async function loadEnv() {
    try {
        const envText = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
        for (const line of envText.split('\n')) {
            const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]]) {
                process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
            }
        }
    } catch (_) {}
}

await loadEnv();

const API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error('❌ Falta GOOGLE_API_KEY o GEMINI_API_KEY en .env');
    process.exit(1);
}

// --- Modelos a probar (todos los candidatos reales) ---
const MODELS_TO_TEST = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b'
];

// --- Cargar factura de ejemplo ---
const PDF_PATH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'public', '241 - Factura ENERGIA 26000000993 INER.pdf');
const pdfBuffer = await fs.readFile(PDF_PATH);
const pdfBase64 = pdfBuffer.toString('base64');
console.log(`📄 Factura cargada: ${PDF_PATH}`);
console.log(`   Tamaño: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);
console.log(`   Base64: ${(pdfBase64.length / 1024).toFixed(1)} KB\n`);

// --- Prompt idéntico al de producción ---
const PROMPT = [
    'Eres un extractor de datos de facturas de electricidad o gas en España.',
    'Lee SOLO las dos primeras páginas de la factura (ignora el resto). Devuelve SOLO un JSON con estos campos (usa 0 cuando no haya dato):',
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
    ' "gasMonthlyConsumption": 0, "gasFixedDaily": 0, "gasVariableKwh": 0, "gasTariffBand": "RL1|RL2|RL3|RL4|RL5"',
    '}',
    'Electricidad:',
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
    ' - POTENCIA:',
    '- En power devuelve SOLO la potencia contratada en kW de cada periodo. Nunca devuelvas el precio en €/kW día, el importe en euros, ni cálculos intermedios.',
    '- IMPORTANTE PARA TARIFAS 6.1TD: Mapea cada potencia contratada asociándola estrictamente a su periodo correspondiente (Periodo 1 a Periodo 6) con su respectiva clave (P1 a P6). Si la factura solo especifica potencias contratadas para ciertos periodos (por ejemplo, si solo aparecen valores para P4, P5 y P6), debes asignar los valores estrictamente a sus claves correspondientes (P4, P5, P6) y rellenar con 0 las demás. Queda TERMINANTEMENTE PROHIBIDO compactar, desplazar o situar potencias de los periodos superiores (P4, P5, P6) en las claves de los periodos inferiores (P1, P2, P3) por el mero hecho de ser los únicos valores visibles o aparecer en primer lugar.',
    ' - Ejemplo: si ves "Término potencia P1 13,150 kW x 28 días x 0,122973 €/kW día", entonces power.P1 = 13.15.',
    'Gas: rellena gasMonthlyConsumption (kWh del periodo), gasVariableKwh (€/kWh del término variable) y gasFixedDaily (€/día). Deja consumo/potencia en 0.',
    'Incluye billingDays, currentBill (TOTAL con impuestos e IVA), equipmentRental (alquiler de equipos) y socialBonus (€ por factura).',
    'IMPORTANTE: currentBill debe conservar el signo. Si el total es un abono/crédito y aparece en negativo (con "-" o como abono), devuelve currentBill como número negativo. Ejemplo: si ves "-1.516,92 €" devuelve -1516.92.',
    'Devuelve importes como números JSON (no texto), sin separadores de miles y con punto decimal.',
    'NO extraigas ni infieras discountEnergy, discountPower, reactiveEnergy ni excessPower: devuelve esos 4 campos siempre en 0 (se informan manualmente en el formulario).',
    'EXCEDENTES (SOLAR): El campo surpluses debe contener SOLO el IMPORTE EN EUROS (€) que se DESCUENTA por excedentes/compensación (aparece como importe negativo o descuento). Devuelve el valor en positivo; el comparador lo restará. Si solo ves kWh excedentarios sin importe, pon 0.',
    'No metas en surpluses descuentos comerciales/promocionales (porcentaje, fidelización, etc.). Solo compensación real por excedentes solares.',
    'En otherCosts pon SOLO otros conceptos distintos de alquileres, impuestos, IVA, tasas o recargos regulados. No pongas impuestos ni IVA dentro de otherCosts; esos ya van incluidos dentro de currentBill.',
    'No incluyas texto fuera del JSON.',
    'Archivo de referencia: factura-test.pdf.'
].join('\n');

// --- Helpers idénticos a producción ---
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

    if (!energyType) return { complete: false, score: 0, reason: 'sin energyType' };

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
        return { complete: passed >= 5, score: passed / checks.length, reason: passed >= 5 ? '' : 'gas incompleto' };
    }

    const tariffType = String(extracted?.tariffType ?? '').trim().toUpperCase();
    const periods = tariffType === '2.0TD'
        ? { consumption: ['P1', 'P2', 'P3'], power: ['P1', 'P2'] }
        : ((tariffType === '3.0TD' || tariffType === '6.1TD')
            ? { consumption: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'], power: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] }
            : null);

    if (!periods) return { complete: false, score: 0.3, reason: 'tariffType inválido' };

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
    return { complete: passed >= 4, score: passed / checks.length, reason: passed >= 4 ? '' : 'electricidad incompleta' };
}

function parseGeminiJson(text) {
    if (!text || typeof text !== 'string') throw new Error('Respuesta vacía');
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    try { return JSON.parse(cleaned); }
    catch (_) {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('JSON no parseable');
    }
}

// --- Función de test por modelo ---
async function testModel(model) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${API_KEY}`;
    const payload = {
        contents: [
            {
                parts: [
                    { text: PROMPT },
                    { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            maxOutputTokens: 8192
        }
    };

    const t0 = Date.now();
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const latency = Date.now() - t0;

        if (!res.ok) {
            let errMsg = `HTTP ${res.status}`;
            try { const err = await res.json(); errMsg = err?.error?.message || errMsg; } catch (_) {}
            return {
                model,
                ok: false,
                status: res.status,
                latency_ms: latency,
                error: errMsg
            };
        }

        const json = await res.json();
        const usage = json.usageMetadata || {};
        const textPart = (json.candidates?.[0]?.content?.parts || [])
            .map((p) => p?.text)
            .find(Boolean);

        if (!textPart) {
            return {
                model,
                ok: false,
                status: res.status,
                latency_ms: latency,
                error: `Sin contenido (finishReason=${json.candidates?.[0]?.finishReason || '?'})`
            };
        }

        let parsed;
        try { parsed = parseGeminiJson(textPart); }
        catch (e) {
            return {
                model,
                ok: false,
                status: res.status,
                latency_ms: latency,
                error: `JSON parse error: ${e.message}`,
                rawSnippet: textPart.slice(0, 200)
            };
        }

        const quality = evaluateExtractionCompleteness(parsed);

        return {
            model,
            ok: true,
            status: res.status,
            latency_ms: latency,
            tokens_in: usage.promptTokenCount || 0,
            tokens_out: usage.candidatesTokenCount || 0,
            tokens_total: usage.totalTokenCount || 0,
            complete: quality.complete,
            score: quality.score,
            reason: quality.reason,
            extracted: {
                energyType: parsed.energyType,
                tariffType: parsed.tariffType,
                region: parsed.region,
                billingDays: parsed.billingDays,
                currentBill: parsed.currentBill,
                consumption: parsed.consumption,
                power: parsed.power,
                cae: parsed.cae
            }
        };
    } catch (netErr) {
        return {
            model,
            ok: false,
            latency_ms: Date.now() - t0,
            error: `Error de red: ${netErr.message}`
        };
    }
}

// --- Precios reales por 1M tokens (USD) — paid tier ---
const PRICING = {
    'gemini-2.5-flash':        { in: 0.30, out: 2.50 },
    'gemini-2.5-flash-lite':   { in: 0.10, out: 0.40 },
    'gemini-2.0-flash':        { in: 0.10, out: 0.40 },
    'gemini-2.0-flash-lite':   { in: 0.075, out: 0.30 },
    'gemini-1.5-flash':        { in: 0.075, out: 0.30 },
    'gemini-1.5-flash-8b':     { in: 0.0375, out: 0.15 }
};

function estimateCost(result) {
    const p = PRICING[result.model];
    if (!p || !result.tokens_in) return null;
    const cost = (result.tokens_in / 1e6) * p.in + (result.tokens_out / 1e6) * p.out;
    return cost;
}

// --- Ejecutar tests en secuencia ---
console.log(`🧪 Probando ${MODELS_TO_TEST.length} modelos con la factura real...\n`);
console.log('═'.repeat(80));

const results = [];
for (const model of MODELS_TO_TEST) {
    process.stdout.write(`▶ ${model.padEnd(28)} ... `);
    const result = await testModel(model);
    results.push(result);

    if (result.ok) {
        const complete = result.complete ? '✅ completo' : '⚠️  parcial';
        const cost = estimateCost(result);
        const costStr = cost !== null ? ` | $${cost.toFixed(6)}/factura` : '';
        console.log(`${complete} | ${result.latency_ms}ms | score=${result.score.toFixed(2)} | ${result.tokens_in}→${result.tokens_out} tok${costStr}`);
    } else {
        console.log(`❌ ${result.status || 'ERR'} | ${result.latency_ms}ms | ${result.error}`);
    }
}

console.log('═'.repeat(80));

// --- Tabla resumen ---
console.log('\n📊 RESUMEN DETALLADO\n');
for (const r of results) {
    console.log(`\n── ${r.model} ──`);
    if (r.ok) {
        console.log(`   Status:       ${r.status} OK`);
        console.log(`   Latencia:     ${r.latency_ms} ms`);
        console.log(`   Completeness: ${r.complete ? 'COMPLETO ✅' : 'PARCIAL ⚠️'} (score ${r.score.toFixed(2)})`);
        if (!r.complete) console.log(`   Razón:        ${r.reason}`);
        console.log(`   Tokens:       in=${r.tokens_in} out=${r.tokens_out} total=${r.tokens_total}`);
        const cost = estimateCost(r);
        if (cost !== null) {
            console.log(`   Coste/factura: $${cost.toFixed(6)}`);
            console.log(`   Coste/1000:    $${(cost * 1000).toFixed(3)}`);
        }
        console.log(`   Datos extraídos:`);
        console.log(`     energyType:   ${r.extracted.energyType}`);
        console.log(`     tariffType:   ${r.extracted.tariffType}`);
        console.log(`     region:       ${r.extracted.region}`);
        console.log(`     billingDays:  ${r.extracted.billingDays}`);
        console.log(`     currentBill:  ${r.extracted.currentBill} €`);
        console.log(`     cae:          ${r.extracted.cae}`);
        console.log(`     consumption:  ${JSON.stringify(r.extracted.consumption)}`);
        console.log(`     power:        ${JSON.stringify(r.extracted.power)}`);
    } else {
        console.log(`   ❌ ERROR`);
        console.log(`   Status:   ${r.status || 'N/A'}`);
        console.log(`   Latencia: ${r.latency_ms} ms`);
        console.log(`   Mensaje:  ${r.error}`);
        if (r.rawSnippet) console.log(`   Snippet:  ${r.rawSnippet}`);
    }
}

// --- Ranking ---
console.log('\n\n🏆 RANKING (éxito + calidad + velocidad)\n');
const successful = results.filter((r) => r.ok);
const ranked = successful.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    if (Math.abs(a.score - b.score) > 0.01) return b.score - a.score;
    return a.latency_ms - b.latency_ms;
});

if (ranked.length === 0) {
    console.log('⚠️  Ningún modelo devolvió resultado completo.');
} else {
    ranked.forEach((r, i) => {
        const cost = estimateCost(r);
        const costStr = cost !== null ? ` — $${(cost * 1000).toFixed(3)}/1k facturas` : '';
        console.log(`${i + 1}. ${r.model.padEnd(28)} ${r.complete ? '✅' : '⚠️'} score=${r.score.toFixed(2)} | ${r.latency_ms}ms${costStr}`);
    });
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
    console.log('\n❌ FALLOS:');
    failed.forEach((r) => console.log(`   ${r.model}: ${r.error}`));
}

console.log('\n');
