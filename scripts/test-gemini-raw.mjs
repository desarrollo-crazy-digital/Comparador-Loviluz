#!/usr/bin/env node
/**
 * Test inspección raw: muestra exactamente qué devuelve cada modelo
 * (texto bruto, finishReason, usage, etc).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function loadEnv() {
    try {
        const envText = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
        for (const line of envText.split('\n')) {
            const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
        }
    } catch (_) {}
}
await loadEnv();

const API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

// Modelos que responden 200 OK
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

const PDF_PATH = path.join(ROOT, 'public', '241 - Factura ENERGIA 26000000993 INER.pdf');
const pdfBase64 = (await fs.readFile(PDF_PATH)).toString('base64');

const PROMPT = [
    'Eres un extractor de datos de facturas de electricidad o gas en España.',
    'Lee SOLO las dos primeras páginas de la factura (ignora el resto). Devuelve SOLO un JSON con estos campos (usa 0 cuando no haya dato):',
    '{ "energyType": "electricidad|gas", "tariffType": "2.0TD|3.0TD|6.1TD|GAS", "region": "PENINSULA|BALEARES|CANARIAS|CEUTA_MELILLA",',
    ' "clientName": "", "address": "", "cups": "", "billingDays": 0, "currentBill": 0, "cae": 0,',
    ' "consumption": {"P1":0,"P2":0,"P3":0,"P4":0,"P5":0,"P6":0},',
    ' "power": {"P1":0,"P2":0,"P3":0,"P4":0,"P5":0,"P6":0},',
    ' "equipmentRental": 0, "otherCosts": 0, "discountEnergy": 0, "discountPower": 0,',
    ' "reactiveEnergy": 0, "excessPower": 0, "socialBonus": 0, "surpluses": 0,',
    ' "gasMonthlyConsumption": 0, "gasFixedDaily": 0, "gasVariableKwh": 0, "gasTariffBand": "RL1|RL2|RL3|RL4|RL5" }',
    'No incluyas texto fuera del JSON. Archivo: factura-test.pdf.'
].join(' ');

async function testRaw(model, maxTokens) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${API_KEY}`;
    const payload = {
        contents: [{
            parts: [
                { text: PROMPT },
                { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } }
            ]
        }],
        generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            maxOutputTokens: maxTokens
        }
    };

    const t0 = Date.now();
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const latency = Date.now() - t0;
    const json = await res.json();

    return {
        model, maxTokens,
        latency,
        status: res.status,
        finishReason: json?.candidates?.[0]?.finishReason,
        usage: json?.usageMetadata,
        rawText: (json?.candidates?.[0]?.content?.parts || []).map(p => p?.text).find(Boolean) || null,
        error: json?.error,
        fullResponse: json
    };
}

console.log('🔍 Inspección raw con maxOutputTokens=2048\n');

for (const model of MODELS) {
    console.log('\n' + '='.repeat(80));
    console.log(`📦 ${model}`);
    console.log('='.repeat(80));

    const r = await testRaw(model, 2048);
    console.log(`Status:       ${r.status}`);
    console.log(`Latencia:     ${r.latency} ms`);
    console.log(`FinishReason: ${r.finishReason}`);
    console.log(`Usage:`, r.usage);
    if (r.error) console.log(`❌ Error:`, r.error);
    if (r.rawText) {
        console.log(`\n--- RAW TEXT (${r.rawText.length} chars) ---`);
        console.log(r.rawText);
        console.log('--- FIN RAW ---');

        try {
            const parsed = JSON.parse(r.rawText);
            console.log(`\n✅ PARSE OK. Keys: ${Object.keys(parsed).join(', ')}`);
        } catch (e) {
            console.log(`\n❌ PARSE FAIL: ${e.message}`);
        }
    } else {
        console.log('\n⚠️  Sin rawText. Respuesta completa:');
        console.log(JSON.stringify(r.fullResponse, null, 2).slice(0, 2000));
    }
}
