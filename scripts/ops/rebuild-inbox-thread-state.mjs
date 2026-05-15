import 'dotenv/config'

const BASE_URL = process.env.VITE_API_URL || 'http://localhost:5173'

async function run() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const dryRun = !apply
  const onlyInconsistent = !args.includes('--all')
  const includeSuppressed = args.includes('--include-suppressed')
  
  let limit = 1000
  const limitArg = args.find(a => a.startsWith('--limit='))
  if (limitArg) limit = parseInt(limitArg.split('=')[1], 10)

  let threadKey = null
  const tkArg = args.find(a => a.startsWith('--thread='))
  if (tkArg) threadKey = tkArg.split('=')[1]

  const payload = {
    apply,
    dry_run: dryRun,
    only_inconsistent: onlyInconsistent,
    include_suppressed: includeSuppressed,
    limit,
    thread_key: threadKey
  }

  console.log(`🚀 Triggering Inbox Thread State Rebuild...`)
  console.log(`Payload: ${JSON.stringify(payload, null, 2)}`)
  
  try {
    const res = await fetch(`${BASE_URL}/api/internal/inbox/rebuild-thread-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text}`)
    }
    
    const data = await res.json()
    console.log(`\n✅ Rebuild complete!\n`)
    console.log(JSON.stringify(data, null, 2))
    
  } catch (err) {
    console.error(`\n❌ Error:`, err.message)
    process.exit(1)
  }
}

run()