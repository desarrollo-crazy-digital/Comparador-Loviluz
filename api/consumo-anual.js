const annualConsumptionHandler = require('../lib/annualConsumptionHandler')

module.exports = async function handler(req, res) {
  return annualConsumptionHandler(req, res)
}
