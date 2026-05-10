import { COPILOT_AGENTS, getAgentById } from '../src/modules/copilot/copilot.agents.js';
import { routeQueryToAgent } from '../src/modules/copilot/copilot.router.js';

console.log('🧪 Testing Multi-Agent Copilot Architecture...\n');

// 1. Verify Agents
if (COPILOT_AGENTS.length !== 9) {
  console.error(`❌ Expected 9 agents, found ${COPILOT_AGENTS.length}`);
  process.exit(1);
}
console.log(`✅ Loaded ${COPILOT_AGENTS.length} distinct agent personas.`);

const cfo = getAgentById('cfo');
if (cfo.name !== 'Nexus CFO' || cfo.avatarEmoji !== '🏛️') {
  console.error('❌ Agent metadata mismatch for CFO');
  process.exit(1);
}
console.log(`✅ Agent metadata verified (e.g. ${cfo.name}).`);

// 2. Verify Router
const testCases = [
  { query: 'what is our strategy?', expected: 'ceo' },
  { query: 'this queue is stuck', expected: 'coo' },
  { query: 'run comps and underwrite', expected: 'underwriter' },
  { query: 'what is the margin?', expected: 'cfo' },
  { query: 'draft a negotiation reply', expected: 'acquisitions' },
  { query: 'sell this to a hedge fund', expected: 'dispo' },
  { query: 'is title clear?', expected: 'title' },
  { query: 'dnc this number', expected: 'compliance' },
  { query: 'fix broken sync', expected: 'data' },
];

let routerPassed = true;
for (const tc of testCases) {
  const result = routeQueryToAgent(tc.query, 'ceo');
  if (result !== tc.expected) {
    console.error(`❌ Routing failed for "${tc.query}". Expected ${tc.expected}, got ${result}`);
    routerPassed = false;
  }
}

if (routerPassed) {
  console.log('✅ All conversational routing tests passed.');
} else {
  process.exit(1);
}

console.log('\n✨ Multi-Agent Copilot Validation Complete!');
