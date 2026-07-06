const { readJson } = require('./_read-json');

exports.handler = async () => {
  try {
    const result = readJson('ajustes');
    if (result.error) {
      return { statusCode: result.status || 400, body: JSON.stringify({ error: result.error }) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: result.json
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Error interno' }) };
  }
};
