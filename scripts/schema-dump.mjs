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

async function audit() {
  const tables = ['message_events', 'properties', 'master_owners', 'prospects', 'phones', 'emails'];
  for (const t of tables) {
    console.log(`--- ${t} ---`);
    const { data, error } = await supabase.from(t).select('*').limit(1);
    if (error) console.log('Error:', error.message);
    else console.log('Columns:', Object.keys(data[0] || {}));
    console.log('');
  }
}

audit();
