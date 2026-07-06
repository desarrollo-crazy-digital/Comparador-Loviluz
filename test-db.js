const { querySupabaseAnnualConsumption } = require('./lib/annualConsumption.js');
async function test() {
  const result = await querySupabaseAnnualConsumption("ES0021000000000000AA");
  console.log("Result:", result);
}
test();
