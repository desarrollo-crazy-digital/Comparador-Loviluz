const { calculateForRequest } = require('../../calculator');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const payload = JSON.parse(event.body || '{}');
    const result = calculateForRequest(payload);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (err) {
    const status = err.status || 500;
    return { statusCode: status, body: JSON.stringify({ error: err.message || 'Error interno' }) };
  }
};
