import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const env = {};
const content = fs.readFileSync('.env.local', 'utf-8');
content.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
    env[key.trim()] = valueParts.join('=').trim().replace(/^"(.*)"$/, '$1');
  }
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function auditSchemas() {
  const tables = ['message_events', 'properties', 'master_owners', 'prospects', 'inbox_thread_state', 'phone_numbers', 'emails'];
  const views = ['inbox_command_center_v', 'inbox_threads_hydrated', 'nexus_inbox_threads_v'];

  console.log('--- Table & View Columns Audit ---\n');

  for (const name of [...tables, ...views]) {
    const { data, error } = await supabase.rpc('exec_sql', { 
      sql_query: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${name}' AND table_schema = 'public' ORDER BY ordinal_position` 
    });

    if (error) {
       // Fallback: try querying directly with limit 0 if exec_sql fails
       const { data: cols, error: err2 } = await supabase.from(name).select('*').limit(0);
       if (err2) {
         console.log(`[${name}] NOT FOUND OR INACCESSIBLE`);
       } else {
         console.log(`[${name}] Columns:`, Object.keys(cols[0] || {}));
       }
    } else {
      console.log(`[${name}] Columns:`, data.map(c => `${c.column_name} (${c.data_type})`).join(', '));
    }
    console.log('');
  }
}

auditSchemas();
