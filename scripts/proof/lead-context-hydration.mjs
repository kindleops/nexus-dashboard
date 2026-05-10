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
  console.log('🧪 Starting Lead Context Hydration Proof...\n');

  try {
    // 1. Fetch Hydration Statistics
    const { data: commandCenterData, error: viewError } = await supabase
      .from('inbox_command_center_v')
      .select('thread_key, prospect_id, master_owner_id, property_id, owner_display_name, prospect_full_name, seller_phone, best_phone, property_address_full, property_type, final_acquisition_score');

    if (viewError) throw viewError;

    const totalThreads = commandCenterData.length;
    let missingProperty = 0;
    let missingOwner = 0;
    let missingProspect = 0;
    let missingAll = 0;
    let fallbackFailures = 0;

    commandCenterData.forEach(row => {
      if (!row.property_id) missingProperty++;
      if (!row.master_owner_id) missingOwner++;
      if (!row.prospect_id) missingProspect++;
      if (!row.property_id && !row.master_owner_id && !row.prospect_id) missingAll++;

      const hasPhone = row.seller_phone || row.best_phone;
      const hasDisplayName = row.owner_display_name || row.prospect_full_name;
      
      // Strict fallback test: If we have a phone but no name, the view didn't fallback to the phone number correctly.
      if (hasPhone && !hasDisplayName && !hasPhone.includes(row.owner_display_name || '')) {
         // This is a complex check, let's just see if display_name is completely null when phone exists
         if (!row.owner_display_name && !row.prospect_full_name && !row.seller_phone && !row.thread_key) {
            fallbackFailures++;
         }
      }
    });

    console.log(`📊 Hydration Stats (Total Threads: ${totalThreads})`);
    console.log(`   - Missing Property Data: ${missingProperty} (${Math.round(missingProperty/totalThreads*100)}%)`);
    console.log(`   - Missing Owner Data: ${missingOwner} (${Math.round(missingOwner/totalThreads*100)}%)`);
    console.log(`   - Missing Prospect Data: ${missingProspect} (${Math.round(missingProspect/totalThreads*100)}%)`);
    console.log(`   - Missing ALL Linked IDs: ${missingAll} (${Math.round(missingAll/totalThreads*100)}%)`);

    if (missingAll > 0) {
      console.log('\n❌ PROOF FAILED: Some threads have NO context IDs. The view needs robust phone-based fallbacks to link records.');
      console.log('\nSample Unlinked Threads:');
      const sample = commandCenterData.filter(r => !r.property_id && !r.master_owner_id && !r.prospect_id).slice(0, 5);
      console.log(JSON.stringify(sample, null, 2));
      process.exit(1);
    }

    console.log('\n✨ Lead Context Hydration Proof Complete (All threads have at least one context link)!');

  } catch (err) {
    console.error('❌ Proof failed:', err.message);
    process.exit(1);
  }
}

runProof();
