const { validateCommercialCode } = require('../../calculator');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const payload = JSON.parse(event.body || '{}');
    const code = payload && payload.codigo;
    const result = validateCommercialCode(code);
    if (!result) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Código no válido' }) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, code: result.code, secretary: result.secretary })
    };
  } catch (err) {
    const status = err.status || 500;
    return { statusCode: status, body: JSON.stringify({ error: err.message || 'Error interno' }) };
  }
};
