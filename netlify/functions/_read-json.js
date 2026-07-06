const fs = require('fs');
const path = require('path');

const resolveDataPath = (filename) => {
  const candidates = [
    path.join(process.cwd(), 'api', 'data-private', filename),
    path.join(__dirname, '..', '..', '..', 'api', 'data-private', filename),
    path.join(__dirname, '..', '..', 'api', 'data-private', filename)
  ];
  return candidates.find(p => fs.existsSync(p)) || candidates[0];
};

const FILES = {
  'tarifas': resolveDataPath('tarifas.v2.json'),
  'tarifas-gas': resolveDataPath('tarifas-gas.v2.json'),
  'comisiones': resolveDataPath('comisiones.json'),
  'comerciales': resolveDataPath('comerciales.json'),
  'ajustes': resolveDataPath('ajustes.json')
};

function readJson(key) {
  const filePath = FILES[key];
  if (!filePath) {
    return { error: 'Archivo no permitido', status: 400 };
  }
  const json = fs.readFileSync(filePath, 'utf8');
  return { json };
}

module.exports = { readJson };
