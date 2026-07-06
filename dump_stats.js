require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("No Supabase configuration found in .env");
  process.exit(1);
}

const supabase = createClient(url, key);

async function dumpComparisons() {
  const pageSize = 1000;
  let from = 0;
  const rows = [];

  console.log("Starting export...");

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('comparisons')
      .select('*')
      .order('created_at', { ascending: true })
      .range(from, to);

    if (error) {
      console.error("Error fetching data:", error);
      break;
    }

    if (!data || data.length === 0) break;

    rows.push(...data);
    console.log(`Fetched ${rows.length} records so far...`);

    if (data.length < pageSize) break;
    from += pageSize;
  }

  const outputPath = 'comparisons_backup.json';
  fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2));
  console.log(`Export completed. Saved ${rows.length} records to ${outputPath}.`);
}

dumpComparisons();
