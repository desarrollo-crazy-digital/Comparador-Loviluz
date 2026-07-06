/**
 * Netlify Function: /api/actualizar-tarifas
 * Extrae tarifas desde PDF/Excel y devuelve coincidencias con tarifas existentes
 */

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { fileName = 'tarifas.pdf', mimeType = 'application/pdf', base64 } = JSON.parse(event.body || '{}');
    if (!base64) throw new Error('Archivo no recibido');
    const fileBuffer = Buffer.from(base64, 'base64');

    const ignisWorkbook = require('../../lib/ignisWorkbook');
    const ignisPdf = require('../../lib/ignisPdf');
    const logosWorkbook = require('../../lib/logosWorkbook');
    const loviluzWorkbook = require('../../lib/loviluzWorkbook');
    const polarisPdf = require('../../lib/polarisPdf');
    const eleiaS2026Workbook = require('../../lib/eleiaS2026Workbook');
    if (eleiaS2026Workbook.isEleiaS2026Workbook(fileName, mimeType, fileBuffer)) {
      const extractedTariffs = eleiaS2026Workbook.parseEleiaS2026Workbook(fileBuffer, { fileName });
      return {
        statusCode: 200,
        body: JSON.stringify({
          extracted: extractedTariffs,
          count: extractedTariffs.tarifas?.length || 0,
          mode: 'eleia-s2026-xlsx'
        })
      };
    }
    if (ignisWorkbook.isIgnisWorkbook(fileName, mimeType)) {
      const extractedTariffs = ignisWorkbook.parseIgnisWorkbook(fileBuffer, { fileName });
      return {
        statusCode: 200,
        body: JSON.stringify({
          extracted: extractedTariffs,
          count: extractedTariffs.tarifas?.length || 0,
          mode: 'ignis-xlsx'
        })
      };
    }
    if (logosWorkbook.isLogosWorkbook(fileName, mimeType, fileBuffer)) {
      const extractedTariffs = logosWorkbook.parseLogosWorkbook(fileBuffer, { fileName });
      return {
        statusCode: 200,
        body: JSON.stringify({
          extracted: extractedTariffs,
          count: extractedTariffs.tarifas?.length || 0,
          mode: 'logos-xlsx'
        })
      };
    }
    if (loviluzWorkbook.isLoviluzWorkbook(fileName, mimeType, fileBuffer)) {
      const extractedTariffs = loviluzWorkbook.parseLoviluzWorkbook(fileBuffer, { fileName });
      return {
        statusCode: 200,
        body: JSON.stringify({
          extracted: extractedTariffs,
          count: extractedTariffs.tarifas?.length || 0,
          mode: 'loviluz-xlsx'
        })
      };
    }
    if (ignisPdf.isIgnisFacilPdf(fileName, mimeType)) {
      const extractedTariffs = await ignisPdf.parseIgnisFacilPdf(fileBuffer, { fileName });
      return {
        statusCode: 200,
        body: JSON.stringify({
          extracted: extractedTariffs,
          count: extractedTariffs.tarifas?.length || 0,
          mode: 'ignis-facil-pdf'
        })
      };
    }
    if (polarisPdf.isPolarisTariffPdf(fileName, mimeType)) {
      const extractedTariffs = await polarisPdf.parsePolarisTariffPdf(fileBuffer, { fileName });
      return {
        statusCode: 200,
        body: JSON.stringify({
          extracted: extractedTariffs,
          count: extractedTariffs.tarifas?.length || 0,
          mode: 'polaris-pdf'
        })
      };
    }

    if (!GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY en el servidor');

    const geminiPayload = buildTarifasPrompt({ fileName, mimeType, base64 });
    const extractedTariffs = await callGemini(geminiPayload);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        extracted: extractedTariffs,
        count: extractedTariffs.tarifas?.length || 0
      })
    };
  } catch (err) {
    const status = err.status || 500;
    return {
      statusCode: status,
      body: JSON.stringify({ error: err.message || 'Error interno' })
    };
  }
};

function buildTarifasPrompt({ fileName, mimeType, base64 }) {
  const prompt = [
    'Eres un extractor de datos de tarifas eléctricas y de gas de comercializadoras españolas.',
    'Lee el documento y extrae TODAS las tarifas que encuentres.',
    'Devuelve SOLO un JSON con este formato exacto (sin texto adicional):',
    '{',
    '  "tarifas": [',
    '    {',
    '      "comercializadora": "NOMBRE_COMERCIALIZADORA",',
    '      "tipoTarifa": "2.0TD|3.0TD|6.1TD|GAS",',
    '      "nombreProducto": "NOMBRE_EXACTO_TARIFA",',
    '      "periodosConsumo": {"P1": 0.123, "P2": 0.098, "P3": 0.076, "P4": 0, "P5": 0, "P6": 0},',
    '      "periodosPotencia": {"P1": 0.045, "P2": 0.012, "P3": null, "P4": null, "P5": null, "P6": null}',
    '    }',
    '  ]',
    '}',
    '',
    'REGLAS IMPORTANTES:',
    '- Para 2.0TD: solo P1-P3 consumo, P1-P2 potencia (resto a 0 o null)',
    '- Para 3.0TD y 6.1TD: P1-P6 consumo y potencia completos',
    '- Para GAS: usa tipoTarifa="GAS", y en periodosConsumo pon solo {"kWh": precio_variable}, potencia null',
    '- Precios en €/kWh para consumo, €/kW/día para potencia',
    '- Usa 0 para periodos no existentes, null si no está disponible',
    '- Si un producto UNICA muestra un solo precio de energia, repitelo en todos los periodos de energia aplicables de esa tarifa',
    '- Si un producto UNICA reutiliza la potencia de su CLASICA equivalente, copia exactamente esos mismos periodos de potencia',
    '- Ejemplo: CLASICA TE1 UNICA usa la misma potencia que CLASICA TE1; CLASICA TE2 UNICA la de CLASICA TE2; y asi sucesivamente',
    '- En TotalEnergies SOUL, si aparecen columnas PMFi y DI para energia, extrae PMFi e ignora DI',
    '- No mezcles ni promedies PMFi y DI: para SOUL usa solo los precios PMFi como termino de energia',
    '- Extrae el nombre EXACTO del producto/tarifa como aparece',
    '- El nombre de la comercializadora en MAYÚSCULAS',
    '- Si encuentras varias comercializadoras, extrae todas',
    '',
    `Documento: ${fileName || 'tarifas'}`
  ].join(' ');

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
      responseMimeType: 'application/json'
    }
  };
}

async function callGemini(payload) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const maxAttempts = 3;
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let msg = `Gemini error ${res.status}`;
      try { const err = await res.json(); msg = err.error?.message || msg; } catch (_) {}

      const overload = res.status === 429 || res.status === 503 || /overloaded|quota|rate/i.test(msg);
      if (overload && attempt < maxAttempts) {
        const delayMs = 600 * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delayMs));
        lastErr = Object.assign(new Error(msg), { status: res.status });
        continue;
      }

      const error = new Error(/overloaded/i.test(msg) ? 'Gemini está saturado. Intenta de nuevo.' : msg);
      error.status = res.status;
      throw error;
    }

    const json = await res.json();
    const textPart = (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts || [])
      .map(p => p.text)
      .find(Boolean);

    if (!textPart) throw new Error('Gemini no devolvió contenido');
    return parseGeminiJson(textPart);
  }

  throw lastErr || new Error('Gemini está saturado. Intenta de nuevo.');
}

function parseGeminiJson(text) {
  if (!text || typeof text !== 'string') throw new Error('Respuesta vacía de Gemini');

  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed.tarifas || !Array.isArray(parsed.tarifas)) {
      throw new Error('Formato inválido: se esperaba { tarifas: [...] }');
    }
    return parsed;
  } catch (err) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_) {}
    }
    throw new Error('No se pudo interpretar la respuesta de Gemini: ' + err.message);
  }
}
