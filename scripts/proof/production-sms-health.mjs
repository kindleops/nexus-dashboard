#!/usr/bin/env node
/**
 * PROOF SCRIPT: production-sms-health.mjs
 *
 * Overall SMS pipeline health check.
 * Covers: send_queue status distribution, message_events totals,
 * inbox_thread_state totals, and the full integrity chain.
 *
 * READ-ONLY. Never mutates any data.
 * Exit 0 = clean. Exit 1 = integrity violations found.
 *
 * Usage:
 *   node scripts/proof/production-sms-health.mjs
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Env loader ────────────────────────────────────────────────────────────
function loadEnv() {
  const candidates = ['.env.local', '.env'];
  const env = {};
  for (const f of candidates) {
    const p = path.join(__dirname, '../../', f);
    if (!fs.existsSync(p)) continue;
    fs.readFileSync(p, 'utf-8').split('\n').forEach(line => {
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) return;
      const k = line.slice(0, eqIdx).trim();
      const v = line.slice(eqIdx + 1).trim();
      if (k && v && !k.startsWith('#')) env[k] = v;
    });
    break;
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: Missing SUPABASE_URL / SUPABASE_KEY in .env.local');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────
function pass(label, detail = '') {
  console.log(`  PASS  ${label}${detail ? '  — ' + detail : ''}`);
}
function fail(label, detail = '') {
  console.error(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
}
function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}
function kv(k, v) {
  console.log(`         ${String(k).padEnd(42)} ${v}`);
}

async function sql(query) {
  // Use rpc to run raw sql — falls back to individual table queries
  // since anon key may not have rpc access
  throw new Error('Use table queries directly');
}

// ── Main ──────────────────────────────────────────────────────────────────
let violations = 0;

async function run() {
  console.log('='.repeat(66));
  console.log('  NEXUS SMS PRODUCTION HEALTH CHECK');
  console.log(`  Run at: ${new Date().toISOString()}`);
  console.log('='.repeat(66));

  // ── 1. send_queue status distribution ──────────────────────────────────
  section('1. send_queue status distribution');
  const { data: queueRows, error: queueErr } = await supabase
    .from('send_queue')
    .select('queue_status');

  if (queueErr) {
    fail('send_queue fetch', queueErr.message);
    violations++;
  } else {
    const counts = {};
    for (const r of queueRows) counts[r.queue_status] = (counts[r.queue_status] || 0) + 1;
    const total = queueRows.length;
    kv('Total rows:', total);
    for (const [status, cnt] of Object.entries(counts).sort((a,b) => b[1] - a[1])) {
      kv(`  ${status}:`, cnt);
    }
    pass('send_queue readable', `${total} total rows`);
  }

  // ── 2. message_events totals ────────────────────────────────────────────
  section('2. message_events distribution');
  const { data: evtRows, error: evtErr } = await supabase
    .from('message_events')
    .select('direction,delivery_status,queue_id,thread_key');

  if (evtErr) {
    fail('message_events fetch', evtErr.message);
    violations++;
  } else {
    const total = evtRows.length;
    const outbound = evtRows.filter(r => r.direction === 'outbound').length;
    const inbound  = evtRows.filter(r => r.direction === 'inbound').length;
    const noQueueId   = evtRows.filter(r => r.direction === 'outbound' && !r.queue_id).length;
    const noThreadKey = evtRows.filter(r => !r.thread_key).length;

    kv('Total rows:', total);
    kv('  outbound:', outbound);
    kv('  inbound:', inbound);
    kv('  outbound with null queue_id:', noQueueId);
    kv('  any row with null thread_key:', noThreadKey);

    if (noQueueId > 0) {
      fail('outbound message_events.queue_id nulls', `${noQueueId} outbound rows missing queue_id`);
      violations++;
    } else {
      pass('outbound message_events.queue_id', 'all outbound rows have queue_id');
    }

    if (noThreadKey > 0) {
      fail('message_events.thread_key nulls', `${noThreadKey} rows missing thread_key`);
      violations++;
    } else {
      pass('message_events.thread_key', 'all rows have thread_key');
    }
  }

  // ── 3. Orphaned sent queue rows ─────────────────────────────────────────
  section('3. Orphaned sent rows (send_queue sent, no message_events)');
  const { data: sentRows, error: sentErr } = await supabase
    .from('send_queue')
    .select('id,queue_status,sent_at,thread_key,master_owner_id,property_id')
    .eq('queue_status', 'sent');

  if (sentErr) {
    fail('sent queue fetch', sentErr.message);
    violations++;
  } else {
    const sentIds = new Set(sentRows.map(r => r.id));
    const { data: linkedEvts, error: linkErr } = await supabase
      .from('message_events')
      .select('queue_id')
      .in('queue_id', Array.from(sentIds).slice(0, 1000));

    if (linkErr) {
      fail('message_events linkage check', linkErr.message);
      violations++;
    } else {
      const linkedQueueIds = new Set(linkedEvts.map(r => r.queue_id));
      const orphaned = sentRows.filter(r => !linkedQueueIds.has(r.id));

      kv('Total sent queue rows:', sentRows.length);
      kv('Sent rows with linked message_events:', linkedQueueIds.size);
      kv('Orphaned sent rows (NO message_events):', orphaned.length);

      if (orphaned.length > 0) {
        fail('send_queue → message_events linkage', `${orphaned.length} orphaned sent rows`);
        violations++;
        console.log('\n  Orphaned queue IDs:');
        for (const r of orphaned) {
          console.log(`    ${r.id}  sent_at=${r.sent_at || 'null'}  thread_key=${r.thread_key || 'null'}  property_id=${r.property_id || 'null'}`);
        }
      } else {
        pass('send_queue → message_events linkage', 'all sent rows have linked events');
      }
    }
  }

  // ── 4. inbox_thread_state linkage ──────────────────────────────────────
  section('4. inbox_thread_state linkage');
  const { data: stateRows, error: stateErr } = await supabase
    .from('inbox_thread_state')
    .select('thread_key,status,stage');

  if (stateErr) {
    fail('inbox_thread_state fetch', stateErr.message);
    violations++;
  } else {
    const stateKeys = new Set(stateRows.map(r => r.thread_key));
    const { data: evtKeyRows, error: evtKeyErr } = await supabase
      .from('message_events')
      .select('thread_key');

    if (evtKeyErr) {
      fail('message_events thread_key fetch', evtKeyErr.message);
      violations++;
    } else {
      const evtKeys = new Set(evtKeyRows.filter(r => r.thread_key).map(r => r.thread_key));

      const statesWithNoEvents = [...stateKeys].filter(k => !evtKeys.has(k)).length;
      const evtKeysWithNoState = [...evtKeys].filter(k => !stateKeys.has(k)).length;
      const blankStage = stateRows.filter(r => !r.stage || r.stage.trim() === '').length;

      kv('Total thread_state rows:', stateRows.length);
      kv('Distinct thread_keys in message_events:', evtKeys.size);
      kv('Thread states with NO events (stale):', statesWithNoEvents);
      kv('Event thread_keys with NO state:', evtKeysWithNoState);
      kv('Thread states with blank stage:', blankStage);

      if (statesWithNoEvents > 0) {
        fail('inbox_thread_state → message_events', `${statesWithNoEvents} thread states have no events (stale)`);
        violations++;
      } else {
        pass('inbox_thread_state → message_events', 'all thread states have events');
      }

      if (evtKeysWithNoState > 0) {
        fail('message_events → inbox_thread_state', `${evtKeysWithNoState} event thread_keys missing thread state`);
        violations++;
      } else {
        pass('message_events → inbox_thread_state', 'all event thread_keys have a state row');
      }

      if (blankStage > 0) {
        fail('inbox_thread_state.stage blank', `${blankStage} rows have blank stage`);
        violations++;
      } else {
        pass('inbox_thread_state.stage', 'no blank stage values');
      }
    }
  }

  // ── 5. Runner insert bug surface check ─────────────────────────────────
  section('5. Runner insert schema mismatch check');
  // The runner (runner.ts) inserts message_events with:
  //   thread_id: null    — column does not exist in prod schema (should be thread_key)
  //   body: ...          — column does not exist in prod schema (should be message_body)
  //   status: 'pending'  — column does not exist in prod schema (should be delivery_status)
  //   phone: ...         — column does not exist in prod schema (should be to_phone_number)
  // These mismatches cause the insert to silently skip those fields or fail.
  // We surface this by checking for outbound events created at the same time as sent rows
  // that have null message_body.
  const { data: nullBodyEvts, error: nullBodyErr } = await supabase
    .from('message_events')
    .select('id,queue_id,direction,message_body,created_at')
    .eq('direction', 'outbound')
    .is('message_body', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (nullBodyErr) {
    fail('null message_body check', nullBodyErr.message);
    violations++;
  } else {
    kv('Outbound events with null message_body:', nullBodyEvts.length);
    if (nullBodyEvts.length > 0) {
      fail('message_events.message_body null on outbound', `${nullBodyEvts.length} outbound events missing message body (runner schema mismatch)`);
      violations++;
    } else {
      pass('message_events.message_body', 'no null message bodies on outbound events');
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(66));
  if (violations === 0) {
    console.log('  RESULT: CLEAN — no integrity violations found');
    console.log('='.repeat(66));
    process.exit(0);
  } else {
    console.error(`  RESULT: ${violations} VIOLATION(S) FOUND — see FAIL lines above`);
    console.log('='.repeat(66));
    process.exit(1);
  }
}

run().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(2);
});
