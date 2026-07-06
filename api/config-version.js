const { getConfigVersion } = require('../lib/configVersion')

module.exports = (_req, res) => {
  try {
    const payload = getConfigVersion()
    res.setHeader('Content-Type', 'application/json')
    res.status(200).send(JSON.stringify(payload))
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo calcular la versión de configuración' })
  }
}
