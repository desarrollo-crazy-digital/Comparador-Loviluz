#!/usr/bin/env node
/**
 * Test end-to-end del handler real api/extraer-factura.js
 *
 * Simula una request HTTP completa con la factura de ejemplo y mide:
 *  - Si la cascada de modelos funciona
 *  - Cuántos modelos tuvo que probar
 *  - Completeness del resultado
 *  - Tiempo total
 *  - Tiempo por modelo (desde los logs estructurados)
 *
 * Ejecuta el test 3 veces para ver la estabilidad.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Cargar .env
async function loadEnv() {
    const envText = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
    for (const line of envText.split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
}
await loadEnv();

console.log('🔧 Config activa:');
console.log(`   GEMINI_MODEL=${process.env.GEMINI_MODEL}`);
console.log(`   GEMINI_FALLBACK_MODELS=${process.env.GEMINI_FALLBACK_MODELS}`);
console.log(`   GOOGLE_API_KEY=${(process.env.GOOGLE_API_KEY || '').slice(0, 10)}...\n`);

// Cargar handler dinámicamente
const handlerPath = path.join(ROOT, 'api', 'extraer-factura.js');
const { default: handler } = await import(pathToFileURL(handlerPath).href)
    .then((mod) => ({ default: mod.default || mod }));

// Cargar factura
const PDF_PATH = path.join(ROOT, 'public', '241 - Factura ENERGIA 26000000993 INER.pdf');
const pdfBase64 = (await fs.readFile(PDF_PATH)).toString('base64');
console.log(`📄 Factura: ${(pdfBase64.length / 1024).toFixed(1)} KB (base64)\n`);

// Mock req/res
function mockReqRes(body) {
    const req = { method: 'POST', body };
    let statusCode = 200;
    let jsonBody = null;
    const res = {
        status(code) { statusCode = code; return this; },
        json(body) { jsonBody = body; return this; },
        _result: () => ({ statusCode, jsonBody })
    };
    return { req, res };
}

async function runOnce(runNum) {
    const { req, res } = mockReqRes({
        fileName: '241 - Factura ENERGIA 26000000993 INER.pdf',
        mimeType: 'application/pdf',
        base64: pdfBase64
    });
    const t0 = Date.now();
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`▶ RUN ${runNum}`);
    console.log('═'.repeat(80));

    await handler(req, res);
    const latency = Date.now() - t0;
    const { statusCode, jsonBody } = res._result();

    console.log(`\n── Resultado run ${runNum} ──`);
    console.log(`   HTTP status:  ${statusCode}`);
    console.log(`   Latencia:     ${latency} ms`);

    if (statusCode === 200 && jsonBody?.extracted) {
        const e = jsonBody.extracted;
        const c = jsonBody.completeness;
        console.log(`   Completeness: ${c.complete ? '✅ COMPLETO' : '⚠️  PARCIAL'} (score ${c.score?.toFixed(2)})`);
        if (!c.complete) console.log(`   Razón:        ${c.reason}`);
        console.log(`   energyType:   ${e.energyType}`);
        console.log(`   tariffType:   ${e.tariffType}`);
        console.log(`   region:       ${e.region}`);
        console.log(`   billingDays:  ${e.billingDays}`);
        console.log(`   currentBill:  ${e.currentBill} €`);
        console.log(`   cae:          ${e.cae}`);
        console.log(`   consumption:  ${JSON.stringify(e.consumption)}`);
        console.log(`   power:        ${JSON.stringify(e.power)}`);
        return { ok: true, latency, complete: c.complete, score: c.score };
    } else {
        console.log(`   ❌ ERROR:     ${jsonBody?.error || 'sin mensaje'}`);
        return { ok: false, latency, error: jsonBody?.error };
    }
}

// Ejecutar 3 corridas en serie
const results = [];
for (let i = 1; i <= 3; i++) {
    const r = await runOnce(i);
    results.push(r);
}

// Resumen
console.log(`\n${'═'.repeat(80)}`);
console.log('📊 RESUMEN DE LAS 3 EJECUCIONES');
console.log('═'.repeat(80));
const successful = results.filter((r) => r.ok).length;
const complete = results.filter((r) => r.ok && r.complete).length;
const avgLatency = results.reduce((sum, r) => sum + r.latency, 0) / results.length;
console.log(`   OK:                 ${successful}/3`);
console.log(`   Completos:          ${complete}/3`);
console.log(`   Latencia media:     ${avgLatency.toFixed(0)} ms`);
console.log(`   Latencia mín/máx:   ${Math.min(...results.map(r => r.latency))}ms / ${Math.max(...results.map(r => r.latency))}ms`);

if (complete === 3) {
    console.log('\n✅ Las 3 ejecuciones completaron al primer modelo sin fallback. Config OK.');
} else if (successful === 3) {
    console.log('\n⚠️  Todas OK pero alguna incompleta. Revisa los logs por modelo arriba.');
} else {
    console.log('\n❌ Hay ejecuciones fallidas. Revisa los errores.');
}
console.log('');
