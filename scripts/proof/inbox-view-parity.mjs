import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  const envFiles = ['.env.local', '.env'];
  const env = {};
  for (const file of envFiles) {
    const envPath = path.join(__dirname, '../../', file);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      content.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          env[key.trim()] = valueParts.join('=').trim().replace(/^"(.*)"$/, '$1');
        }
      });
      break;
    }
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function runProof() {
  console.log('🧪 Starting Inbox View Parity Proof...\n');

  try {
    const views = [
      { key: 'hot_leads', countKey: 'hot_leads' },
      { key: 'needs_review', countKey: 'needs_review' },
      { key: 'new_inbound', countKey: 'new_inbound' },
      { key: 'all_inbound', countKey: 'all_inbound' },
      { key: 'automated', countKey: 'automated' },
      { key: 'outbound_active', countKey: 'outbound_active' },
      { key: 'cold_no_response', countKey: 'cold_no_response' },
      { key: 'dnc_opt_out', countKey: 'dnc_opt_out' }
    ];

    // Get Backend Counts from rollup view
    const { data: countRows } = await supabase.from('inbox_category_counts').select('*');
    const counts = countRows.reduce((acc, r) => { acc[r.category] = r.count; return acc; }, {});
    
    // Special handling for all_inbound count
    const { count: allInboundCount } = await supabase.from('inbox_command_center_v').select('thread_key', { count: 'exact', head: true }).gt('inbound_count', 0);
    counts.all_inbound = allInboundCount;

    let totalFailures = 0;

    for (const v of views) {
      const expected = counts[v.countKey] || 0;
      
      // Simulate fetch query
      let query = supabase.from('inbox_command_center_v').select('thread_key, inbox_category, inbound_count', { count: 'exact' });
      if (v.key === 'all_inbound') {
        query = query.gt('inbound_count', 0);
      } else {
        query = query.eq('inbox_category', v.key);
      }
      
      const { data: rows, count: totalAvailable } = await query.limit(1000);
      const actual = totalAvailable || 0;

      console.log(`View: ${v.key}`);
      console.log(`  Expected Count: ${expected}`);
      console.log(`  Actual Count:   ${actual}`);
      console.log(`  Returned Rows:  ${rows.length}`);

      if (expected !== actual) {
         console.log(`  ❌ FAIL: Count mismatch between rollup and query results.`);
         totalFailures++;
      } else {
         console.log(`  ✅ PASS: Counts match.`);
      }
      
      // Check for row mismatches (logic integrity)
      if (v.key !== 'all_inbound') {
        const misfits = rows.filter(r => r.inbox_category !== v.key);
        if (misfits.length > 0) {
           console.log(`  ❌ FAIL: Found ${misfits.length} misclassified rows.`);
           totalFailures++;
        }
      } else {
        const misfits = rows.filter(r => r.inbound_count === 0);
        if (misfits.length > 0) {
           console.log(`  ❌ FAIL: Found ${misfits.length} rows with 0 inbound in all_inbound.`);
           totalFailures++;
        }
      }
    }

    if (totalFailures > 0) {
      console.log(`\n❌ PROOF FAILED: ${totalFailures} parity errors detected.`);
      process.exit(1);
    }

    console.log('\n✨ Inbox View Parity Proof Complete!');

  } catch (err) {
    console.error('❌ Proof failed:', err.message);
    process.exit(1);
  }
}

runProof();
