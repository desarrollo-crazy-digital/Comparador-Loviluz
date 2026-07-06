const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.ENERGIA_SUPABASE_URL, process.env.ENERGIA_SUPABASE_KEY);

async function test() {
  console.time('like');
  const { data: d1 } = await supabase.from('consumos_facturacion').select('*').like('cups', 'ES0031102842183001TX0F%').limit(12);
  console.timeEnd('like');

  console.time('eq');
  const { data: d2 } = await supabase.from('consumos_facturacion').select('*').eq('cups', 'ES0031102842183001TX0F').limit(12);
  console.timeEnd('eq');
}
test();
