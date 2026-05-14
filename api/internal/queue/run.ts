import { DEFAULT_LIVE_CAPS, runQueueBatch, type QueueRunCaps } from './runner'

type ApiRequest = {
  method?: string
  body?: any
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (body: any) => void
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const caps: Partial<QueueRunCaps> = {
      ...DEFAULT_LIVE_CAPS,
      ...(req.body?.caps || {}),
    }
    const result = await runQueueBatch(caps)
    res.status(200).json(result)
  } catch (error) {
    console.error('[Queue Run Error]:', error)
    res.status(500).json({ error: error instanceof Error ? error.message : 'Queue run failed' })
  }
}
